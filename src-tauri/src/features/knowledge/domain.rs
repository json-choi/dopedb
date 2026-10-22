//! Provider-neutral Project Knowledge values and safety invariants.

use dopedb_protocol::{KnowledgeSourceBindingV1, SourceRevisionIdentity};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::environment::EnvironmentKind;
use crate::kernel::identity::WorkspaceId;

/// Stable code for a hosted access sync failure that leaves hosted-governed
/// resources blocked; the original error follows on the next line.
pub(crate) const KNOWLEDGE_ACCESS_SYNC_FAILED: &str = "knowledge_access_sync_failed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Project {
    pub(crate) id: Uuid,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) name: String,
    pub(crate) revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectEnvironment {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) kind: EnvironmentKind,
    pub(crate) revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectDefinition {
    pub(crate) project: Project,
    pub(crate) environments: Vec<ProjectEnvironment>,
}

/// Exact Project Environment option available to a connection-pinned Agent.
/// Knowledge owns this projection; Agent transports may expose it but do not
/// redefine or persist Knowledge authority.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeEnvironmentSummary {
    pub(crate) id: Uuid,
    pub(crate) project_name: String,
    pub(crate) kind: EnvironmentKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredKnowledgeScope {
    pub(crate) project: Project,
    pub(crate) environment: ProjectEnvironment,
    pub(crate) binding: KnowledgeSourceBindingV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SourceLocator {
    Github {
        installation_id: Uuid,
        repository_id: String,
        repository: String,
        ref_name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceBindingDraft {
    pub(crate) source_id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: u64,
    pub(crate) display_name: String,
    pub(crate) locator: SourceLocator,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceHealthState {
    Ready,
    Stale,
    Failed,
}

/// One exact hosted source revision copied into an ACP session. Repository
/// credentials and installation tokens never cross this boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeSessionSource {
    pub(crate) source_id: Uuid,
    pub(crate) display_name: String,
    pub(crate) repository_id: String,
    pub(crate) repository: String,
    pub(crate) ref_name: String,
    pub(crate) commit_sha: String,
}

impl KnowledgeSessionSource {
    pub(crate) fn validate(&self) -> bool {
        !self.display_name.trim().is_empty()
            && self.display_name.len() <= 512
            && !self.display_name.chars().any(char::is_control)
            && SourceRevisionIdentity::Github {
                repository_id: self.repository_id.clone(),
                repository: self.repository.clone(),
                ref_name: self.ref_name.clone(),
                commit_sha: self.commit_sha.clone(),
            }
            .validate()
    }
}

/// Immutable Knowledge authority copied into one ACP session. GitHub source
/// revisions are browsed directly at their exact commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeSessionScope {
    /// Project identity shared by every exact Environment scope in one Agent context.
    pub(crate) project_id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: u64,
    /// A connection bound to this exact Environment revision that may authorize
    /// source reads. It is not automatically part of the selected DB allowlist.
    pub(crate) authority_connection_id: Uuid,
    pub(crate) authority_connection_revision: i64,
    pub(crate) sources: Vec<KnowledgeSessionSource>,
    pub(crate) connections: Vec<KnowledgeSessionConnection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeSessionConnection {
    /// Device-local connection identity used by the pinned ACP session.
    pub(crate) connection_id: Uuid,
    /// Current device-local/hosted authority epoch used for execution checks.
    pub(crate) connection_revision: i64,
    /// Hosted shared identity and public template revision used by durable
    /// Analysis Article definitions. They never replace the local authority.
    pub(crate) remote_connection_id: Option<Uuid>,
    pub(crate) connection_content_revision: i64,
    pub(crate) role: String,
    pub(crate) alias: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EnvironmentConnectionBinding {
    pub(crate) id: Uuid,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: u64,
    pub(crate) connection_id: Uuid,
    pub(crate) connection_revision: i64,
    pub(crate) current_connection_revision: i64,
    pub(crate) connection_content_revision: i64,
    pub(crate) connection_name: String,
    pub(crate) role: String,
    pub(crate) alias: String,
}

pub(crate) fn validate_environment_connection_label(value: &str, max_bytes: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max_bytes && !value.chars().any(char::is_control)
}

pub(crate) fn validate_binding_draft(
    draft: &SourceBindingDraft,
    environment: &ProjectEnvironment,
) -> AppResult<()> {
    if draft.project_environment_id != environment.id
        || draft.project_id != environment.project_id
        || draft.environment_revision != environment.revision
        || draft.environment_revision == 0
        || draft.display_name.trim().is_empty()
        || draft.display_name.len() > 512
        || draft.display_name.chars().any(char::is_control)
    {
        return Err(AppError::Config(
            "the Knowledge source binding is invalid or stale".into(),
        ));
    }
    Ok(())
}
