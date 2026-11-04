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
            environment: profile.effective_env.map(|kind| kind.as_str().to_owned()),
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

/// Loopback host used by local listener discovery. Discovery never widens to
/// another address: a remote server is reached only through a profile the user
/// typed by hand.
pub(crate) const LOCAL_LISTENER_HOST: &str = "127.0.0.1";

/// One loopback candidate that local listener discovery may probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LocalListenerTarget {
    pub(crate) engine: Engine,
    pub(crate) port: u16,
}

/// The closed allowlist local listener discovery probes. Adding an entry is a
/// product decision (`PD-43`), not a configuration value: discovery must never
/// sweep a port range, a local network, or a container runtime.
pub(crate) const LOCAL_LISTENER_TARGETS: [LocalListenerTarget; 3] = [
    LocalListenerTarget {
        engine: Engine::Postgres,
        port: 5432,
    },
    LocalListenerTarget {
        engine: Engine::Mysql,
        port: 3306,
    },
    LocalListenerTarget {
        engine: Engine::Mongodb,
        port: 27017,
    },
];

/// One database server that answered a credential-free handshake on loopback.
/// This is a suggestion for the connection editor: it carries no credential,
/// names no database, and grants no authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDatabaseListener {
    pub(crate) engine: Engine,
    pub(crate) host: String,
    pub(crate) port: u16,
    /// Server version, only when the protocol reports it before authentication.
    pub(crate) server_version: Option<String>,
}

/// Longest server version a suggestion may carry, so an unexpected answer on
/// an allowlisted port cannot push arbitrary text into the connection editor.
const MAX_SERVER_VERSION_CHARS: usize = 64;

impl LocalDatabaseListener {
    /// Builds a suggestion for one allowlisted candidate. The reported version
    /// is accepted only when it is short, printable text; anything else is
    /// dropped rather than shown.
    pub(crate) fn new(target: LocalListenerTarget, reported_version: Option<&str>) -> Self {
        Self {
            engine: target.engine,
            host: LOCAL_LISTENER_HOST.into(),
            port: target.port,
            server_version: reported_version.and_then(readable_server_version),
        }
    }
}

fn readable_server_version(reported: &str) -> Option<String> {
    let version = reported.trim();
    if version.is_empty()
        || version.chars().count() > MAX_SERVER_VERSION_CHARS
        || version.chars().any(char::is_control)
    {
        return None;
    }
    Some(version.to_owned())
}

/// Local listener discovery may only ever look at loopback, at the closed
/// engine/port allowlist `PD-44` names, and may only surface short printable
/// version text. Widening any of these is a product decision, so the contract
/// is asserted rather than left to review.
#[cfg(test)]
pub(crate) fn assert_local_listener_discovery_contract() {
    assert_eq!(LOCAL_LISTENER_HOST, "127.0.0.1");
    assert_eq!(
        LOCAL_LISTENER_TARGETS
            .iter()
            .map(|target| (target.engine, target.port))
            .collect::<Vec<_>>(),
        vec![
            (Engine::Postgres, 5432),
            (Engine::Mysql, 3306),
            (Engine::Mongodb, 27017),
        ],
    );

    let target = LOCAL_LISTENER_TARGETS[1];
    let suggestion = LocalDatabaseListener::new(target, Some("8.0.36-0ubuntu0.22.04.1  "));
    assert_eq!(suggestion.host, "127.0.0.1");
    assert_eq!(suggestion.port, 3306);
    assert_eq!(
        suggestion.server_version.as_deref(),
        Some("8.0.36-0ubuntu0.22.04.1"),
    );

    for rejected in ["", "   ", "8.4\n2", "\u{1b}[31m8.4"] {
        assert_eq!(
            LocalDatabaseListener::new(target, Some(rejected)).server_version,
            None,
            "a version that is empty or carries control characters must not reach the editor",
        );
    }
    assert_eq!(
        LocalDatabaseListener::new(target, Some(&"9".repeat(MAX_SERVER_VERSION_CHARS + 1)))
            .server_version,
        None,
    );
    assert_eq!(
        LocalDatabaseListener::new(target, None).server_version,
        None
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::environment::EnvironmentKind;

    fn profile(name: &str, engine: Engine, schema_group: Option<&str>) -> ConnectionProfile {
        let mut profile: ConnectionProfile = serde_json::from_value(serde_json::json!({
            "id": uuid::Uuid::new_v4(),
            "name": name,
            "engine": "postgres",
            "host": "db.example.invalid",
            "port": 5432,
            "database": "app",
            "username": "reader",
            "sslmode": "require",
            "readonlyDefault": true,
            "allowWrites": false,
            "secretRef": "keychain-item-must-not-escape"
        }))
        .expect("fixture profile");
        profile.engine = engine;
        profile.schema_group = schema_group.map(str::to_owned);
        profile
    }

    #[test]
    fn schema_groups_and_cli_selectors_never_cross_engines_or_guess() {
        assert_eq!(normalize_schema_group(None), None);
        assert_eq!(normalize_schema_group(Some(" \t ".into())), None);
        assert_eq!(
            normalize_schema_group(Some("  Sales ".into())),
            Some("Sales".into())
        );

        // A schema group compares one engine's schemas; a different engine in the
        // same group (matched case-insensitively and trimmed) is refused.
        let mysql_sales = profile("orders", Engine::Mysql, Some(" SALES "));
        let postgres_sales = profile("ledger", Engine::Postgres, Some("sales"));
        let existing = [mysql_sales.clone(), postgres_sales.clone()];
        assert!(matches!(
            validate_schema_group_engine(
                &profile("new", Engine::Postgres, Some("sales")),
                &existing
            ),
            Err(AppError::Config(_))
        ));
        assert!(validate_schema_group_engine(
            &profile("new", Engine::Postgres, Some("finance")),
            &existing
        )
        .is_ok());
        assert!(
            validate_schema_group_engine(&profile("new", Engine::Mysql, None), &existing).is_ok()
        );
        // Re-validating a saved profile ignores its own stored row.
        let mut moved = mysql_sales.clone();
        moved.engine = Engine::Postgres;
        assert!(validate_schema_group_engine(&moved, &[mysql_sales]).is_ok());
        assert!(matches!(
            validate_schema_group_engine(
                &profile("warehouse", Engine::Bigquery, Some("sales")),
                &[]
            ),
            Err(AppError::Blocked { .. })
        ));
        assert!(
            validate_schema_group_engine(&profile("warehouse", Engine::Bigquery, None), &[])
                .is_ok()
        );

        // The Agent projection carries only the allowlisted fields.
        let mut production = profile("prod", Engine::Postgres, None);
        production.effective_env = Some(EnvironmentKind::Production);
        production.allow_writes = true;
        let summary = AgentConnectionSummary::from(&production);
        assert_eq!(uuid::Uuid::from(summary.id), production.id);
        assert_eq!(summary.environment.as_deref(), Some("production"));
        assert!(summary.readonly && summary.allow_writes);
        let wire = serde_json::to_value(&summary).unwrap();
        let mut keys = wire
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        keys.sort();
        assert_eq!(
            keys,
            [
                "allowWrites",
                "database",
                "engine",
                "environment",
                "id",
                "name",
                "readonly"
            ]
        );
        // Host, username, and keychain reference never reach the Agent; the
        // message names the field so a failure never echoes its value.
        let wire_text = wire.to_string();
        for (field, hidden) in [
            ("host", "db.example.invalid"),
            ("username", "reader"),
            ("secretRef", "keychain-item-must-not-escape"),
        ] {
            assert!(
                !wire_text.contains(hidden),
                "{field} reached the Agent projection"
            );
        }

        // A CLI name selects exactly one connection; case variants and duplicates
        // never resolve to a guessed connection.
        let staging = AgentConnectionSummary::from(&profile("staging", Engine::Mysql, None));
        let first = AgentConnectionSummary::from(&profile("analytics", Engine::Postgres, None));
        let second = AgentConnectionSummary::from(&profile("analytics", Engine::Mysql, None));
        let summaries = [first.clone(), staging.clone(), second.clone()];
        assert_eq!(resolve_cli_name(&summaries, "staging"), Ok(staging));
        for missing in ["Staging", "staging ", "", "prod"] {
            assert_eq!(
                resolve_cli_name(&summaries, missing),
                Err(CliConnectionResolutionError::NoMatch),
                "{missing:?}"
            );
        }
        let mut expected = vec![first, second];
        expected.sort_by_key(|summary| summary.id);
        let ambiguous = resolve_cli_name(&summaries, "analytics").unwrap_err();
        assert_eq!(
            ambiguous,
            CliConnectionResolutionError::Ambiguous {
                candidates: expected
            }
        );
        assert_ne!(
            ambiguous.to_string(),
            CliConnectionResolutionError::NoMatch.to_string()
        );
        assert!(!ambiguous.to_string().contains("analytics"));
    }
}
