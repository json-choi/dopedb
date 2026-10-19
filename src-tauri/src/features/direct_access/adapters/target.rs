//! Target database adapter: one short-lived administrator connection per action.
//!
//! The endpoint's TLS mode reuses the connection runtime's `sslmode` mapping, an
//! optional `~/.ssh/config` alias is opened with the same system `ssh` tunnel, and the
//! connection is a single sqlx connection (never a pool) closed after the action.
//! Failures leave this module only as a categorical [`FailureCode`]; driver messages,
//! SQL text, and principal names are never logged or returned.

mod mysql;
mod postgres;

use std::time::Duration;

use sqlx::Connection;

use crate::connection::ssh::{self, SshTunnel, SSH_ALIAS_PARAMETER};
use crate::model::{
    ConnectionProfile, Engine, Provider, WorkspaceConnectionAccess, WorkspaceCredentialMode,
};

use super::super::domain::{DirectEngine, FailureCode, PrincipalName};
use super::super::ownership::ObservedPrincipal;
use super::super::plan::{PlannedStatement, Planner};
use super::super::ports::{TargetDatabasePort, TargetSession};
use super::super::types::{AdminCredential, PreflightFacts, TargetEndpoint};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const STATEMENT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Default)]
pub(crate) struct SqlxTargetDatabase;

/// A connected administrator session plus the tunnel that carries it.
pub(crate) struct SqlxTargetSession {
    inner: Inner,
    tunnel: Option<SshTunnel>,
}

enum Inner {
    Postgres(postgres::PostgresSession),
    Mysql(mysql::MysqlSession),
}

/// Map a driver error to its category. Authentication refusals mean the stored
/// administrator credential no longer works; every other server refusal is a
/// permission problem; transport problems are `network`.
pub(super) fn categorize(error: &sqlx::Error) -> FailureCode {
    match error {
        sqlx::Error::Database(database) => match database.code().as_deref() {
            // PostgreSQL invalid_authorization_specification / invalid_password and
            // MySQL ER_ACCESS_DENIED_ERROR.
            Some(code) if code.starts_with("28") || code == "1045" => {
                FailureCode::CredentialMissing
            }
            // duplicate_object / ER_CANNOT_USER.
            Some("42710") | Some("1396") => FailureCode::NameConflict,
            _ => FailureCode::PermissionDenied,
        },
        _ => FailureCode::Network,
    }
}

fn template_profile(endpoint: &TargetEndpoint, credential: &AdminCredential) -> ConnectionProfile {
    let mut extra_params = std::collections::HashMap::new();
    if let Some(alias) = credential.ssh_alias.as_deref() {
        extra_params.insert(SSH_ALIAS_PARAMETER.to_owned(), alias.to_owned());
    }
    ConnectionProfile {
        id: uuid::Uuid::nil(),
        name: String::new(),
        engine: match endpoint.engine {
            DirectEngine::Postgres => Engine::Postgres,
            DirectEngine::Mysql => Engine::Mysql,
        },
        provider: Provider::Generic,
        driver_id: None,
        host: endpoint.host.clone(),
        port: endpoint.port,
        database: endpoint.database.clone(),
        username: credential.username.clone(),
        sslmode: endpoint.sslmode.clone(),
        extra_params,
        readonly_default: false,
        allow_writes: false,
        schema_access_available: false,
        secret_ref: None,
        env: None,
        schema_group: None,
        workspace_access: WorkspaceConnectionAccess::Local,
        credential_mode: WorkspaceCredentialMode::Local,
        provider_target: None,
    }
}

impl TargetDatabasePort for SqlxTargetDatabase {
    type Session = SqlxTargetSession;

    async fn open(
        &self,
        endpoint: &TargetEndpoint,
        credential: &AdminCredential,
    ) -> Result<SqlxTargetSession, FailureCode> {
        let profile = template_profile(endpoint, credential);
        let transport = ssh::open(&profile, &profile)
            .await
            .map_err(|_| FailureCode::Network)?;
        let target = &transport.profile;
        let inner = match endpoint.engine {
            DirectEngine::Postgres => {
                postgres::PostgresSession::connect(target, credential.password.as_str())
                    .await
                    .map(Inner::Postgres)
            }
            DirectEngine::Mysql => {
                mysql::MysqlSession::connect(target, credential.password.as_str())
                    .await
                    .map(Inner::Mysql)
            }
        };
        match inner {
            Ok(inner) => Ok(SqlxTargetSession {
                inner,
                tunnel: transport.tunnel,
            }),
            Err(code) => {
                if let Some(tunnel) = transport.tunnel {
                    tunnel.close().await;
                }
                Err(code)
            }
        }
    }
}

/// Run one driver future under the connect timeout, mapping both outcomes.
pub(super) async fn within<T>(
    limit: Duration,
    future: impl std::future::Future<Output = Result<T, sqlx::Error>>,
) -> Result<T, FailureCode> {
    match tokio::time::timeout(limit, future).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(categorize(&error)),
        Err(_) => Err(FailureCode::Network),
    }
}

pub(super) fn connect_timeout() -> Duration {
    CONNECT_TIMEOUT
}

pub(super) fn statement_timeout() -> Duration {
    STATEMENT_TIMEOUT
}

impl TargetSession for SqlxTargetSession {
    async fn version(&mut self) -> Result<String, FailureCode> {
        match &mut self.inner {
            Inner::Postgres(session) => session.version().await,
            Inner::Mysql(session) => session.version().await,
        }
    }

    async fn fingerprint(&mut self) -> Result<String, FailureCode> {
        match &mut self.inner {
            Inner::Postgres(session) => session.fingerprint().await,
            Inner::Mysql(session) => session.fingerprint().await,
        }
    }

    async fn preflight(&mut self, write: bool) -> Result<PreflightFacts, FailureCode> {
        match &mut self.inner {
            Inner::Postgres(session) => session.preflight(write).await,
            Inner::Mysql(session) => session.preflight(write).await,
        }
    }

    async fn observe(&mut self, name: &PrincipalName) -> Result<ObservedPrincipal, FailureCode> {
        match &mut self.inner {
            Inner::Postgres(session) => session.observe(name).await,
            Inner::Mysql(session) => session.observe(name).await,
        }
    }

    async fn execute(&mut self, plan: &[PlannedStatement]) -> Result<(), FailureCode> {
        match &mut self.inner {
            Inner::Postgres(session) => session.execute(plan).await,
            Inner::Mysql(session) => session.execute(plan).await,
        }
    }

    async fn terminate_sessions(
        &mut self,
        planner: &Planner,
        name: &PrincipalName,
    ) -> Result<bool, FailureCode> {
        match &mut self.inner {
            Inner::Postgres(session) => session.terminate_sessions(planner, name).await,
            Inner::Mysql(session) => session.terminate_sessions(planner, name).await,
        }
    }

    async fn close(self) {
        match self.inner {
            Inner::Postgres(session) => session.close().await,
            Inner::Mysql(session) => session.close().await,
        }
        if let Some(tunnel) = self.tunnel {
            tunnel.close().await;
        }
    }
}

#[allow(dead_code)]
fn _assert_connection_trait<C: Connection>() {}
