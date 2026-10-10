//! Workspace domain values and invariants.
//!
//! These contracts contain no Tauri, SQLite, HTTP, keychain, or connection-pool
//! details. Typed identities keep account, workspace, and connection selectors from
//! being exchanged accidentally while preserving the existing string/UUID wire shape.

use crate::error::{AppError, AppResult};
use crate::kernel::access::WorkspaceKind;
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Workspace {
    pub(crate) id: WorkspaceId,
    pub(crate) name: String,
    pub(crate) kind: WorkspaceKind,
    pub(crate) lifecycle_state: WorkspaceLifecycleState,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceFeatureState {
    pub(crate) enabled: bool,
}

/// Public identity fields returned after the hosted authority validates a session.
/// The bearer token itself never enters this domain value or crosses IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceAuthUser {
    pub(crate) id: AccountId,
    pub(crate) email: String,
    pub(crate) display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceAccountMembership {
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) role: WorkspaceRole,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceAuthAccount {
    pub(crate) user: WorkspaceAuthUser,
    pub(crate) memberships: Vec<WorkspaceAccountMembership>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceAuthState {
    pub(crate) authenticated: bool,
    pub(crate) user: Option<WorkspaceAuthUser>,
    pub(crate) accounts: Vec<WorkspaceAuthAccount>,
    /// Monotonic identity for every active workspace/account/membership authority.
    /// Renderer caches and external stores must scope private state to this value.
    pub(crate) authority_generation: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceLoginStatus {
    SignedIn,
    Denied,
    Expired,
}

/// Public Desktop handoff metadata; native PKCE credentials never cross IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceDesktopAuthorization {
    pub(crate) attempt_id: String,
    pub(crate) authorization_url: String,
    pub(crate) expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceLoginResult {
    pub(crate) status: WorkspaceLoginStatus,
    pub(crate) user: Option<WorkspaceAuthUser>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceLifecycleState {
    Active,
    Archived,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceRole {
    Viewer,
    Analyst,
    Editor,
    Admin,
    Owner,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteWorkspace {
    pub(crate) id: WorkspaceId,
    pub(crate) name: String,
    pub(crate) role: WorkspaceRole,
}

/// One payload-free page of the hosted workspace change journal. A page only
/// selects authoritative collections to reconcile; resource ids, audit summaries,
/// credentials, Article definitions, and result evidence never cross this contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WorkspacePullPage {
    pub(crate) next_cursor: i64,
    pub(crate) has_more: bool,
    pub(crate) reset: bool,
    pub(crate) refresh_connections: bool,
    pub(crate) refresh_analyses: bool,
    pub(crate) connection_tombstone: bool,
    pub(crate) analysis_tombstone: bool,
}

/// Complete local authority snapshot used after a hosted refresh. The active scope,
/// its generation, and active connection revisions decide which process capabilities
/// survive; the all-account grant set separately drives provider-binding cleanup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceAuthorityFingerprint {
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) account_scope: String,
    pub(crate) generation: i64,
    /// Active-scope connection and member-local binding revisions. A remote
    /// collection refresh can change one exact Agent grant without changing the
    /// workspace membership generation, so transport fencing compares this set too.
    pub(crate) connections: Vec<(ConnectionId, i64, i64)>,
    pub(crate) grants: Vec<(AccountId, WorkspaceId, WorkspaceRole)>,
}

pub(crate) fn workspace_feature_enabled(raw: Option<&str>) -> bool {
    raw.map(|value| {
        !matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "0" | "false" | "off"
        )
    })
    .unwrap_or(true)
}

pub(crate) fn parse_workspace_role(value: Option<&str>) -> AppResult<WorkspaceRole> {
    match value.unwrap_or("viewer") {
        "viewer" => Ok(WorkspaceRole::Viewer),
        "analyst" => Ok(WorkspaceRole::Analyst),
        "editor" => Ok(WorkspaceRole::Editor),
        "admin" => Ok(WorkspaceRole::Admin),
        "owner" => Ok(WorkspaceRole::Owner),
        _ => Err(AppError::Network(
            "workspace membership returned an invalid role".into(),
        )),
    }
}

pub(crate) fn validate_member_username(username: &str) -> AppResult<&str> {
    let username = username.trim();
    if username.len() > 320 || username.chars().any(char::is_control) {
        return Err(AppError::Config("username is invalid".into()));
    }
    Ok(username)
}

/// TLS file locations a member may keep in their own shared-connection binding.
/// The shared template owns the TLS mode; certificate and key files live on each
/// member's device, so their paths stay in the local binding and never reach the
/// workspace. MongoDB has no template TLS mode, so its enable flag is member-local.
const SQL_MEMBER_TLS_FILES: [&str; 3] = ["sslrootcert", "sslcert", "sslkey"];
const MONGO_MEMBER_TLS_FILES: [&str; 2] = ["tlsCAFile", "tlsCertificateKeyFile"];
const MONGO_MEMBER_TLS_FLAG: &str = "tls";
const MAX_MEMBER_TLS_PATH_CHARS: usize = 4_096;

/// Apply requested member-local TLS settings to a binding's parameters. An empty
/// value removes the setting; keys outside the engine's allowlist are rejected so
/// this path cannot smuggle other driver options into the binding.
pub(crate) fn merge_member_tls_files(
    engine: crate::model::Engine,
    extra_params: &mut std::collections::HashMap<String, String>,
    requested: &std::collections::HashMap<String, String>,
) -> AppResult<()> {
    use crate::model::Engine;
    let (files, flag): (&[&str], Option<&str>) = match engine {
        Engine::Postgres | Engine::Mysql => (&SQL_MEMBER_TLS_FILES, None),
        Engine::Mongodb => (&MONGO_MEMBER_TLS_FILES, Some(MONGO_MEMBER_TLS_FLAG)),
        Engine::Sqlite | Engine::Bigquery => (&[], None),
    };
    for (key, value) in requested {
        let value = value.trim();
        if flag == Some(key.as_str()) {
            match value {
                "true" => {
                    extra_params.insert(key.clone(), "true".into());
                }
                "" => {
                    extra_params.remove(key);
                }
                _ => return Err(AppError::Config("TLS setting is invalid".into())),
            }
            continue;
        }
        if !files.contains(&key.as_str()) {
            return Err(AppError::Config(
                "this TLS setting is not available for the connection engine".into(),
            ));
        }
        if value.chars().count() > MAX_MEMBER_TLS_PATH_CHARS || value.chars().any(char::is_control)
        {
            return Err(AppError::Config("TLS file path is invalid".into()));
        }
        if value.is_empty() {
            extra_params.remove(key);
        } else {
            extra_params.insert(key.clone(), value.to_owned());
        }
    }
    Ok(())
}
