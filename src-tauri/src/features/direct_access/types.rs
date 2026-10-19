//! Application-level values for direct shared databases.
//!
//! These types connect the pure rules (`domain`, `plan`, `ownership`) to the ports:
//! the exact device-local scope of one shared database, the endpoint and the
//! administrator credential used to reach it, and the IPC-facing DTOs. Secrets are
//! zeroizing, redacted in `Debug`, and never serialized back out except into the
//! OS credential store through [`AdminCredential::to_vault_json`].

use std::fmt;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use dopedb_protocol::DirectProvisioningStatus;

use super::domain::{DirectEngine, FailureCode};
use crate::error::{AppError, AppResult};
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};

/// The exact account, workspace, and shared database an administrator credential,
/// work list, or revocation belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct DirectScope {
    pub(crate) account_id: AccountId,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) connection_id: ConnectionId,
}

impl DirectScope {
    /// Credential-store account name of the administrator credential.
    pub(crate) fn vault_account(&self) -> String {
        format!(
            "direct-admin:v1:{}:{}:{}",
            self.account_id, self.workspace_id, self.connection_id
        )
    }
}

/// A secret string that is wiped on drop and never printed.
#[derive(Deserialize)]
#[serde(transparent)]
pub(crate) struct Secret(Zeroizing<String>);

impl Secret {
    pub(crate) fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    pub(crate) fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[redacted]")
    }
}

/// Administrator database credential kept only in this device's credential store.
/// The SSH alias is a device-local `~/.ssh/config` Host, never sent to the server.
pub(crate) struct AdminCredential {
    pub(crate) username: String,
    pub(crate) password: Secret,
    pub(crate) ssh_alias: Option<String>,
}

impl fmt::Debug for AdminCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AdminCredential")
            .field("username", &"[redacted]")
            .field("password", &"[redacted]")
            .field("ssh_alias", &self.ssh_alias.is_some())
            .finish()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPayload<'a> {
    username: std::borrow::Cow<'a, str>,
    password: std::borrow::Cow<'a, str>,
    ssh_alias: Option<std::borrow::Cow<'a, str>>,
}

const MAX_CREDENTIAL_FIELD_BYTES: usize = 1024;

impl AdminCredential {
    /// Validate user-supplied fields: non-empty username/password of bounded size
    /// without control characters, and an SSH alias that is a plain `Host` token.
    pub(crate) fn new(
        username: String,
        password: Secret,
        ssh_alias: Option<String>,
    ) -> AppResult<Self> {
        let username = username.trim().to_owned();
        let ssh_alias = ssh_alias
            .map(|alias| alias.trim().to_owned())
            .filter(|alias| !alias.is_empty());
        if username.is_empty()
            || username.len() > MAX_CREDENTIAL_FIELD_BYTES
            || username.chars().any(char::is_control)
            || password.as_str().is_empty()
            || password.as_str().len() > MAX_CREDENTIAL_FIELD_BYTES
            || ssh_alias.as_deref().is_some_and(|alias| {
                alias.len() > 255
                    || alias.starts_with('-')
                    || !alias
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            })
        {
            return Err(AppError::Config(
                "the administrator credential is invalid".into(),
            ));
        }
        Ok(Self {
            username,
            password,
            ssh_alias,
        })
    }

    pub(crate) fn to_vault_json(&self) -> AppResult<Zeroizing<String>> {
        Ok(Zeroizing::new(serde_json::to_string(&VaultPayload {
            username: self.username.as_str().into(),
            password: self.password.as_str().into(),
            ssh_alias: self.ssh_alias.as_deref().map(Into::into),
        })?))
    }

    pub(crate) fn from_vault_json(value: &str) -> AppResult<Self> {
        let payload: VaultPayload<'_> = serde_json::from_str(value).map_err(|_| {
            AppError::Config("the stored administrator credential is invalid".into())
        })?;
        Self::new(
            payload.username.into_owned(),
            Secret::new(payload.password.into_owned()),
            payload.ssh_alias.map(std::borrow::Cow::into_owned),
        )
    }
}

/// Where a shared database lives, without any credential.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TargetEndpoint {
    pub(crate) engine: DirectEngine,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) database: String,
    pub(crate) sslmode: String,
    pub(crate) ssh_alias: Option<String>,
}

/// SSL modes the control plane accepts for a direct database.
pub(crate) fn sslmode_allowed(engine: DirectEngine, sslmode: &str) -> bool {
    match engine {
        DirectEngine::Postgres => matches!(sslmode, "verify-full" | "require"),
        DirectEngine::Mysql => matches!(sslmode, "VERIFY_IDENTITY" | "REQUIRED"),
    }
}

impl TargetEndpoint {
    pub(crate) fn validate(&self) -> AppResult<()> {
        let host_ok = !self.host.is_empty()
            && self.host.len() <= 512
            && !self
                .host
                .chars()
                .any(|c| c.is_control() || c.is_whitespace() || c == ',');
        let database_ok = !self.database.is_empty()
            && self.database.len() <= 1024
            && !self.database.chars().any(char::is_control)
            && !self.database.contains(['?', '#']);
        if !host_ok
            || !database_ok
            || self.port == 0
            || !sslmode_allowed(self.engine, &self.sslmode)
        {
            return Err(AppError::Config(
                "the shared database endpoint is invalid".into(),
            ));
        }
        Ok(())
    }
}

/// Facts the preflight reads from the target server for one namespace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NamespaceFacts {
    pub(crate) name: String,
    /// The administrator may grant the read (and, with a write ceiling, write)
    /// privileges on every existing object of the namespace.
    pub(crate) grantable: bool,
    /// PUBLIC may create objects here, which would give members object ownership.
    pub(crate) public_create: bool,
}

/// Server-side facts gathered with the administrator credential.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PreflightFacts {
    pub(crate) can_create_principal: bool,
    /// The administrator can end other accounts' sessions (PostgreSQL superuser or
    /// `pg_signal_backend`; MySQL `PROCESS` plus `CONNECTION_ADMIN` or `SUPER`).
    pub(crate) can_end_sessions: bool,
    pub(crate) namespaces: Vec<NamespaceFacts>,
}

/// Closed preflight warnings shown before the plan is accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PreflightWarning {
    PublicCreate,
    GrantorInsufficient,
}

/// Result of probing a candidate endpoint. A probe failure is data (`failureCode`),
/// not an error, so the screen can explain it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreflightReport {
    pub(crate) engine: DirectEngine,
    pub(crate) server_version: Option<String>,
    pub(crate) version_supported: bool,
    pub(crate) can_create_principal: bool,
    /// When false, revoking a member cannot end sessions that are already open.
    pub(crate) can_end_sessions: bool,
    pub(crate) namespaces: Vec<NamespaceFacts>,
    pub(crate) warnings: Vec<PreflightWarning>,
    pub(crate) failure_code: Option<FailureCode>,
    pub(crate) plan_read: Vec<String>,
    pub(crate) plan_write: Vec<String>,
}

/// Endpoint as the screen provides it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EndpointInput {
    pub(crate) engine: DirectEngine,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) database: String,
    pub(crate) sslmode: String,
    pub(crate) ssh_alias: Option<String>,
}

impl EndpointInput {
    pub(crate) fn into_endpoint(self) -> AppResult<TargetEndpoint> {
        let endpoint = TargetEndpoint {
            engine: self.engine,
            host: self.host.trim().to_owned(),
            port: self.port,
            database: self.database.trim().to_owned(),
            sslmode: self.sslmode,
            ssh_alias: self.ssh_alias,
        };
        endpoint.validate()?;
        Ok(endpoint)
    }
}

/// Administrator credential as the screen provides it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CredentialInput {
    pub(crate) username: String,
    pub(crate) password: Secret,
}

/// Self-reported status of the caller's own principal plus whether this device can
/// act as an administrator device for the database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectStatus {
    pub(crate) provisioning: DirectProvisioningStatus,
    pub(crate) admin_credential_on_device: bool,
}
