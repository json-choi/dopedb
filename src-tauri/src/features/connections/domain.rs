//! Connection domain values and invariants.
//!
//! This module deliberately has no knowledge of Tauri, SQLite, the keychain, live
//! pools, or the driver installer. It owns the rules that every transport must use.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::kernel::identity::ConnectionId;
use crate::model::{ConnectionProfile, Engine};

pub(crate) const MAX_CONNECTION_CREDENTIAL_BYTES: usize = 1 << 16;
const MAX_CONNECTION_TEST_DETAIL_CHARS: usize = 2_048;

/// Stable, privacy-safe connection probe categories consumed by the editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionTestFailureCode {
    TimeoutNetwork,
    Authentication,
    Tls,
    DatabaseConfig,
    Unknown,
}

/// A field is returned only when the driver error identifies it without guessing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionTestFailureField {
    Credentials,
    Tls,
    Database,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionTestFailure {
    code: ConnectionTestFailureCode,
    field: Option<ConnectionTestFailureField>,
    detail: String,
}

/// Connection probes resolve to a receipt so the frontend never has to classify
/// driver message text. Secrets and connection URLs are excluded from `detail`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionTestReceipt {
    ok: bool,
    failure: Option<ConnectionTestFailure>,
}

impl ConnectionTestReceipt {
    pub(crate) fn from_result(result: AppResult<()>) -> Self {
        match result {
            Ok(()) => Self {
                ok: true,
                failure: None,
            },
            Err(error) => Self {
                ok: false,
                failure: Some(connection_test_failure(&error)),
            },
        }
    }
}

fn connection_test_failure(error: &AppError) -> ConnectionTestFailure {
    let (code, field) = match error {
        AppError::Timeout(_) | AppError::Network(_) | AppError::Io(_) => {
            (ConnectionTestFailureCode::TimeoutNetwork, None)
        }
        AppError::Db(sqlx::Error::PoolTimedOut | sqlx::Error::Io(_)) => {
            (ConnectionTestFailureCode::TimeoutNetwork, None)
        }
        AppError::Db(sqlx::Error::Tls(_)) => (
            ConnectionTestFailureCode::Tls,
            Some(ConnectionTestFailureField::Tls),
        ),
        AppError::Db(sqlx::Error::Database(database)) => {
            classify_database_failure(database.as_ref())
        }
        AppError::AuthenticationRequired(_) | AppError::ManagedConnectionRecoveryRequired => (
            ConnectionTestFailureCode::Authentication,
            Some(ConnectionTestFailureField::Credentials),
        ),
        AppError::Config(_) => (ConnectionTestFailureCode::DatabaseConfig, None),
        _ => (ConnectionTestFailureCode::Unknown, None),
    };
    ConnectionTestFailure {
        code,
        field,
        detail: safe_connection_test_detail(error),
    }
}

fn classify_database_failure(
    database: &(dyn sqlx::error::DatabaseError + 'static),
) -> (
    ConnectionTestFailureCode,
    Option<ConnectionTestFailureField>,
) {
    let sqlstate = database.code();
    let sqlstate = sqlstate.as_deref();
    let mysql_number = database
        .try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()
        .map(sqlx::mysql::MySqlDatabaseError::number);
    classify_database_identity(sqlstate, mysql_number)
}

fn classify_database_identity(
    sqlstate: Option<&str>,
    mysql_number: Option<u16>,
) -> (
    ConnectionTestFailureCode,
    Option<ConnectionTestFailureField>,
) {
    if sqlstate.is_some_and(|code| code.starts_with("28"))
        || matches!(mysql_number, Some(1_044 | 1_045))
    {
        return (
            ConnectionTestFailureCode::Authentication,
            Some(ConnectionTestFailureField::Credentials),
        );
    }
    if sqlstate.is_some_and(|code| code.starts_with("08")) {
        return (ConnectionTestFailureCode::TimeoutNetwork, None);
    }
    if sqlstate.is_some_and(|code| code.starts_with("3D")) || mysql_number == Some(1_049) {
        return (
            ConnectionTestFailureCode::DatabaseConfig,
            Some(ConnectionTestFailureField::Database),
        );
    }
    (ConnectionTestFailureCode::Unknown, None)
}

fn safe_connection_test_detail(error: &AppError) -> String {
    let detail = match error {
        AppError::Db(sqlx::Error::Database(database)) => database.message(),
        AppError::Db(sqlx::Error::PoolTimedOut) => {
            "the connection attempt exhausted its bounded pool deadline"
        }
        AppError::Db(sqlx::Error::Io(io)) => match io.kind() {
            std::io::ErrorKind::TimedOut => "the network connection timed out",
            std::io::ErrorKind::ConnectionRefused => "the network connection was refused",
            std::io::ErrorKind::ConnectionReset => "the network connection was reset",
            std::io::ErrorKind::NotFound => "the network target was not found",
            _ => "the network connection failed",
        },
        AppError::Db(sqlx::Error::Tls(_)) => "TLS negotiation or certificate verification failed",
        AppError::Timeout(_) => "the bounded connection attempt timed out",
        AppError::Network(_) | AppError::Io(_) => "the network connection failed",
        AppError::AuthenticationRequired(_) => {
            "the connection credential is no longer authenticated"
        }
        AppError::ManagedConnectionRecoveryRequired => {
            "the managed workspace connection requires provider repair"
        }
        AppError::Config(_) => "the driver rejected the connection configuration",
        AppError::Keychain(_) => "the OS credential store could not supply this connection",
        AppError::Mongo(_) => "the MongoDB driver rejected the connection",
        _ => "the driver did not provide a safe diagnostic",
    };
    detail
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\t'))
        .take(MAX_CONNECTION_TEST_DETAIL_CHARS)
        .collect()
}

#[cfg(test)]
pub(crate) fn assert_connection_test_failure_contract() {
    assert_eq!(
        classify_database_identity(Some("28P01"), None),
        (
            ConnectionTestFailureCode::Authentication,
            Some(ConnectionTestFailureField::Credentials),
        ),
    );
    assert_eq!(
        classify_database_identity(Some("08006"), None).0,
        ConnectionTestFailureCode::TimeoutNetwork,
    );
    assert_eq!(
        classify_database_identity(None, Some(1_049)),
        (
            ConnectionTestFailureCode::DatabaseConfig,
            Some(ConnectionTestFailureField::Database),
        ),
    );
    assert_eq!(
        connection_test_failure(&AppError::Timeout("probe".into())).code,
        ConnectionTestFailureCode::TimeoutNetwork,
    );
    assert_eq!(
        connection_test_failure(&AppError::AuthenticationRequired("Google Cloud".into())),
        ConnectionTestFailure {
            code: ConnectionTestFailureCode::Authentication,
            field: Some(ConnectionTestFailureField::Credentials),
            detail: "the connection credential is no longer authenticated".into(),
        },
    );
    assert_eq!(
        connection_test_failure(&AppError::Db(sqlx::Error::Tls(Box::new(
            std::io::Error::other("certificate detail must not serialize"),
        ))))
        .code,
        ConnectionTestFailureCode::Tls,
    );
    assert_eq!(
        connection_test_failure(&AppError::NotFound("connection".into())).code,
        ConnectionTestFailureCode::Unknown,
    );
    assert_eq!(
        connection_test_failure(&AppError::Config("secret=must-not-serialize".into())).detail,
        "the driver rejected the connection configuration",
    );
    let success = serde_json::to_value(ConnectionTestReceipt::from_result(Ok(()))).unwrap();
    assert_eq!(success, serde_json::json!({"ok": true, "failure": null}));
    let failure = serde_json::to_value(ConnectionTestReceipt::from_result(Err(AppError::Timeout(
        "probe".into(),
    ))))
    .unwrap();
    assert_eq!(failure["failure"]["code"], "timeoutNetwork");
    assert_eq!(failure["failure"]["field"], serde_json::Value::Null);
}

/// How a driver reaches the local installation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DriverInstallMode {
    Bundled,
    Managed,
    /// Installed and authenticated by the operating-system user outside DopeDB.
    System,
}

/// Current local availability of a driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DriverInstallState {
    Installed,
    Available,
    Planned,
}

/// Capabilities exposed by a driver adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DriverCapability {
    Sql,
    DocumentQuery,
    Transactions,
    Introspection,
    Collections,
    SchemaDiff,
    Monitoring,
}

/// Serializable driver metadata used by the connection form and runtime resolver.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverDescriptor {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) engine: Engine,
    pub(crate) version: String,
    pub(crate) install_mode: DriverInstallMode,
    pub(crate) install_state: DriverInstallState,
    pub(crate) supported_providers: Vec<crate::model::Provider>,
    pub(crate) capabilities: Vec<DriverCapability>,
    pub(crate) recommended: bool,
}

/// A connection projection safe to serialize for an agent transport.
///
/// The allowlist intentionally has no provider, driver, network host/port, user,
/// credential reference, workspace/account authority, or provider parameters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentConnectionSummary {
    pub(crate) id: ConnectionId,
    pub(crate) name: String,
    pub(crate) engine: Engine,
    pub(crate) database: String,
    pub(crate) environment: Option<String>,
    pub(crate) readonly: bool,
    pub(crate) allow_writes: bool,
}

impl From<&ConnectionProfile> for AgentConnectionSummary {
    fn from(profile: &ConnectionProfile) -> Self {
        Self {
            id: profile.id.into(),
            name: profile.name.clone(),
            engine: profile.engine,
            database: profile.database.clone(),
            environment: profile.env.clone(),
            readonly: profile.readonly_default,
            allow_writes: profile.allow_writes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CliConnectionResolutionError {
    NoMatch,
    Ambiguous {
        candidates: Vec<AgentConnectionSummary>,
    },
}

impl fmt::Display for CliConnectionResolutionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoMatch => formatter.write_str("no connection matches the exact selector"),
            Self::Ambiguous { .. } => {
                formatter.write_str("the exact connection name matches more than one connection")
            }
        }
    }
}

impl std::error::Error for CliConnectionResolutionError {}

pub(crate) fn normalize_schema_group(schema_group: Option<String>) -> Option<String> {
    schema_group.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    })
}

pub(crate) fn validate_schema_group_engine(
    profile: &ConnectionProfile,
    connections: &[ConnectionProfile],
) -> AppResult<()> {
    let Some(group) = profile.schema_group.as_deref() else {
        return Ok(());
    };
    if profile.engine == Engine::Bigquery {
        return Err(AppError::Blocked {
            reason:
                "BigQuery schema grouping is unavailable until its schema-diff contract is verified"
                    .into(),
        });
    }
    let incompatible = connections.iter().any(|connection| {
        connection.id != profile.id
            && connection
                .schema_group
                .as_deref()
                .is_some_and(|candidate| candidate.trim().eq_ignore_ascii_case(group))
            && connection.engine != profile.engine
    });
    if incompatible {
        return Err(AppError::Config(format!(
            "schema group '{group}' already contains a different database engine"
        )));
    }
    Ok(())
}

pub(crate) fn resolve_cli_name(
    summaries: &[AgentConnectionSummary],
    name: &str,
) -> Result<AgentConnectionSummary, CliConnectionResolutionError> {
    let mut candidates = summaries
        .iter()
        .filter(|summary| summary.name == name)
        .cloned()
        .collect::<Vec<_>>();
    candidates.sort_by_key(|summary| summary.id);
    match candidates.as_slice() {
        [only] => Ok(only.clone()),
        [] => Err(CliConnectionResolutionError::NoMatch),
        _ => Err(CliConnectionResolutionError::Ambiguous { candidates }),
    }
}
