//! Provider-neutral Project Knowledge values and safety invariants.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use dopedb_protocol::{
    GraphBuildArtifactV1, KnowledgeSourceBindingV1, KnowledgeSourceProvider,
    KnowledgeSourceVisibility, SourceRevisionIdentity,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::identity::{AccountId, WorkspaceId};

/// The one error a cancelled Project Knowledge sync returns. It carries the
/// dedicated `cancelled` kind, so both the watcher and the screen discriminate a
/// user-requested stop by type instead of by message text, and a cancelled sync
/// never leaves a `failed` health state behind.
pub(crate) fn sync_cancelled() -> AppError {
    AppError::Cancelled("Project Knowledge sync cancelled".into())
}

/// True when `error` is the cancellation this feature raises.
pub(crate) fn is_sync_cancelled(error: &AppError) -> bool {
    matches!(error, AppError::Cancelled(message) if message == "Project Knowledge sync cancelled")
}

/// Cooperative stop signal for exactly one logical sync run. The feature owns it
/// so a checkpoint never reads a process-wide executor registry, and a stop that
/// reached an earlier run can never be inherited by the next one. The cancel use
/// case is the only writer; every checkpoint only reads.
#[derive(Debug, Clone, Default)]
pub(crate) struct SyncCancellation(Arc<AtomicBool>);

impl SyncCancellation {
    pub(crate) fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    /// True when both values are the same run's signal rather than two runs of
    /// the same source.
    pub(crate) fn same_run(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

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
    pub(crate) name: String,
    pub(crate) risk_class: EnvironmentRiskClass,
    pub(crate) revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectDefinition {
    pub(crate) project: Project,
    pub(crate) environments: Vec<ProjectEnvironment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EnvironmentRiskClass {
    Production,
    Staging,
    Development,
    Test,
    Custom,
}

/// Exact Project Environment option available to a connection-pinned Agent.
/// Knowledge owns this projection; Agent transports may expose it but do not
/// redefine or persist Knowledge authority.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeEnvironmentSummary {
    pub(crate) id: Uuid,
    pub(crate) project_name: String,
    pub(crate) name: String,
    pub(crate) risk_class: EnvironmentRiskClass,
    pub(crate) graph_revision_count: u64,
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
    /// The absolute path is process-local and must never be serialized into a
    /// workspace record, graph artifact, telemetry event, or ACP response.
    LocalFolder { root: PathBuf },
}

impl SourceLocator {
    pub(crate) fn provider(&self) -> KnowledgeSourceProvider {
        match self {
            Self::Github { .. } => KnowledgeSourceProvider::Github,
            Self::LocalFolder { .. } => KnowledgeSourceProvider::LocalFolder,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceBindingDraft {
    pub(crate) source_id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: u64,
    pub(crate) display_name: String,
    pub(crate) visibility: KnowledgeSourceVisibility,
    pub(crate) locator: SourceLocator,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceFileManifest {
    pub(crate) path: String,
    pub(crate) content_hash: String,
    pub(crate) hash_algorithm: SourceContentHashAlgorithm,
    pub(crate) bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceContentHashAlgorithm {
    Sha256,
}

pub(crate) fn source_snapshot_digest(files: &[SourceFileManifest]) -> String {
    let mut hash = Sha256::new();
    for file in files {
        hash.update((file.path.len() as u64).to_be_bytes());
        hash.update(file.path.as_bytes());
        hash.update(file.bytes.to_be_bytes());
        hash.update(b"sha256");
        hash.update(hex::decode(&file.content_hash).expect("validated source inventory hash"));
    }
    hex::encode(hash.finalize())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceSnapshot {
    pub(crate) binding: KnowledgeSourceBindingV1,
    pub(crate) environment_revision: u64,
    pub(crate) source_revision_sha256: String,
    pub(crate) files: Vec<SourceFileManifest>,
    pub(crate) changed_files: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceHealthState {
    Ready,
    Syncing,
    Stale,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeGrant {
    pub(crate) id: Uuid,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) account_id: AccountId,
    pub(crate) project_id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: u64,
    pub(crate) graph_revision_ids: Vec<Uuid>,
    pub(crate) expires_at: DateTime<Utc>,
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
/// revisions are browsed directly at their exact commit. Graph revision fields
/// remain only for dormant/legacy graphs and optional future graph products.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeSessionScope {
    /// Exact hosted authority when this Environment has active GitHub knowledge.
    /// Local-only and database-only Environments deliberately carry no cloud grant.
    pub(crate) knowledge_grant_id: Option<Uuid>,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: u64,
    pub(crate) sources: Vec<KnowledgeSessionSource>,
    pub(crate) graph_revision_ids: Vec<Uuid>,
    pub(crate) connections: Vec<KnowledgeSessionConnection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeSessionConnection {
    pub(crate) connection_id: Uuid,
    pub(crate) connection_revision: i64,
    pub(crate) role: String,
    pub(crate) alias: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MappingProposalState {
    Proposed,
    Approved,
    Rejected,
    Stale,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeMappingProposal {
    pub(crate) id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) graph_revision_id: Uuid,
    pub(crate) schema_fingerprint: String,
    pub(crate) from_node_id: String,
    pub(crate) target_kind: String,
    pub(crate) target_identity: String,
    pub(crate) state: MappingProposalState,
    pub(crate) proposed_at: DateTime<Utc>,
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
    if draft.locator.provider() == KnowledgeSourceProvider::LocalFolder
        && draft.visibility == KnowledgeSourceVisibility::SharedGraph
    {
        return Err(AppError::Blocked {
            reason: "a Local Folder starts local-only and requires a separate publish approval"
                .into(),
        });
    }
    Ok(())
}

pub(crate) fn validate_graph_publish(
    artifact: &GraphBuildArtifactV1,
    environment: &ProjectEnvironment,
) -> AppResult<()> {
    if !artifact.validate()
        || artifact.binding.project_environment_id != environment.id
        || artifact.binding.project_id != environment.project_id
        || artifact.environment_revision != environment.revision
    {
        return Err(AppError::Blocked {
            reason: "the graph artifact is unhealthy or belongs to a stale environment revision"
                .into(),
        });
    }
    if environment.risk_class == EnvironmentRiskClass::Production
        && matches!(
            artifact.binding.revision,
            SourceRevisionIdentity::LocalGit { dirty: true, .. }
        )
    {
        return Err(AppError::Blocked {
            reason: "dirty Local Folder snapshots cannot be published to Production".into(),
        });
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn assert_knowledge_domain_contract() {
    super::extractor::assert_extractor_contract();
    let environment = ProjectEnvironment {
        id: Uuid::from_u128(3),
        project_id: Uuid::from_u128(2),
        name: "Production".into(),
        risk_class: EnvironmentRiskClass::Production,
        revision: 1,
    };
    let draft = SourceBindingDraft {
        source_id: Uuid::from_u128(1),
        project_id: environment.project_id,
        project_environment_id: environment.id,
        environment_revision: environment.revision,
        display_name: "Local app".into(),
        visibility: KnowledgeSourceVisibility::SharedGraph,
        locator: SourceLocator::LocalFolder {
            root: PathBuf::from("/private/source"),
        },
    };
    assert!(matches!(
        validate_binding_draft(&draft, &environment),
        Err(AppError::Blocked { .. })
    ));
    let serialized = serde_json::to_string(&draft.locator.provider()).unwrap();
    assert!(!serialized.contains("private/source"));
}
