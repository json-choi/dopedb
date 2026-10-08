//! Value types accepted by workspace administration operations.
//!
//! Each closed enum serializes to the exact control-plane spelling; a secret typed
//! by the user is wrapped on arrival and never echoed or logged.

use std::fmt;

use serde::{Deserialize, Deserializer};
use zeroize::Zeroizing;

/// A secret typed by the user for a workspace provider integration. It is wrapped
/// as soon as it crosses IPC and is never logged or echoed back to the webview.
pub(crate) struct SecretText(Zeroizing<String>);

impl SecretText {
    pub(super) fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Debug for SecretText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretText([redacted])")
    }
}

impl<'de> Deserialize<'de> for SecretText {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(Self(Zeroizing::new(String::deserialize(deserializer)?)))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AssignableWorkspaceRole {
    Viewer,
    Analyst,
    Editor,
    Admin,
}

impl AssignableWorkspaceRole {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Viewer => "viewer",
            Self::Analyst => "analyst",
            Self::Editor => "editor",
            Self::Admin => "admin",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionCapability {
    View,
    Read,
    Use,
    Manage,
}

impl ConnectionCapability {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::View => "view",
            Self::Read => "read",
            Self::Use => "use",
            Self::Manage => "manage",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConflictResolution {
    Server,
    Candidate,
    Dismissed,
}

impl ConflictResolution {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Server => "server",
            Self::Candidate => "candidate",
            Self::Dismissed => "dismissed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderResourceKind {
    Organizations,
    Projects,
    Databases,
    Branches,
    Instances,
    Brokers,
    Targets,
}

impl ProviderResourceKind {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Organizations => "organizations",
            Self::Projects => "projects",
            Self::Databases => "databases",
            Self::Branches => "branches",
            Self::Instances => "instances",
            Self::Brokers => "brokers",
            Self::Targets => "targets",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderSelectionKey {
    Organization,
    Project,
    Database,
    Branch,
    Instance,
    Engine,
    NetworkMode,
    Broker,
    Target,
}

impl ProviderSelectionKey {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Organization => "organization",
            Self::Project => "project",
            Self::Database => "database",
            Self::Branch => "branch",
            Self::Instance => "instance",
            Self::Engine => "engine",
            Self::NetworkMode => "networkMode",
            Self::Broker => "broker",
            Self::Target => "target",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum EnvironmentClassification {
    Development,
    Production,
}

impl EnvironmentClassification {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Development => "development",
            Self::Production => "production",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub(crate) enum NeonPlanAction {
    #[serde(rename = "planCreate")]
    Create,
    #[serde(rename = "planDelete")]
    Delete,
    #[serde(rename = "planSwitch")]
    Switch,
}

impl NeonPlanAction {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Create => "planCreate",
            Self::Delete => "planDelete",
            Self::Switch => "planSwitch",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub(crate) enum NeonDecideAction {
    #[serde(rename = "decideCreate")]
    Create,
    #[serde(rename = "decideDelete")]
    Delete,
    #[serde(rename = "decideSwitch")]
    Switch,
}

impl NeonDecideAction {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Create => "decideCreate",
            Self::Delete => "decideDelete",
            Self::Switch => "decideSwitch",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub(crate) enum NeonExecuteAction {
    #[serde(rename = "executeCreate")]
    Create,
    #[serde(rename = "executeDelete")]
    Delete,
    #[serde(rename = "executeSwitch")]
    Switch,
}

impl NeonExecuteAction {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Create => "executeCreate",
            Self::Delete => "executeDelete",
            Self::Switch => "executeSwitch",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum NeonDecision {
    Approved,
    Rejected,
}

impl NeonDecision {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GcpSetupInventory {
    Projects,
    Instances,
    Permissions,
}

impl GcpSetupInventory {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Projects => "projects",
            Self::Instances => "instances",
            Self::Permissions => "permissions",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OAuthProvider {
    PlanetScale,
    GcpCloudSql,
}

impl OAuthProvider {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::PlanetScale => "planetScale",
            Self::GcpCloudSql => "gcpCloudSql",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GcpSchemaAuthority {
    pub(super) database: String,
    pub(super) owner: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VaultTargetEngine {
    Postgres,
    Mysql,
}

impl VaultTargetEngine {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Postgres => "postgres",
            Self::Mysql => "mysql",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VaultTarget {
    pub(super) host: String,
    pub(super) port: u16,
    pub(super) database: String,
    pub(super) engine: VaultTargetEngine,
    pub(super) production: bool,
}

/// HashiCorp Vault AppRole configuration. `role_id` and `secret_id` are sent to
/// the control plane, which seals them; Desktop never stores them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VaultAppRoleConfiguration {
    pub(super) address: String,
    pub(super) namespace: Option<String>,
    pub(super) auth_mount: String,
    pub(super) role_id: SecretText,
    pub(super) secret_id: SecretText,
    pub(super) database_mount: String,
    pub(super) database_connection: String,
    pub(super) read_role: String,
    pub(super) write_role: Option<String>,
    pub(super) target: VaultTarget,
}
