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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceDeviceAuthorization {
    pub(crate) device_code: String,
    pub(crate) user_code: String,
    pub(crate) verification_uri_complete: String,
    pub(crate) expires_in: u64,
    pub(crate) interval: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceLoginPollStatus {
    Pending,
    SlowDown,
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
pub(crate) struct WorkspaceLoginPoll {
    pub(crate) status: WorkspaceLoginPollStatus,
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

pub(crate) fn valid_device_code(device_code: &str) -> bool {
    device_code.len() == 40
        && device_code
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}
