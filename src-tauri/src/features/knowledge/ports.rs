//! Provider adapters and immutable graph persistence ports.

use std::future::Future;

use chrono::{DateTime, Utc};
use dopedb_protocol::{
    GraphBuildArtifactV1, GraphRevisionDiffV1, KnowledgeSourceBindingV1, SourceRevisionIdentity,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppResult;
use crate::kernel::access::{ActiveResourceScope, PinnedConnection};

use super::domain::{
    EnvironmentConnectionBinding, EnvironmentRiskClass, KnowledgeEnvironmentSummary,
    KnowledgeGrant, KnowledgeMappingProposal, KnowledgeSessionScope, KnowledgeSessionSource,
    MappingProposalState, Project, ProjectDefinition, ProjectEnvironment, SourceSnapshot,
    StoredKnowledgeScope,
};

/// Hosted Knowledge DTOs belong to the authority port rather than its HTTP
/// adapter. Tauri and Broker callers can therefore consume one stable feature
/// contract without importing HTTP-client ownership or concrete adapter modules.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteGithubRepository {
    pub(crate) installation_id: Uuid,
    pub(crate) account_login: String,
    pub(crate) id: String,
    pub(crate) full_name: String,
    pub(crate) default_branch: String,
    pub(crate) private: bool,
    pub(crate) archived: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateKnowledgeSourceRequest<'a> {
    pub(crate) source_id: Uuid,
    pub(crate) provider: &'a str,
    pub(crate) project_id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) display_name: &'a str,
    pub(crate) installation_id: Uuid,
    pub(crate) repository_id: &'a str,
    pub(crate) repository_full_name: &'a str,
    pub(crate) ref_name: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteKnowledgeSource {
    pub(crate) id: Uuid,
    pub(crate) project_id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: u64,
    pub(crate) provider: String,
    pub(crate) display_name: String,
    pub(crate) visibility: String,
    pub(crate) repository_id: Option<String>,
    pub(crate) repository_full_name: Option<String>,
    pub(crate) ref_name: Option<String>,
    pub(crate) commit_sha: Option<String>,
    pub(crate) sync_state: String,
    pub(crate) sync_revision: u64,
    pub(crate) last_failure_code: Option<String>,
    pub(crate) graph_revision_id: Option<Uuid>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteSourceFileMatch {
    pub(crate) path: String,
    pub(crate) blob_sha: String,
    pub(crate) bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteSourceSearchResult {
    pub(crate) source_id: Uuid,
    pub(crate) repository: String,
    pub(crate) ref_name: String,
    pub(crate) commit_sha: String,
    pub(crate) file_count: u64,
    pub(crate) matches: Vec<RemoteSourceFileMatch>,
    pub(crate) total_matches: u64,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteSourceReadResult {
    pub(crate) source_id: Uuid,
    pub(crate) repository: String,
    pub(crate) commit_sha: String,
    pub(crate) path: String,
    pub(crate) blob_sha: String,
    pub(crate) bytes: u64,
    pub(crate) line_start: u32,
    pub(crate) line_end: u32,
    pub(crate) total_lines: u32,
    pub(crate) truncated: bool,
    pub(crate) text: String,
}

pub(crate) struct PinnedSourceAuthority<'a> {
    pub(crate) account_id: &'a str,
    pub(crate) workspace_id: Uuid,
    pub(crate) environment_id: Uuid,
    pub(crate) environment_revision: u64,
    pub(crate) connection_id: Uuid,
    pub(crate) connection_revision: i64,
    pub(crate) source: &'a KnowledgeSessionSource,
}

pub(crate) struct PinnedSourceSearchRequest<'a> {
    pub(crate) authority: PinnedSourceAuthority<'a>,
    pub(crate) query: &'a str,
    pub(crate) limit: u32,
}

pub(crate) struct PinnedSourceReadRequest<'a> {
    pub(crate) authority: PinnedSourceAuthority<'a>,
    pub(crate) path: &'a str,
    pub(crate) line_start: u32,
    pub(crate) line_end: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteKnowledgeSyncProgress {
    pub(crate) source_id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) display_name: String,
    pub(crate) project_name: String,
    pub(crate) environment_name: String,
    pub(crate) phase: String,
    pub(crate) state: String,
    pub(crate) total_files: u32,
    pub(crate) completed_files: u32,
    pub(crate) attempt: u32,
    pub(crate) started_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) retry_at: Option<DateTime<Utc>>,
}

impl RemoteKnowledgeSyncProgress {
    pub(crate) fn validate(&self) -> bool {
        let safe_name = |value: &str| {
            !value.trim().is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
        };
        matches!(self.phase.as_str(), "manifest" | "indexing" | "activating")
            && matches!(self.state.as_str(), "queued" | "claimed")
            && safe_name(&self.display_name)
            && safe_name(&self.project_name)
            && safe_name(&self.environment_name)
            && self.total_files <= 20_000
            && self.completed_files <= self.total_files
            && self.attempt <= 20
            && self.updated_at >= self.started_at
            && self.updated_at <= Utc::now() + chrono::Duration::minutes(5)
            && self.retry_at.as_ref().is_none_or(|retry_at| {
                self.state == "queued" && self.attempt > 0 && *retry_at >= self.started_at
            })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreatedKnowledgeSource {
    pub(crate) id: Uuid,
    pub(crate) sync_revision: u64,
    pub(crate) environment_revision: u64,
    pub(crate) commit_sha: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteKnowledgeEnvironment {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) risk_class: EnvironmentRiskClass,
    pub(crate) revision: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteKnowledgeProject {
    pub(crate) id: Uuid,
    pub(crate) name: String,
    pub(crate) revision: u64,
    pub(crate) environments: Vec<RemoteKnowledgeEnvironment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteKnowledgeInventory {
    pub(crate) projects: Vec<RemoteKnowledgeProject>,
    pub(crate) sources: Vec<RemoteKnowledgeSource>,
}

#[derive(Debug, Clone)]
pub(crate) struct RemotePersonalKnowledgeScope {
    pub(crate) workspace_id: Uuid,
    pub(crate) member_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteKnowledgeGraphScope {
    pub(crate) source_id: Uuid,
    pub(crate) graph_revision_id: Uuid,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteKnowledgeGrant {
    pub(crate) id: Uuid,
    pub(crate) member_id: String,
    pub(crate) project_id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: u64,
    pub(crate) graph_revision_ids: Vec<Uuid>,
    pub(crate) graph_scopes: Vec<RemoteKnowledgeGraphScope>,
    pub(crate) expires_at: chrono::DateTime<chrono::Utc>,
    pub(crate) revoked_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateKnowledgeEnvironmentRequest {
    pub(crate) name: String,
    pub(crate) risk_class: EnvironmentRiskClass,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateKnowledgeProjectRequest {
    pub(crate) name: String,
    pub(crate) environments: Vec<CreateKnowledgeEnvironmentRequest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppendKnowledgeEnvironmentRequest {
    pub(crate) expected_project_revision: u64,
    pub(crate) name: String,
    pub(crate) risk_class: EnvironmentRiskClass,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteEnvironmentConnectionBinding {
    pub(crate) id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: u64,
    pub(crate) connection_id: Uuid,
    pub(crate) connection_revision: i64,
    pub(crate) current_connection_revision: i64,
    pub(crate) connection_content_revision: i64,
    pub(crate) connection_name: String,
    pub(crate) role: String,
    pub(crate) alias: String,
    pub(crate) stale: bool,
}

pub(crate) trait KnowledgeScopeRepositoryPort: Clone + Send + Sync + 'static {
    /// Persist only provider-neutral, secret-free identity. Local roots remain in
    /// the Desktop adapter's process-local capability registry.
    fn save_scope(
        &self,
        project: &Project,
        environment: &ProjectEnvironment,
        binding: &KnowledgeSourceBindingV1,
        environment_revision: u64,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn scopes(
        &self,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<StoredKnowledgeScope>>> + Send;
    fn remove_scope(&self, source_id: Uuid) -> impl Future<Output = AppResult<()>> + Send;
    fn save_snapshot(
        &self,
        snapshot: &SourceSnapshot,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn source_snapshot(
        &self,
        source_id: Uuid,
    ) -> impl Future<Output = AppResult<Option<SourceSnapshot>>> + Send;
}

/// Device-local source operations used only by the Local Folder extractor.
/// Hosted providers are registered and indexed by the workspace control plane.
pub(crate) trait LocalKnowledgeSourcePort: Clone + Send + Sync + 'static {
    type Watch: Send + 'static;

    fn snapshot(
        &self,
        binding: &KnowledgeSourceBindingV1,
        previous: Option<&SourceSnapshot>,
    ) -> impl Future<Output = AppResult<SourceSnapshot>> + Send;
    fn read_file_at_revision(
        &self,
        binding: &KnowledgeSourceBindingV1,
        revision: &SourceRevisionIdentity,
        path: &str,
    ) -> impl Future<Output = AppResult<Vec<u8>>> + Send;
    fn watch(
        &self,
        binding: &KnowledgeSourceBindingV1,
    ) -> impl Future<Output = AppResult<Self::Watch>> + Send;
    fn revoke(
        &self,
        binding: &KnowledgeSourceBindingV1,
    ) -> impl Future<Output = AppResult<()>> + Send;
}

pub(crate) trait KnowledgeGraphRepositoryPort: Clone + Send + Sync + 'static {
    /// Store a build candidate without changing the active graph revision.
    fn stage(&self, artifact: &GraphBuildArtifactV1) -> impl Future<Output = AppResult<()>> + Send;
    /// Atomically activate only a healthy candidate for the expected environment
    /// revision; a failed build leaves the previous last-good revision active.
    fn activate(
        &self,
        artifact: &GraphBuildArtifactV1,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn active_for_source(
        &self,
        source_id: Uuid,
    ) -> impl Future<Output = AppResult<Option<GraphBuildArtifactV1>>> + Send;
    fn active_set(
        &self,
        project_environment_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<GraphBuildArtifactV1>>> + Send;
    fn by_revision(
        &self,
        graph_revision_id: Uuid,
    ) -> impl Future<Output = AppResult<Option<GraphBuildArtifactV1>>> + Send;
    fn diff(
        &self,
        from_graph_revision_id: Uuid,
        to_graph_revision_id: Uuid,
    ) -> impl Future<Output = AppResult<GraphRevisionDiffV1>> + Send;
}

pub(crate) trait KnowledgeGrantPort: Clone + Send + Sync + 'static {
    fn save_grant(&self, grant: &KnowledgeGrant) -> impl Future<Output = AppResult<()>> + Send;
}

pub(crate) trait KnowledgeMappingRepositoryPort: Clone + Send + Sync + 'static {
    fn propose_mapping(
        &self,
        proposal: &KnowledgeMappingProposal,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn decide_mapping(
        &self,
        proposal_id: Uuid,
        expected_graph_revision_id: Uuid,
        state: MappingProposalState,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn mappings_for_revision(
        &self,
        project_environment_id: Uuid,
        graph_revision_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<KnowledgeMappingProposal>>> + Send;
}

/// Complete device-local persistence boundary consumed by the Knowledge
/// facade. The narrower graph/scope/grant/mapping ports remain reusable by the
/// extractor and store implementations, while this aggregate prevents the
/// facade from naming SQLite or the global `Store`.
pub(crate) trait KnowledgeRepositoryPort:
    KnowledgeScopeRepositoryPort
    + KnowledgeGraphRepositoryPort
    + KnowledgeGrantPort
    + KnowledgeMappingRepositoryPort
    + Clone
    + Send
    + Sync
    + 'static
{
    fn active_resource_scope(&self) -> impl Future<Output = AppResult<ActiveResourceScope>> + Send;
    fn knowledge_projects(
        &self,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<ProjectDefinition>>> + Send;
    fn knowledge_environment_exists(
        &self,
        workspace_id: Uuid,
        environment_id: Uuid,
    ) -> impl Future<Output = AppResult<bool>> + Send;
    fn create_knowledge_project(
        &self,
        workspace_id: Uuid,
        name: &str,
        environments: &[(String, EnvironmentRiskClass)],
    ) -> impl Future<Output = AppResult<ProjectDefinition>> + Send;
    fn create_knowledge_environment(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        name: &str,
        risk_class: EnvironmentRiskClass,
    ) -> impl Future<Output = AppResult<ProjectDefinition>> + Send;
    fn save_knowledge_project(
        &self,
        value: &ProjectDefinition,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn delete_knowledge_project(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        expected_revision: u64,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn retain_knowledge_projects(
        &self,
        workspace_id: Uuid,
        project_ids: &[Uuid],
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn pin_connection_for_read(
        &self,
        connection_id: Uuid,
    ) -> impl Future<Output = AppResult<PinnedConnection>> + Send;
    fn agent_knowledge_environments(
        &self,
        connection: &PinnedConnection,
    ) -> impl Future<Output = AppResult<Vec<KnowledgeEnvironmentSummary>>> + Send;
    fn knowledge_session_scope(
        &self,
        connection: &PinnedConnection,
        environment_id: Option<Uuid>,
    ) -> impl Future<Output = AppResult<Option<KnowledgeSessionScope>>> + Send;
    fn exact_knowledge_session_graphs(
        &self,
        scope: &KnowledgeSessionScope,
        workspace_id: Uuid,
        account_id: &str,
    ) -> impl Future<Output = AppResult<Vec<GraphBuildArtifactV1>>> + Send;
    fn active_knowledge_grant(
        &self,
        workspace_id: Uuid,
        account_id: &str,
        environment_id: Uuid,
        environment_revision: u64,
        graph_revision_ids: &[Uuid],
    ) -> impl Future<Output = AppResult<Option<Uuid>>> + Send;
    fn revoke_knowledge_grants_for_account(
        &self,
        workspace_id: Uuid,
        account_id: &str,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn import_granted_active_graph(
        &self,
        graph: &GraphBuildArtifactV1,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn retain_granted_environment_heads(
        &self,
        environment_id: Uuid,
        revisions: &[Uuid],
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn sync_remote_knowledge_mapping(
        &self,
        proposal: &KnowledgeMappingProposal,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn environment_connections(
        &self,
        workspace_id: Uuid,
        environment_id: Option<Uuid>,
    ) -> impl Future<Output = AppResult<Vec<EnvironmentConnectionBinding>>> + Send;
    #[allow(clippy::too_many_arguments)]
    fn bind_environment_connection(
        &self,
        binding_id: Uuid,
        connection: &PinnedConnection,
        environment_id: Uuid,
        role: &str,
        alias: &str,
    ) -> impl Future<Output = AppResult<EnvironmentConnectionBinding>> + Send;
    fn revoke_environment_connection(
        &self,
        workspace_id: Uuid,
        binding_id: Uuid,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn remote_connection_id(
        &self,
        connection: &PinnedConnection,
    ) -> impl Future<Output = AppResult<Option<Uuid>>> + Send;
    fn local_connection_id_for_remote(
        &self,
        workspace_id: Uuid,
        remote_id: Uuid,
    ) -> impl Future<Output = AppResult<Option<Uuid>>> + Send;
    fn local_connection_ids_for_remote(
        &self,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<(Uuid, Uuid)>>> + Send;
}

/// Authenticated workspace Knowledge authority. Implementations own all hosted
/// HTTP details and session-token access; callers receive only validated,
/// bounded DTOs and immutable graph artifacts.
pub(crate) trait HostedKnowledgeAuthorityPort: Clone + Send + Sync + 'static {
    fn ensure_personal_scope(
        &self,
        account_id: &str,
        projects: &[RemoteKnowledgeProject],
    ) -> impl Future<Output = AppResult<RemotePersonalKnowledgeScope>> + Send;
    fn list_projects(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<RemoteKnowledgeProject>>> + Send;
    fn create_project(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        request: &CreateKnowledgeProjectRequest,
    ) -> impl Future<Output = AppResult<RemoteKnowledgeProject>> + Send;
    fn delete_project(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        project_id: Uuid,
        expected_revision: u64,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn create_environment(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        project_id: Uuid,
        request: &AppendKnowledgeEnvironmentRequest,
    ) -> impl Future<Output = AppResult<RemoteKnowledgeProject>> + Send;
    fn list_current_grants(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<RemoteKnowledgeGrant>>> + Send;
    fn create_current_grant(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        member_id: &str,
        environment_id: Uuid,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn list_mappings(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<KnowledgeMappingProposal>>> + Send;
    fn propose_mapping(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        grant_id: Uuid,
        proposal: &KnowledgeMappingProposal,
    ) -> impl Future<Output = AppResult<KnowledgeMappingProposal>> + Send;
    fn decide_mapping(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        mapping_id: Uuid,
        expected_graph_revision_id: Uuid,
        decision: MappingProposalState,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn download_graph(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        grant_id: Uuid,
        source_id: Uuid,
        expected_graph_revision_id: Uuid,
    ) -> impl Future<Output = AppResult<GraphBuildArtifactV1>> + Send;
    fn list_environment_connections(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Option<Uuid>,
    ) -> impl Future<Output = AppResult<Vec<RemoteEnvironmentConnectionBinding>>> + Send;
    fn list_inventory(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<RemoteKnowledgeInventory>> + Send;
    #[allow(clippy::too_many_arguments)]
    fn bind_environment_connection(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Uuid,
        binding_id: Uuid,
        connection_id: Uuid,
        expected_connection_revision: i64,
        role: &str,
        alias: &str,
    ) -> impl Future<Output = AppResult<RemoteEnvironmentConnectionBinding>> + Send;
    fn revoke_environment_connection(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Uuid,
        binding_id: Uuid,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn begin_github_install(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<String>> + Send;
    fn list_github_repositories(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<RemoteGithubRepository>>> + Send;
    fn create_source(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        request: &CreateKnowledgeSourceRequest<'_>,
    ) -> impl Future<Output = AppResult<CreatedKnowledgeSource>> + Send;
    fn list_sources(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<RemoteKnowledgeSource>>> + Send;
    fn search_source(
        &self,
        request: &PinnedSourceSearchRequest<'_>,
    ) -> impl Future<Output = AppResult<RemoteSourceSearchResult>> + Send;
    fn read_source(
        &self,
        request: &PinnedSourceReadRequest<'_>,
    ) -> impl Future<Output = AppResult<RemoteSourceReadResult>> + Send;
    fn list_source_sync_progress(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<RemoteKnowledgeSyncProgress>>> + Send;
    fn request_source_sync(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        source_id: Uuid,
    ) -> impl Future<Output = AppResult<Option<Uuid>>> + Send;
    fn delete_source(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        source_id: Uuid,
    ) -> impl Future<Output = AppResult<()>> + Send;
}
