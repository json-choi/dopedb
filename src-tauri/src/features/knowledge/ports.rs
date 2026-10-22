//! GitHub source authority and Project resource persistence ports.

use std::future::Future;

use dopedb_protocol::KnowledgeSourceBindingV1;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppResult;
use crate::kernel::access::{ActiveResourceScope, PinnedConnection};
use crate::kernel::environment::EnvironmentKind;

use super::domain::{
    EnvironmentConnectionBinding, KnowledgeEnvironmentSummary, KnowledgeSessionScope,
    KnowledgeSessionSource, Project, ProjectDefinition, ProjectEnvironment, StoredKnowledgeScope,
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
    pub(crate) repository_id: Option<String>,
    pub(crate) repository_full_name: Option<String>,
    pub(crate) ref_name: Option<String>,
    pub(crate) commit_sha: Option<String>,
    pub(crate) sync_state: String,
    pub(crate) sync_revision: u64,
    pub(crate) last_failure_code: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreatedKnowledgeSource {
    pub(crate) id: Uuid,
    pub(crate) sync_revision: u64,
    pub(crate) environment_revision: u64,
    pub(crate) commit_sha: Option<String>,
}

/// The control plane still echoes the pre-kind `name` and `riskClass` fields for
/// older Desktops; this reader ignores them and trusts only `kind`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteKnowledgeEnvironment {
    pub(crate) id: Uuid,
    pub(crate) kind: EnvironmentKind,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateKnowledgeEnvironmentRequest {
    pub(crate) kind: EnvironmentKind,
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
    pub(crate) kind: EnvironmentKind,
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
    /// Persist only secret-free GitHub identity at one exact commit.
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
}

/// Complete device-local persistence boundary consumed by the Knowledge
/// facade. The source-scope port is shared with the store adapter; this aggregate prevents the
/// facade from naming SQLite or the global `Store`.
pub(crate) trait KnowledgeRepositoryPort:
    KnowledgeScopeRepositoryPort + Clone + Send + Sync + 'static
{
    fn active_resource_scope(&self) -> impl Future<Output = AppResult<ActiveResourceScope>> + Send;
    fn knowledge_projects(
        &self,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<ProjectDefinition>>> + Send;
    fn create_knowledge_project(
        &self,
        workspace_id: Uuid,
        name: &str,
        environments: &[EnvironmentKind],
    ) -> impl Future<Output = AppResult<ProjectDefinition>> + Send;
    fn create_knowledge_environment(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        kind: EnvironmentKind,
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
    /// Resolves the Environment scope anchored on `connection`. Only the anchor and
    /// `selected_connection_ids` are checked and returned, so an unselected stale
    /// binding never blocks a session that does not use it.
    fn knowledge_session_scope(
        &self,
        connection: &PinnedConnection,
        environment_id: Option<Uuid>,
        selected_connection_ids: &[Uuid],
    ) -> impl Future<Output = AppResult<Option<KnowledgeSessionScope>>> + Send;
    fn validate_knowledge_session_scope(
        &self,
        scope: &KnowledgeSessionScope,
        workspace_id: Uuid,
        account_id: &str,
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
/// bounded source identities and file responses.
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
    fn delete_source(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        source_id: Uuid,
    ) -> impl Future<Output = AppResult<()>> + Send;
}
