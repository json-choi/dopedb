//! Fixed SQL statement plans for direct shared database principals.
//!
//! A [`Planner`] turns an engine, a gated server version, a validated scope, and
//! access levels into an ordered list of statement templates. Nothing here executes
//! SQL. Every interpolated value is a validated literal: principal names match
//! `^dopedb_[0-9a-f]{20}$`, markers are URL-safe, verifiers pass the exact format
//! validators, and MySQL identifiers pass scope validation before the shared
//! backtick quoting. PostgreSQL schema and database identifiers are never quoted
//! here: statements carry the [`SCHEMA_SLOT`] / [`DATABASE_SLOT`] placeholders and
//! name the raw schema, and the adapter substitutes the server's own
//! `quote_ident($1)` / `quote_ident(current_database())` result.

use dopedb_protocol::DatabaseEngine;

use super::domain::{
    AccessLevel, DirectEngine, FailureCode, Marker, PrincipalName, Scope, ServerVersion,
};
use super::verifier::is_valid_verifier;
use crate::ddl::common::quote_identifier;

/// Placeholder replaced with the server-quoted schema named by [`PlannedStatement::schema`].
pub(crate) const SCHEMA_SLOT: &str = "{schema}";
/// Placeholder replaced with the server-quoted `current_database()`.
pub(crate) const DATABASE_SLOT: &str = "{database}";

/// One fixed statement template. `binds` are positional bind parameters (`$1`/`?`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlannedStatement {
    pub(crate) sql: String,
    /// Raw schema to quote through the server and substitute for [`SCHEMA_SLOT`].
    pub(crate) schema: Option<String>,
    /// Whether [`DATABASE_SLOT`] must be substituted.
    pub(crate) uses_database: bool,
    pub(crate) binds: Vec<String>,
}

impl PlannedStatement {
    fn fixed(sql: String) -> Self {
        Self {
            sql,
            schema: None,
            uses_database: false,
            binds: Vec::new(),
        }
    }

    fn database(sql: String) -> Self {
        Self {
            sql,
            schema: None,
            uses_database: true,
            binds: Vec::new(),
        }
    }

    fn per_schema(sql: String, schema: &str) -> Self {
        Self {
            sql,
            schema: Some(schema.to_owned()),
            uses_database: false,
            binds: Vec::new(),
        }
    }

    /// Substitute server-quoted identifiers. Returns `None` when a required one is missing.
    pub(crate) fn render(
        &self,
        quoted_schema: Option<&str>,
        quoted_database: Option<&str>,
    ) -> Option<String> {
        let mut sql = self.sql.clone();
        if self.schema.is_some() {
            sql = sql.replace(SCHEMA_SLOT, quoted_schema?);
        }
        if self.uses_database {
            sql = sql.replace(DATABASE_SLOT, quoted_database?);
        }
        Some(sql)
    }
}

/// Plan builder bound to one supported engine, version, and scope.
#[derive(Debug, Clone)]
pub(crate) struct Planner {
    engine: DirectEngine,
    scope: Scope,
}

impl Planner {
    /// Gate `version` (already parsed by [`ServerVersion::check`]) and bind the scope.
    pub(crate) fn new(
        engine: DirectEngine,
        version: ServerVersion,
        scope: Scope,
    ) -> Result<Self, FailureCode> {
        let floor = match engine {
            DirectEngine::Postgres => (14, 0, 0),
            DirectEngine::Mysql => (8, 0, 21),
        };
        if (version.major, version.minor, version.patch) < floor {
            return Err(FailureCode::VersionUnsupported);
        }
        Ok(Self { engine, scope })
    }

    fn account(&self, name: &PrincipalName) -> String {
        match self.engine {
            DirectEngine::Postgres => quote_identifier(DatabaseEngine::Postgres, name.as_str()),
            DirectEngine::Mysql => format!("'{}'@'%'", name.as_str()),
        }
    }

    fn mysql_database(&self, name: &str) -> String {
        // `_` is a single-character wildcard in GRANT database patterns; escape it so
        // the grant stays exact. `%` and `\` are rejected by scope validation.
        quote_identifier(DatabaseEngine::Mysql, &name.replace('_', "\\_"))
    }

    fn verifier_literal(&self, verifier: &str) -> Result<String, FailureCode> {
        if is_valid_verifier(self.engine.verifier_kind(), verifier) {
            Ok(verifier.to_owned())
        } else {
            Err(FailureCode::PermissionDenied)
        }
    }

    /// Create the principal, mark it, and grant `level`.
    pub(crate) fn create(
        &self,
        name: &PrincipalName,
        marker: &Marker,
        verifier: &str,
        level: AccessLevel,
    ) -> Result<Vec<PlannedStatement>, FailureCode> {
        let verifier = self.verifier_literal(verifier)?;
        let account = self.account(name);
        let mut plan = match self.engine {
            DirectEngine::Postgres => vec![
                PlannedStatement::fixed(format!(
                    "CREATE ROLE {account} LOGIN PASSWORD '{verifier}' NOSUPERUSER NOCREATEDB \
                     NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS"
                )),
                PlannedStatement::fixed(format!(
                    "COMMENT ON ROLE {account} IS '{}'",
                    marker.postgres_comment()
                )),
            ],
            DirectEngine::Mysql => vec![PlannedStatement::fixed(format!(
                "CREATE USER {account} IDENTIFIED WITH caching_sha2_password AS '{verifier}' \
                 ATTRIBUTE '{}'",
                marker.mysql_attribute()
            ))],
        };
        plan.extend(self.change_level(name, AccessLevel::None, level));
        Ok(plan)
    }

    /// Replace the stored verifier (password rotation).
    pub(crate) fn alter_verifier(
        &self,
        name: &PrincipalName,
        verifier: &str,
    ) -> Result<Vec<PlannedStatement>, FailureCode> {
        let verifier = self.verifier_literal(verifier)?;
        let account = self.account(name);
        Ok(vec![PlannedStatement::fixed(match self.engine {
            DirectEngine::Postgres => format!("ALTER ROLE {account} PASSWORD '{verifier}'"),
            DirectEngine::Mysql => format!(
                "ALTER USER {account} IDENTIFIED WITH caching_sha2_password AS '{verifier}'"
            ),
        })])
    }

    /// Statements that move the principal from `from` to `to` (grants when raising,
    /// revokes when lowering). Never DDL, never default privileges.
    pub(crate) fn change_level(
        &self,
        name: &PrincipalName,
        from: AccessLevel,
        to: AccessLevel,
    ) -> Vec<PlannedStatement> {
        if from == to {
            return Vec::new();
        }
        let account = self.account(name);
        let mut plan = Vec::new();
        match self.engine {
            DirectEngine::Postgres => self.postgres_change(&account, from, to, &mut plan),
            DirectEngine::Mysql => self.mysql_change(&account, from, to, &mut plan),
        }
        plan
    }

    /// Re-issue the grants for `level` (picks up tables created after the last apply).
    pub(crate) fn regrant(
        &self,
        name: &PrincipalName,
        level: AccessLevel,
    ) -> Vec<PlannedStatement> {
        self.change_level(name, AccessLevel::None, level)
    }

    fn postgres_change(
        &self,
        account: &str,
        from: AccessLevel,
        to: AccessLevel,
        plan: &mut Vec<PlannedStatement>,
    ) {
        let schemas = self.scope.names();
        if to > from {
            if from == AccessLevel::None {
                plan.push(PlannedStatement::database(format!(
                    "GRANT CONNECT ON DATABASE {DATABASE_SLOT} TO {account}"
                )));
                for schema in schemas {
                    plan.push(PlannedStatement::per_schema(
                        format!("GRANT USAGE ON SCHEMA {SCHEMA_SLOT} TO {account}"),
                        schema,
                    ));
                    plan.push(PlannedStatement::per_schema(
                        format!("GRANT SELECT ON ALL TABLES IN SCHEMA {SCHEMA_SLOT} TO {account}"),
                        schema,
                    ));
                }
            }
            if to == AccessLevel::Write {
                for schema in schemas {
                    plan.push(PlannedStatement::per_schema(
                        format!(
                            "GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {SCHEMA_SLOT} \
                             TO {account}"
                        ),
                        schema,
                    ));
                    plan.push(PlannedStatement::per_schema(
                        format!(
                            "GRANT USAGE ON ALL SEQUENCES IN SCHEMA {SCHEMA_SLOT} TO {account}"
                        ),
                        schema,
                    ));
                }
            }
            return;
        }
        if from == AccessLevel::Write {
            for schema in schemas {
                plan.push(PlannedStatement::per_schema(
                    format!(
                        "REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {SCHEMA_SLOT} \
                         FROM {account}"
                    ),
                    schema,
                ));
                plan.push(PlannedStatement::per_schema(
                    format!("REVOKE USAGE ON ALL SEQUENCES IN SCHEMA {SCHEMA_SLOT} FROM {account}"),
                    schema,
                ));
            }
        }
        if to == AccessLevel::None {
            for schema in schemas {
                plan.push(PlannedStatement::per_schema(
                    format!("REVOKE SELECT ON ALL TABLES IN SCHEMA {SCHEMA_SLOT} FROM {account}"),
                    schema,
                ));
                plan.push(PlannedStatement::per_schema(
                    format!("REVOKE USAGE ON SCHEMA {SCHEMA_SLOT} FROM {account}"),
                    schema,
                ));
            }
            plan.push(PlannedStatement::database(format!(
                "REVOKE CONNECT ON DATABASE {DATABASE_SLOT} FROM {account}"
            )));
        }
    }

    fn mysql_change(
        &self,
        account: &str,
        from: AccessLevel,
        to: AccessLevel,
        plan: &mut Vec<PlannedStatement>,
    ) {
        for database in self.scope.names() {
            let target = format!("{}.*", self.mysql_database(database));
            let statement = if to > from {
                let privileges = match (from, to) {
                    (AccessLevel::None, AccessLevel::Read) => "SELECT",
                    (AccessLevel::None, _) => "SELECT, INSERT, UPDATE, DELETE",
                    _ => "INSERT, UPDATE, DELETE",
                };
                format!("GRANT {privileges} ON {target} TO {account}")
            } else {
                let privileges = match (from, to) {
                    (_, AccessLevel::None) if from == AccessLevel::Read => "SELECT",
                    (_, AccessLevel::None) => "SELECT, INSERT, UPDATE, DELETE",
                    _ => "INSERT, UPDATE, DELETE",
                };
                format!("REVOKE {privileges} ON {target} FROM {account}")
            };
            plan.push(PlannedStatement::fixed(statement));
        }
    }

    /// Stop new logins before revocation when the admin cannot terminate sessions.
    pub(crate) fn lock(&self, name: &PrincipalName) -> PlannedStatement {
        let account = self.account(name);
        PlannedStatement::fixed(match self.engine {
            DirectEngine::Postgres => format!("ALTER ROLE {account} NOLOGIN"),
            DirectEngine::Mysql => format!("ALTER USER {account} ACCOUNT LOCK"),
        })
    }

    /// Undo [`Planner::lock`] when a previously revoked principal is granted again.
    pub(crate) fn unlock(&self, name: &PrincipalName) -> PlannedStatement {
        let account = self.account(name);
        PlannedStatement::fixed(match self.engine {
            DirectEngine::Postgres => format!("ALTER ROLE {account} LOGIN"),
            DirectEngine::Mysql => format!("ALTER USER {account} ACCOUNT UNLOCK"),
        })
    }

    /// Revoke everything granted at `applied`, then drop the principal.
    pub(crate) fn drop_principal(
        &self,
        name: &PrincipalName,
        applied: AccessLevel,
    ) -> Vec<PlannedStatement> {
        let mut plan = Vec::new();
        if self.engine == DirectEngine::Postgres {
            // PostgreSQL refuses DROP ROLE while privileges remain.
            plan.extend(self.change_level(name, applied, AccessLevel::None));
            plan.push(PlannedStatement::fixed(format!(
                "DROP ROLE {}",
                self.account(name)
            )));
        } else {
            plan.push(PlannedStatement::fixed(format!(
                "DROP USER {}",
                self.account(name)
            )));
        }
        plan
    }

    /// Select the session identifiers of the principal. PostgreSQL terminates in the
    /// same statement (one `pg_terminate_backend` row per session); MySQL returns
    /// connection ids for [`kill_connection`].
    pub(crate) fn sessions_to_terminate(&self, name: &PrincipalName) -> PlannedStatement {
        let (sql, binds) = match self.engine {
            DirectEngine::Postgres => (
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
                 WHERE usename = $1 AND pid <> pg_backend_pid()",
                vec![name.as_str().to_owned()],
            ),
            DirectEngine::Mysql => (
                "SELECT ID FROM information_schema.PROCESSLIST WHERE USER = ? AND ID <> CONNECTION_ID()",
                vec![name.as_str().to_owned()],
            ),
        };
        PlannedStatement {
            sql: sql.to_owned(),
            schema: None,
            uses_database: false,
            binds,
        }
    }
}

/// MySQL `KILL CONNECTION` for one id returned by [`Planner::sessions_to_terminate`].
pub(crate) fn kill_connection(id: u64) -> PlannedStatement {
    PlannedStatement::fixed(format!("KILL CONNECTION {id}"))
}
