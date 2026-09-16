//! Connection domain values and invariants.
//!
//! This module deliberately has no knowledge of Tauri, SQLite, the keychain, live
//! pools, or the driver installer. It owns the rules that every transport must use.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::kernel::connection_failure::{classify_connection_failure, ConnectionFailure};
use crate::kernel::identity::ConnectionId;
use crate::model::{ConnectionProfile, Engine};

pub(crate) const MAX_CONNECTION_CREDENTIAL_BYTES: usize = 1 << 16;

/// Connection probes resolve to a receipt so the frontend never has to classify
/// driver message text. The classification and its privacy-safe `detail` come from
/// [`crate::kernel::connection_failure`], the one contract every exposure path
/// shares; secrets, connection URLs, and OS output are excluded there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionTestReceipt {
    ok: bool,
    failure: Option<ConnectionFailure>,
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
                failure: Some(classify_connection_failure(&error)),
            },
        }
    }
}

#[cfg(test)]
pub(crate) fn assert_connection_test_failure_contract() {
    use crate::kernel::connection_failure::{
        classify_database_identity, ConnectionFailureCode, ConnectionFailureDetail,
        ConnectionFailureField,
    };

    crate::connection::ssh::assert_ssh_failure_classification_contract();
    assert_eq!(
        classify_database_identity(Some("28P01"), None),
        (
            ConnectionFailureCode::Authentication,
            Some(ConnectionFailureField::Credentials),
            ConnectionFailureDetail::ServerRejectedLogin,
        ),
    );
    // The same class still resolves to a detail, one class wider.
    assert_eq!(
        classify_database_identity(Some("28000"), None),
        (
            ConnectionFailureCode::Authentication,
            Some(ConnectionFailureField::Credentials),
            ConnectionFailureDetail::ServerRejectedAuthorization,
        ),
    );
    assert_eq!(
        classify_database_identity(Some("08006"), None),
        (
            ConnectionFailureCode::TimeoutNetwork,
            None,
            ConnectionFailureDetail::ServerConnectionLostBeforeReady,
        ),
    );
    assert_eq!(
        classify_database_identity(Some("3D000"), None),
        (
            ConnectionFailureCode::DatabaseConfig,
            Some(ConnectionFailureField::Database),
            ConnectionFailureDetail::ServerMissingDatabase,
        ),
    );
    assert_eq!(
        classify_database_identity(None, Some(1_049)),
        (
            ConnectionFailureCode::DatabaseConfig,
            Some(ConnectionFailureField::Database),
            ConnectionFailureDetail::ServerMissingDatabase,
        ),
    );
    // An unrecognized identity reads like unrecognized `ssh` output: the server
    // does not get to choose the detail a screen translates.
    assert_eq!(
        classify_database_identity(Some("XX000"), None),
        (
            ConnectionFailureCode::Unknown,
            None,
            ConnectionFailureDetail::Unclassified,
        ),
    );
    assert_eq!(
        classify_database_identity(None, None),
        (
            ConnectionFailureCode::Unknown,
            None,
            ConnectionFailureDetail::Unclassified,
        ),
    );
    assert_eq!(
        classify_connection_failure(&AppError::Timeout("probe".into())).code,
        ConnectionFailureCode::TimeoutNetwork,
    );
    assert_eq!(
        classify_connection_failure(&AppError::AuthenticationRequired("Google Cloud".into())),
        ConnectionFailure {
            code: ConnectionFailureCode::Authentication,
            field: Some(ConnectionFailureField::Credentials),
            detail: ConnectionFailureDetail::CredentialNotAuthenticated,
        },
    );
    assert_eq!(
        classify_connection_failure(&AppError::Db(sqlx::Error::Tls(Box::new(
            std::io::Error::other("certificate detail must not serialize"),
        ))))
        .code,
        ConnectionFailureCode::Tls,
    );
    assert_eq!(
        classify_connection_failure(&AppError::NotFound("connection".into())).code,
        ConnectionFailureCode::Unknown,
    );
    assert_eq!(
        classify_connection_failure(&AppError::Config("secret=must-not-serialize".into())).detail,
        ConnectionFailureDetail::DriverRejectedConfiguration,
    );
    let success = serde_json::to_value(ConnectionTestReceipt::from_result(Ok(()))).unwrap();
    assert_eq!(success, serde_json::json!({"ok": true, "failure": null}));
    let failure = serde_json::to_value(ConnectionTestReceipt::from_result(Err(AppError::Timeout(
        "probe".into(),
    ))))
    .unwrap();
    assert_eq!(failure["failure"]["code"], "timeoutNetwork");
    assert_eq!(failure["failure"]["field"], serde_json::Value::Null);

    // The Explorer reads the same classification off a serialized `AppError`, so a
    // configuration string that must not be shown never becomes its only diagnostic.
    let wire = serde_json::to_value(AppError::Config("secret=must-not-serialize".into())).unwrap();
    assert_eq!(wire["connectionFailure"]["code"], "databaseConfig");
    assert_eq!(
        wire["connectionFailure"]["detail"],
        "driverRejectedConfiguration"
    );
    // A statement-policy decision is not a reachability cause and carries no payload.
    let policy = serde_json::to_value(AppError::SqlPolicyBlocked { position: None }).unwrap();
    assert_eq!(policy.get("connectionFailure"), None);
    assert_driver_message_stays_off_the_wire();
}

/// A driver message names application identities. PostgreSQL and MySQL put a user,
/// database, or table name straight into it, so the receipt is built from the
/// driver's SQLSTATE identity and never from its text.
#[cfg(test)]
fn assert_driver_message_stays_off_the_wire() {
    use crate::kernel::connection_failure::{ConnectionFailureCode, ConnectionFailureDetail};
    use std::borrow::Cow;

    #[derive(Debug, thiserror::Error)]
    #[error("{message}")]
    struct DriverFailure {
        code: Option<&'static str>,
        message: &'static str,
    }

    impl sqlx::error::DatabaseError for DriverFailure {
        fn message(&self) -> &str {
            self.message
        }
        fn code(&self) -> Option<Cow<'_, str>> {
            self.code.map(Cow::Borrowed)
        }
        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    for (sqlstate, message, code, detail, wire_detail) in [
        (
            Some("28P01"),
            "password authentication failed for user \"prod_admin\"",
            ConnectionFailureCode::Authentication,
            ConnectionFailureDetail::ServerRejectedLogin,
            "serverRejectedLogin",
        ),
        (
            Some("3D000"),
            "database \"prod_customers\" does not exist",
            ConnectionFailureCode::DatabaseConfig,
            ConnectionFailureDetail::ServerMissingDatabase,
            "serverMissingDatabase",
        ),
        (
            Some("42501"),
            "permission denied for table payroll_salaries",
            ConnectionFailureCode::Unknown,
            ConnectionFailureDetail::Unclassified,
            "unclassified",
        ),
    ] {
        let error = AppError::Db(sqlx::Error::Database(Box::new(DriverFailure {
            code: sqlstate,
            message,
        })));
        let failure = classify_connection_failure(&error);
        assert_eq!(failure.code, code);
        assert_eq!(failure.detail, detail);
        let wire = serde_json::to_value(&error).unwrap();
        assert_eq!(wire["connectionFailure"]["detail"], wire_detail);
        for identifier in ["prod_admin", "prod_customers", "payroll_salaries"] {
            assert!(
                !wire["connectionFailure"].to_string().contains(identifier),
                "driver message leaked into the connection failure payload",
            );
        }
    }
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
