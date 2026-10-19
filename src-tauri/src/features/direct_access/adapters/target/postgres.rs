//! PostgreSQL administrator session: reads, observation, and plan execution.

use sqlx::postgres::{PgConnectOptions, PgConnection};
use sqlx::{AssertSqlSafe, Connection, Row};

use crate::connection::pool::pg_ssl_mode;
use crate::model::ConnectionProfile;

use super::super::super::domain::{FailureCode, Marker, PrincipalName};
use super::super::super::ownership::{ObservedPrincipal, ServerIdentity};
use super::super::super::plan::{PlannedStatement, Planner};
use super::super::super::types::{NamespaceFacts, PreflightFacts};
use super::{categorize, connect_timeout, statement_timeout, within};

pub(super) struct PostgresSession {
    conn: PgConnection,
}

impl PostgresSession {
    pub(super) async fn connect(
        profile: &ConnectionProfile,
        password: &str,
    ) -> Result<Self, FailureCode> {
        let options = PgConnectOptions::new()
            .host(&profile.host)
            .port(profile.port)
            .database(&profile.database)
            .username(&profile.username)
            .password(password)
            .ssl_mode(pg_ssl_mode(&profile.sslmode).map_err(|_| FailureCode::Network)?)
            .options([
                ("statement_timeout", "60000"),
                ("application_name", "dopedb"),
            ]);
        let mut conn = within(connect_timeout(), PgConnection::connect_with(&options)).await?;
        let _ = statement_timeout();
        // Administrator work is never part of a read-only session.
        within(
            statement_timeout(),
            sqlx::query("SET default_transaction_read_only = off").execute(&mut conn),
        )
        .await?;
        Ok(Self { conn })
    }

    pub(super) async fn version(&mut self) -> Result<String, FailureCode> {
        within(
            statement_timeout(),
            sqlx::query_scalar::<_, String>("SELECT current_setting('server_version_num')")
                .fetch_one(&mut self.conn),
        )
        .await
    }

    pub(super) async fn fingerprint(&mut self) -> Result<String, FailureCode> {
        within(
            statement_timeout(),
            sqlx::query_scalar::<_, String>(
                "SELECT oid::text FROM pg_database WHERE datname = current_database()",
            )
            .fetch_one(&mut self.conn),
        )
        .await
    }

    pub(super) async fn preflight(&mut self, write: bool) -> Result<PreflightFacts, FailureCode> {
        let (superuser, create_role, database_grantable): (bool, bool, bool) = within(
            statement_timeout(),
            sqlx::query_as(
                "SELECT r.rolsuper, r.rolcreaterole,
                        has_database_privilege(current_user, current_database(), 'CONNECT WITH GRANT OPTION')
                        OR pg_has_role(current_user,
                             (SELECT datdba FROM pg_database WHERE datname = current_database()),
                             'USAGE')
                 FROM pg_roles r WHERE r.rolname = current_user",
            )
            .fetch_one(&mut self.conn),
        )
        .await?;
        let rows = within(
            statement_timeout(),
            sqlx::query(
                "SELECT n.nspname,
                        (r.rolsuper
                         OR ((pg_has_role(current_user, n.nspowner, 'USAGE')
                              OR has_schema_privilege(current_user, n.oid, 'USAGE WITH GRANT OPTION'))
                             AND NOT EXISTS (
                                 SELECT 1 FROM pg_class c
                                 WHERE c.relnamespace = n.oid
                                   AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                                   AND NOT (pg_has_role(current_user, c.relowner, 'USAGE')
                                            OR (has_table_privilege(current_user, c.oid, 'SELECT WITH GRANT OPTION')
                                                AND (NOT $1
                                                     OR (has_table_privilege(current_user, c.oid, 'INSERT WITH GRANT OPTION')
                                                         AND has_table_privilege(current_user, c.oid, 'UPDATE WITH GRANT OPTION')
                                                         AND has_table_privilege(current_user, c.oid, 'DELETE WITH GRANT OPTION'))))))))
                        AS grantable,
                        EXISTS (SELECT 1
                                FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
                                WHERE a.grantee = 0 AND a.privilege_type = 'CREATE') AS public_create
                 FROM pg_namespace n, pg_roles r
                 WHERE r.rolname = current_user
                   AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
                 ORDER BY n.nspname LIMIT 256",
            )
            .bind(write)
            .fetch_all(&mut self.conn),
        )
        .await?;
        let namespaces = rows
            .iter()
            .map(|row| {
                Ok(NamespaceFacts {
                    name: row.try_get("nspname").map_err(|e| categorize(&e))?,
                    grantable: row
                        .try_get::<bool, _>("grantable")
                        .map_err(|e| categorize(&e))?
                        && (superuser || database_grantable),
                    public_create: row.try_get("public_create").map_err(|e| categorize(&e))?,
                })
            })
            .collect::<Result<Vec<_>, FailureCode>>()?;
        Ok(PreflightFacts {
            can_create_principal: superuser || create_role,
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
                "SELECT r.oid::bigint AS oid, d.description,
                        (SELECT count(*) FROM pg_shdepend s
                          WHERE s.refclassid = 'pg_authid'::regclass
                            AND s.refobjid = r.oid AND s.deptype = 'o') AS owned,
                        (SELECT count(*) FROM pg_auth_members m
                          WHERE (m.member = r.oid
                                 OR (m.roleid = r.oid
                                     AND m.member <> (SELECT oid FROM pg_roles WHERE rolname = current_user)))
                        ) AS memberships
                 FROM pg_roles r
                 LEFT JOIN pg_shdescription d
                   ON d.objoid = r.oid AND d.classoid = 'pg_authid'::regclass
                 WHERE r.rolname = $1",
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
        let oid: i64 = row.try_get("oid").map_err(|e| categorize(&e))?;
        let description: Option<String> = row.try_get("description").map_err(|e| categorize(&e))?;
        let owned: i64 = row.try_get("owned").map_err(|e| categorize(&e))?;
        let memberships: i64 = row.try_get("memberships").map_err(|e| categorize(&e))?;
        let identity = u32::try_from(oid).ok().map(ServerIdentity::PostgresRoleOid);
        Ok(ObservedPrincipal {
            name_exists: true,
            marker: description
                .as_deref()
                .and_then(Marker::from_postgres_comment),
            identity,
            owned_objects: u64::try_from(owned).unwrap_or(u64::MAX),
            unexpected_memberships: u32::try_from(memberships).unwrap_or(u32::MAX),
        })
    }

    pub(super) async fn execute(&mut self, plan: &[PlannedStatement]) -> Result<(), FailureCode> {
        // Resolve every identifier through the server's own quoting first.
        let mut rendered = Vec::with_capacity(plan.len());
        let mut database: Option<String> = None;
        for statement in plan {
            let quoted_schema = match statement.schema.as_deref() {
                Some(schema) => Some(
                    within(
                        statement_timeout(),
                        sqlx::query_scalar::<_, String>("SELECT quote_ident($1)")
                            .bind(schema)
                            .fetch_one(&mut self.conn),
                    )
                    .await?,
                ),
                None => None,
            };
            if statement.uses_database && database.is_none() {
                database = Some(
                    within(
                        statement_timeout(),
                        sqlx::query_scalar::<_, String>("SELECT quote_ident(current_database())")
                            .fetch_one(&mut self.conn),
                    )
                    .await?,
                );
            }
            rendered.push(
                statement
                    .render(quoted_schema.as_deref(), database.as_deref())
                    .ok_or(FailureCode::PermissionDenied)?,
            );
        }
        let mut transaction = within(statement_timeout(), self.conn.begin()).await?;
        for sql in rendered {
            within(
                statement_timeout(),
                sqlx::query(AssertSqlSafe(sql)).execute(&mut *transaction),
            )
            .await?;
        }
        within(statement_timeout(), transaction.commit()).await
    }

    pub(super) async fn terminate_sessions(
        &mut self,
        planner: &Planner,
        name: &PrincipalName,
    ) -> Result<(), FailureCode> {
        let borrowed = planner.borrowed_membership(name);
        if let Some((grant, _)) = &borrowed {
            // Refused when the administrator is allowed to signal anyway (or cannot
            // grant); the termination below then decides.
            let _ = self.execute(std::slice::from_ref(grant)).await;
        }
        let statement = planner.sessions_to_terminate(name);
        let mut query = sqlx::query(AssertSqlSafe(statement.sql.clone()));
        for bind in &statement.binds {
            query = query.bind(bind.clone());
        }
        let ended = within(statement_timeout(), query.fetch_all(&mut self.conn))
            .await
            .map(|_| ());
        if let Some((_, revoke)) = &borrowed {
            let _ = self.execute(std::slice::from_ref(revoke)).await;
        }
        ended
    }

    pub(super) async fn close(self) {
        let _ = self.conn.close().await;
    }
}
