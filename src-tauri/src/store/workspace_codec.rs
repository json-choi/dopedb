//! SQLite wire codecs for workspace-owned values.

use sqlx::sqlite::SqliteRow;
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::features::workspaces::{Workspace, WorkspaceLifecycleState, WorkspaceRole};
use crate::kernel::access::WorkspaceKind;
use crate::model::{WorkspaceConnectionAccess, WorkspaceCredentialMode};

use super::parse_uuid;

pub(super) fn row_to_workspace(row: &SqliteRow) -> AppResult<Workspace> {
    Ok(Workspace {
        id: parse_uuid(row.try_get("id")?)?.into(),
        name: row.try_get("name")?,
        kind: parse_workspace_kind(row.try_get("kind")?)?,
        lifecycle_state: match row.try_get::<String, _>("lifecycle_state")?.as_str() {
            "active" => WorkspaceLifecycleState::Active,
            "archived" => WorkspaceLifecycleState::Archived,
            "deleted" => WorkspaceLifecycleState::Deleted,
            other => {
                return Err(AppError::Config(format!(
                    "unknown workspace lifecycle state '{other}'"
                )))
            }
        },
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub(crate) fn workspace_access_str(access: WorkspaceConnectionAccess) -> &'static str {
    match access {
        WorkspaceConnectionAccess::View => "view",
        WorkspaceConnectionAccess::Read => "read",
        WorkspaceConnectionAccess::Write => "write",
        WorkspaceConnectionAccess::Manage => "manage",
        WorkspaceConnectionAccess::Local => "local",
    }
}

pub(crate) fn parse_workspace_access(value: String) -> AppResult<WorkspaceConnectionAccess> {
    match value.as_str() {
        "view" => Ok(WorkspaceConnectionAccess::View),
        "read" => Ok(WorkspaceConnectionAccess::Read),
        "write" => Ok(WorkspaceConnectionAccess::Write),
        "manage" => Ok(WorkspaceConnectionAccess::Manage),
        "local" => Ok(WorkspaceConnectionAccess::Local),
        other => Err(AppError::Config(format!(
            "unknown workspace connection access '{other}'"
        ))),
    }
}

pub(crate) fn credential_mode_str(mode: WorkspaceCredentialMode) -> &'static str {
    match mode {
        WorkspaceCredentialMode::Local => "local",
        WorkspaceCredentialMode::MemberLocal => "member_local",
        WorkspaceCredentialMode::Managed => "managed",
        WorkspaceCredentialMode::Provisioned => "provisioned",
    }
}

pub(crate) fn parse_credential_mode(value: String) -> AppResult<WorkspaceCredentialMode> {
    match value.as_str() {
        "local" => Ok(WorkspaceCredentialMode::Local),
        "member_local" => Ok(WorkspaceCredentialMode::MemberLocal),
        "managed" => Ok(WorkspaceCredentialMode::Managed),
        "provisioned" => Ok(WorkspaceCredentialMode::Provisioned),
        other => Err(AppError::Config(format!(
            "unknown workspace credential mode '{other}'"
        ))),
    }
}

pub(super) fn workspace_kind_str(kind: WorkspaceKind) -> &'static str {
    match kind {
        WorkspaceKind::Personal => "personal",
        WorkspaceKind::Team => "team",
    }
}

pub(super) fn parse_workspace_kind(kind: String) -> AppResult<WorkspaceKind> {
    match kind.as_str() {
        "personal" => Ok(WorkspaceKind::Personal),
        "team" => Ok(WorkspaceKind::Team),
        other => Err(AppError::Config(format!(
            "unknown workspace kind '{other}'"
        ))),
    }
}

pub(super) fn workspace_role_str(role: WorkspaceRole) -> &'static str {
    match role {
        WorkspaceRole::Viewer => "viewer",
        WorkspaceRole::Analyst => "analyst",
        WorkspaceRole::Editor => "editor",
        WorkspaceRole::Admin => "admin",
        WorkspaceRole::Owner => "owner",
    }
}

pub(super) fn parse_workspace_role(role: String) -> AppResult<WorkspaceRole> {
    match role.as_str() {
        "viewer" => Ok(WorkspaceRole::Viewer),
        "analyst" => Ok(WorkspaceRole::Analyst),
        "editor" => Ok(WorkspaceRole::Editor),
        "admin" => Ok(WorkspaceRole::Admin),
        "owner" => Ok(WorkspaceRole::Owner),
        other => Err(AppError::Config(format!(
            "unknown workspace role '{other}'"
        ))),
    }
}
