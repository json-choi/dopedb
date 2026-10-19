//! MySQL administrator session: reads, observation, and plan execution.

use sqlx::mysql::{MySqlConnectOptions, MySqlConnection};
use sqlx::{AssertSqlSafe, Connection, Row};

use crate::connection::pool::mysql_ssl_mode;
use crate::model::ConnectionProfile;

use super::super::super::domain::{FailureCode, Marker, PrincipalName};
use super::super::super::ownership::{ObservedPrincipal, ServerIdentity};
use super::super::super::plan::{kill_connection, PlannedStatement, Planner};
use super::super::super::types::{NamespaceFacts, PreflightFacts};
use super::{categorize, connect_timeout, statement_timeout, within};

pub(super) struct MysqlSession {
    conn: MySqlConnection,
}

/// Where a grant applies.
enum GrantScope {
    Global,
    /// One schema, with MySQL's `\_` escapes removed.
    Schema(String),
    /// Table, column, or routine level: irrelevant to schema-wide sharing.
    Narrow,
}

/// One `SHOW GRANTS` line broken into what the preflight needs.
struct GrantLine {
    privileges: String,
    scope: GrantScope,
    grant_option: bool,
}

fn parse_grant(line: &str) -> Option<GrantLine> {
    let rest = line.strip_prefix("GRANT ")?;
    let (privileges, rest) = rest.split_once(" ON ")?;
    let (target, _) = rest.split_once(" TO ")?;
    let scope = if target == "*.*" {
        GrantScope::Global
    } else {
        match target.rsplit_once('.') {
            Some((database, "*")) => GrantScope::Schema(
                database
                    .trim_matches('`')
                    .replace("``", "`")
                    .replace("\\_", "_"),
            ),
            _ => GrantScope::Narrow,
        }
    };
    Some(GrantLine {
        privileges: privileges.to_ascii_uppercase(),
        scope,
        grant_option: line.ends_with("WITH GRANT OPTION"),
    })
}

fn covers(privileges: &str, needed: &[&str]) -> bool {
    privileges.contains("ALL PRIVILEGES")
        || needed.iter().all(|privilege| {
            privileges
                .split(',')
                .any(|granted| granted.trim() == *privilege)
        })
}

fn global_covers(grants: &[GrantLine], privilege: &str) -> bool {
    grants.iter().any(|grant| {
        matches!(grant.scope, GrantScope::Global) && covers(&grant.privileges, &[privilege])
    })
}

fn ends_sessions(grants: &[GrantLine]) -> bool {
    global_covers(grants, "PROCESS")
        && (global_covers(grants, "CONNECTION_ADMIN") || global_covers(grants, "SUPER"))
}

async fn text_column(row: &sqlx::mysql::MySqlRow, index: usize) -> Result<String, FailureCode> {
    match row.try_get::<String, _>(index) {
        Ok(value) => Ok(value),
        Err(_) => row
            .try_get::<Vec<u8>, _>(index)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .map_err(|e| categorize(&e)),
    }
}

impl MysqlSession {
    pub(super) async fn connect(
        profile: &ConnectionProfile,
        password: &str,
    ) -> Result<Self, FailureCode> {
        let options = MySqlConnectOptions::new()
            .host(&profile.host)
            .port(profile.port)
            .database(&profile.database)
            .username(&profile.username)
            .password(password)
            .ssl_mode(mysql_ssl_mode(&profile.sslmode).map_err(|_| FailureCode::Network)?);
        let conn = within(connect_timeout(), MySqlConnection::connect_with(&options)).await?;
        Ok(Self { conn })
    }

    pub(super) async fn version(&mut self) -> Result<String, FailureCode> {
        within(
            statement_timeout(),
            sqlx::query_scalar::<_, String>("SELECT @@version").fetch_one(&mut self.conn),
        )
        .await
    }

    pub(super) async fn fingerprint(&mut self) -> Result<String, FailureCode> {
        within(
            statement_timeout(),
            sqlx::query_scalar::<_, String>("SELECT @@server_uuid").fetch_one(&mut self.conn),
        )
        .await
    }

    async fn grants(&mut self, statement: &'static str) -> Result<Vec<String>, FailureCode> {
        let rows = within(
            statement_timeout(),
            sqlx::query(statement).fetch_all(&mut self.conn),
        )
        .await?;
        let mut lines = Vec::with_capacity(rows.len());
        for row in &rows {
            lines.push(text_column(row, 0).await?);
        }
        Ok(lines)
    }

    async fn current_grants(&mut self) -> Result<Vec<GrantLine>, FailureCode> {
        let lines = self.grants("SHOW GRANTS FOR CURRENT_USER()").await?;
        Ok(lines.iter().filter_map(|line| parse_grant(line)).collect())
    }

    /// `PROCESS` plus `CONNECTION_ADMIN` or `SUPER`, granted globally. Read-only.
    async fn can_end_sessions(&mut self) -> Result<bool, FailureCode> {
        let grants = self.current_grants().await?;
        Ok(ends_sessions(&grants))
    }

    pub(super) async fn preflight(&mut self, write: bool) -> Result<PreflightFacts, FailureCode> {
        let grants = self.current_grants().await?;
        let can_create_principal = global_covers(&grants, "CREATE USER");
        let can_end_sessions = ends_sessions(&grants);
        let needed: &[&str] = if write {
            &["SELECT", "INSERT", "UPDATE", "DELETE"]
        } else {
            &["SELECT"]
        };
        let rows = within(
            statement_timeout(),
            sqlx::query("SHOW DATABASES").fetch_all(&mut self.conn),
        )
        .await?;
        let mut namespaces = Vec::new();
        for row in rows.iter().take(256) {
            let name = text_column(row, 0).await?;
            if matches!(
                name.to_ascii_lowercase().as_str(),
                "mysql" | "information_schema" | "performance_schema" | "sys"
            ) {
                continue;
            }
            let grantable = grants.iter().any(|grant| {
                grant.grant_option
                    && match &grant.scope {
                        GrantScope::Global => true,
                        GrantScope::Schema(schema) => schema == &name,
                        GrantScope::Narrow => false,
                    }
                    && covers(&grant.privileges, needed)
            });
            namespaces.push(NamespaceFacts {
                name,
                grantable,
                public_create: false,
            });
        }
        Ok(PreflightFacts {
            can_create_principal,
            can_end_sessions,
            namespaces,
        })
    }

    pub(super) async fn observe(
        &mut self,
        name: &PrincipalName,
    ) -> Result<ObservedPrincipal, FailureCode> {
        let row = within(
            statement_timeout(),
            sqlx::query(
                "SELECT CAST(ATTRIBUTE AS CHAR) AS attribute
                 FROM information_schema.USER_ATTRIBUTES WHERE USER = ? AND HOST = '%'",
            )
            .bind(name.as_str())
            .fetch_optional(&mut self.conn),
        )
        .await?;
        let Some(row) = row else {
            return Ok(ObservedPrincipal {
                name_exists: false,
                marker: None,
                identity: None,
                owned_objects: 0,
                unexpected_memberships: 0,
            });
        };
        let attribute: Option<String> = row.try_get("attribute").map_err(|e| categorize(&e))?;
        let uuid: String = within(
            statement_timeout(),
            sqlx::query_scalar::<_, String>("SELECT @@server_uuid").fetch_one(&mut self.conn),
        )
        .await?;
        // `GRANT <role> TO <user>` lines are the only grants without `ON`. Reading another
        // account's grants needs SELECT on the `mysql` schema, which a plain CREATE USER
        // administrator does not have; the marker and server identity still prove ownership,
        // so an unreadable grant list counts as no foreign membership rather than blocking
        // every later revocation.
        let account = format!("'{}'@'%'", name.as_str());
        let mut memberships = 0u32;
        match within(
            statement_timeout(),
            sqlx::query(AssertSqlSafe(format!("SHOW GRANTS FOR {account}")))
                .fetch_all(&mut self.conn),
        )
        .await
        {
            Ok(grants) => {
                for line in &grants {
                    if !text_column(line, 0).await?.contains(" ON ") {
                        memberships += 1;
                    }
                }
            }
            Err(FailureCode::PermissionDenied) => {}
            Err(code) => return Err(code),
        }
        let identity = Some(ServerIdentity::MysqlServerUuid(uuid));
        Ok(ObservedPrincipal {
            name_exists: true,
            marker: attribute.as_deref().and_then(Marker::from_mysql_attribute),
            identity,
            owned_objects: 0,
            unexpected_memberships: memberships,
        })
    }

    pub(super) async fn execute(&mut self, plan: &[PlannedStatement]) -> Result<(), FailureCode> {
        for statement in plan {
            let sql = statement
                .render(None, None)
                .ok_or(FailureCode::PermissionDenied)?;
            within(
                statement_timeout(),
                sqlx::raw_sql(AssertSqlSafe(sql)).execute(&mut self.conn),
            )
            .await?;
        }
        Ok(())
    }

    pub(super) async fn terminate_sessions(
        &mut self,
        planner: &Planner,
        name: &PrincipalName,
    ) -> Result<bool, FailureCode> {
        // Without PROCESS the process list shows only our own thread, and without
        // CONNECTION_ADMIN or SUPER a KILL of another account's thread is refused.
        if !self.can_end_sessions().await? {
            return Ok(false);
        }
        let statement = planner.sessions_to_terminate(name);
        let mut query = sqlx::query(AssertSqlSafe(statement.sql.clone()));
        for bind in &statement.binds {
            query = query.bind(bind.clone());
        }
        let rows = within(statement_timeout(), query.fetch_all(&mut self.conn)).await?;
        for row in &rows {
            let id: u64 = row.try_get(0).map_err(|e| categorize(&e))?;
            let kill = kill_connection(id);
            // A session that ended on its own (unknown thread id) is already done.
            let _ = within(
                statement_timeout(),
                sqlx::raw_sql(AssertSqlSafe(kill.sql)).execute(&mut self.conn),
            )
            .await;
        }
        Ok(true)
    }

    pub(super) async fn close(self) {
        let _ = self.conn.close().await;
    }
}
