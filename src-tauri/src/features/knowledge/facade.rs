//! Project Knowledge application facade.
//!
//! It is the only shared entry point for local Knowledge persistence and hosted
//! Knowledge authority, keeping both `Store` and workspace HTTP adapters out of
//! transports, Analysis Articles, and the ACP Broker.

use dopedb_protocol::{
    GraphBuildArtifactV1, GraphRevisionDiffV1, KnowledgeSourceBindingV1, KnowledgeSourceProvider,
    KnowledgeSourceVisibility, SourceRevisionIdentity,
};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::access::{ActiveResourceScope, PinnedConnection, WorkspaceKind};

use super::domain::{
    validate_binding_draft, EnvironmentConnectionBinding, EnvironmentRiskClass,
    KnowledgeEnvironmentSummary, KnowledgeMappingProposal, KnowledgeSessionScope,
    MappingProposalState, Project, ProjectDefinition, ProjectEnvironment, SourceBindingDraft,
    SourceLocator, SourceSnapshot, StoredKnowledgeScope,
};
use super::ports::{
    AppendKnowledgeEnvironmentRequest, CreateKnowledgeProjectRequest, CreateKnowledgeSourceRequest,
    HostedKnowledgeAuthorityPort, KnowledgeRepositoryPort, PinnedSourceReadRequest,
    PinnedSourceSearchRequest, RemoteEnvironmentConnectionBinding, RemoteGithubRepository,
    RemoteKnowledgeInventory, RemoteKnowledgeProject, RemoteKnowledgeSource,
    RemoteKnowledgeSyncProgress, RemotePersonalKnowledgeScope, RemoteSourceReadResult,
    RemoteSourceSearchResult,
};
use super::KnowledgeAccessReconciliation;

#[derive(Clone)]
pub(crate) struct KnowledgeFeature<R, H> {
    repository: R,
    authority: H,
}

impl<R, H> KnowledgeFeature<R, H>
where
    R: KnowledgeRepositoryPort,
    H: HostedKnowledgeAuthorityPort,
{
    pub(crate) fn new(repository: R, authority: H) -> Self {
        Self {
            repository,
            authority,
        }
    }

    pub(crate) async fn active_resource_scope(&self) -> AppResult<ActiveResourceScope> {
        self.repository.active_resource_scope().await
    }

    /// Reconcile hosted grants and Environment bindings explicitly before an
    /// Agent or graph workflow consumes them. Read transports never trigger
    /// this mutation implicitly.
    pub(crate) async fn reconcile_current_access(
        &self,
    ) -> AppResult<KnowledgeAccessReconciliation> {
        let receipt =
            super::reconciliation::reconcile_current_access(&self.repository, &self.authority)
                .await?;
        tracing::debug!(
            projects = receipt.projects.len(),
            grants = receipt.grant_count,
            environment_bindings = receipt.environment_binding_count,
            "reconciled exact Project Knowledge access"
        );
        Ok(receipt)
    }

    pub(crate) async fn knowledge_projects(
        &self,
        workspace_id: Uuid,
    ) -> AppResult<Vec<ProjectDefinition>> {
        self.repository.knowledge_projects(workspace_id).await
    }

    pub(crate) async fn knowledge_environment_exists(
        &self,
        workspace_id: Uuid,
        environment_id: Uuid,
    ) -> AppResult<bool> {
        self.repository
            .knowledge_environment_exists(workspace_id, environment_id)
            .await
    }

    pub(crate) async fn create_knowledge_project(
        &self,
        workspace_id: Uuid,
        name: &str,
        environments: &[(String, EnvironmentRiskClass)],
    ) -> AppResult<ProjectDefinition> {
        self.repository
            .create_knowledge_project(workspace_id, name, environments)
            .await
    }

    pub(crate) async fn create_knowledge_environment(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        name: &str,
        risk_class: EnvironmentRiskClass,
    ) -> AppResult<ProjectDefinition> {
        self.repository
            .create_knowledge_environment(workspace_id, project_id, name, risk_class)
            .await
    }

    pub(crate) async fn save_knowledge_project(&self, value: &ProjectDefinition) -> AppResult<()> {
        self.repository.save_knowledge_project(value).await
    }

    pub(crate) async fn delete_knowledge_project(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        expected_revision: u64,
    ) -> AppResult<()> {
        self.repository
            .delete_knowledge_project(workspace_id, project_id, expected_revision)
            .await
    }

    pub(crate) async fn retain_knowledge_projects(
        &self,
        workspace_id: Uuid,
        project_ids: &[Uuid],
    ) -> AppResult<()> {
        self.repository
            .retain_knowledge_projects(workspace_id, project_ids)
            .await
    }

    pub(crate) async fn save_scope(
        &self,
        project: &Project,
        environment: &ProjectEnvironment,
        binding: &KnowledgeSourceBindingV1,
        environment_revision: u64,
    ) -> AppResult<()> {
        self.repository
            .save_scope(project, environment, binding, environment_revision)
            .await
    }

    pub(crate) async fn scopes(&self, workspace_id: Uuid) -> AppResult<Vec<StoredKnowledgeScope>> {
        self.repository.scopes(workspace_id).await
    }

    pub(crate) async fn remove_scope(&self, source_id: Uuid) -> AppResult<()> {
        self.repository.remove_scope(source_id).await
    }

    pub(crate) async fn save_snapshot(&self, snapshot: &SourceSnapshot) -> AppResult<()> {
        self.repository.save_snapshot(snapshot).await
    }

    pub(crate) async fn source_snapshot(
        &self,
        source_id: Uuid,
    ) -> AppResult<Option<SourceSnapshot>> {
        self.repository.source_snapshot(source_id).await
    }

    pub(crate) async fn stage(&self, graph: &GraphBuildArtifactV1) -> AppResult<()> {
        self.repository.stage(graph).await
    }

    pub(crate) async fn activate(&self, graph: &GraphBuildArtifactV1) -> AppResult<()> {
        self.repository.activate(graph).await
    }

    pub(crate) async fn active_for_source(
        &self,
        source_id: Uuid,
    ) -> AppResult<Option<GraphBuildArtifactV1>> {
        self.repository.active_for_source(source_id).await
    }

    pub(crate) async fn active_set(
        &self,
        environment_id: Uuid,
    ) -> AppResult<Vec<GraphBuildArtifactV1>> {
        self.repository.active_set(environment_id).await
    }

    pub(crate) async fn by_revision(
        &self,
        revision_id: Uuid,
    ) -> AppResult<Option<GraphBuildArtifactV1>> {
        self.repository.by_revision(revision_id).await
    }

    pub(crate) async fn diff(&self, from: Uuid, to: Uuid) -> AppResult<GraphRevisionDiffV1> {
        self.repository.diff(from, to).await
    }

    pub(crate) async fn pin_connection_for_read(&self, id: Uuid) -> AppResult<PinnedConnection> {
        self.repository.pin_connection_for_read(id).await
    }

    pub(crate) async fn agent_knowledge_environments(
        &self,
        connection: &PinnedConnection,
    ) -> AppResult<Vec<KnowledgeEnvironmentSummary>> {
        self.repository
            .agent_knowledge_environments(connection)
            .await
    }

    pub(crate) async fn knowledge_session_scope(
        &self,
        connection: &PinnedConnection,
        environment_id: Option<Uuid>,
    ) -> AppResult<Option<KnowledgeSessionScope>> {
        let mut scope = self
            .repository
            .knowledge_session_scope(connection, environment_id)
            .await?;
        let Some(scope) = scope.as_mut() else {
            return Ok(None);
        };
        if connection.scope.workspace_kind != WorkspaceKind::Team {
            return Ok(Some(scope.clone()));
        }
        let account_id = connection
            .scope
            .selected_account_id
            .as_deref()
            .ok_or_else(|| AppError::Blocked {
                reason: "Team Project Knowledge requires a selected account".into(),
            })?;
        let remote_bindings = self
            .authority
            .list_environment_connections(
                account_id,
                connection.scope.workspace_id,
                Some(scope.project_environment_id),
            )
            .await?;
        for scoped_connection in &mut scope.connections {
            let pinned = self
                .repository
                .pin_connection_for_read(scoped_connection.connection_id)
                .await?;
            let remote_id = self
                .repository
                .remote_connection_id(&pinned)
                .await?
                .ok_or_else(|| AppError::Blocked {
                    reason: "A shared Environment database has no hosted identity".into(),
                })?;
            let binding = remote_bindings
                .iter()
                .find(|binding| {
                    binding.connection_id == remote_id
                        && binding.role == scoped_connection.role
                        && binding.alias == scoped_connection.alias
                })
                .ok_or_else(|| AppError::Blocked {
                    reason:
                        "The hosted Environment database binding changed; start a new Agent session"
                            .into(),
                })?;
            if binding.stale
                || binding.connection_revision != scoped_connection.connection_revision
                || binding.connection_revision != binding.current_connection_revision
                || binding.connection_content_revision < 1
            {
                return Err(AppError::Blocked {
                    reason: "The hosted Environment database authority changed; start a new Agent session"
                        .into(),
                });
            }
            scoped_connection.remote_connection_id = Some(remote_id);
            scoped_connection.connection_content_revision = binding.connection_content_revision;
        }
        Ok(Some(scope.clone()))
    }

    /// Resolve the current internal authority epoch for one durable Analysis
    /// Article content pin. The caller still compares this value with its
    /// device-local pin before opening a credential.
    pub(crate) async fn analysis_connection_authority_revision(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Uuid,
        remote_connection_id: Uuid,
        content_revision: i64,
    ) -> AppResult<i64> {
        let bindings = self
            .authority
            .list_environment_connections(account_id, workspace_id, Some(environment_id))
            .await?;
        let binding = bindings
            .iter()
            .find(|binding| binding.connection_id == remote_connection_id)
            .ok_or_else(|| AppError::Blocked {
                reason: "The Analysis Article database is no longer bound to this Environment"
                    .into(),
            })?;
        if binding.stale
            || binding.connection_content_revision != content_revision
            || binding.connection_revision != binding.current_connection_revision
        {
            return Err(AppError::Blocked {
                reason:
                    "The Analysis Article database authority or shared connection content changed"
                        .into(),
            });
        }
        Ok(binding.connection_revision)
    }

    pub(crate) async fn exact_knowledge_session_graphs(
        &self,
        scope: &KnowledgeSessionScope,
        workspace_id: Uuid,
        account_id: &str,
    ) -> AppResult<Vec<GraphBuildArtifactV1>> {
        self.repository
            .exact_knowledge_session_graphs(scope, workspace_id, account_id)
            .await
    }

    pub(crate) async fn search_source(
        &self,
        request: &PinnedSourceSearchRequest<'_>,
    ) -> AppResult<RemoteSourceSearchResult> {
        self.authority.search_source(request).await
    }

    pub(crate) async fn read_source(
        &self,
        request: &PinnedSourceReadRequest<'_>,
    ) -> AppResult<RemoteSourceReadResult> {
        self.authority.read_source(request).await
    }

    pub(crate) async fn active_knowledge_grant(
        &self,
        workspace_id: Uuid,
        account_id: &str,
        environment_id: Uuid,
        environment_revision: u64,
        graph_revision_ids: &[Uuid],
    ) -> AppResult<Option<Uuid>> {
        self.repository
            .active_knowledge_grant(
                workspace_id,
                account_id,
                environment_id,
                environment_revision,
                graph_revision_ids,
            )
            .await
    }

    pub(crate) async fn sync_remote_knowledge_mapping(
        &self,
        proposal: &KnowledgeMappingProposal,
    ) -> AppResult<()> {
        self.repository
            .sync_remote_knowledge_mapping(proposal)
            .await
    }

    pub(crate) async fn propose_mapping(
        &self,
        proposal: &KnowledgeMappingProposal,
    ) -> AppResult<()> {
        self.repository.propose_mapping(proposal).await
    }

    pub(crate) async fn decide_mapping(
        &self,
        proposal_id: Uuid,
        revision_id: Uuid,
        state: MappingProposalState,
    ) -> AppResult<()> {
        self.repository
            .decide_mapping(proposal_id, revision_id, state)
            .await
    }

    pub(crate) async fn mappings_for_revision(
        &self,
        environment_id: Uuid,
        revision_id: Uuid,
    ) -> AppResult<Vec<KnowledgeMappingProposal>> {
        self.repository
            .mappings_for_revision(environment_id, revision_id)
            .await
    }

    pub(crate) async fn environment_connections(
        &self,
        workspace_id: Uuid,
        environment_id: Option<Uuid>,
    ) -> AppResult<Vec<EnvironmentConnectionBinding>> {
        self.repository
            .environment_connections(workspace_id, environment_id)
            .await
    }

    pub(crate) async fn bind_environment_connection(
        &self,
        binding_id: Uuid,
        connection: &PinnedConnection,
        environment_id: Uuid,
        role: &str,
        alias: &str,
    ) -> AppResult<EnvironmentConnectionBinding> {
        self.repository
            .bind_environment_connection(binding_id, connection, environment_id, role, alias)
            .await
    }

    pub(crate) async fn revoke_environment_connection(
        &self,
        workspace_id: Uuid,
        binding_id: Uuid,
    ) -> AppResult<()> {
        self.repository
            .revoke_environment_connection(workspace_id, binding_id)
            .await
    }

    pub(crate) async fn remote_connection_id(
        &self,
        connection: &PinnedConnection,
    ) -> AppResult<Option<Uuid>> {
        self.repository.remote_connection_id(connection).await
    }

    pub(crate) async fn local_connection_id_for_remote(
        &self,
        workspace_id: Uuid,
        remote_id: Uuid,
    ) -> AppResult<Option<Uuid>> {
        self.repository
            .local_connection_id_for_remote(workspace_id, remote_id)
            .await
    }

    pub(crate) async fn local_connection_ids_for_remote(
        &self,
        workspace_id: Uuid,
    ) -> AppResult<Vec<(Uuid, Uuid)>> {
        self.repository
            .local_connection_ids_for_remote(workspace_id)
            .await
    }

    pub(crate) async fn propose_remote_mapping(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        grant_id: Uuid,
        proposal: &KnowledgeMappingProposal,
    ) -> AppResult<KnowledgeMappingProposal> {
        self.authority
            .propose_mapping(account_id, workspace_id, grant_id, proposal)
            .await
    }

    pub(crate) async fn ensure_personal_scope(
        &self,
        account_id: &str,
        projects: &[RemoteKnowledgeProject],
    ) -> AppResult<RemotePersonalKnowledgeScope> {
        self.authority
            .ensure_personal_scope(account_id, projects)
            .await
    }

    pub(crate) async fn list_remote_projects(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<Vec<RemoteKnowledgeProject>> {
        self.authority.list_projects(account_id, workspace_id).await
    }

    pub(crate) async fn create_remote_project(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        request: &CreateKnowledgeProjectRequest,
    ) -> AppResult<RemoteKnowledgeProject> {
        self.authority
            .create_project(account_id, workspace_id, request)
            .await
    }

    pub(crate) async fn delete_remote_project(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        project_id: Uuid,
        expected_revision: u64,
    ) -> AppResult<()> {
        self.authority
            .delete_project(account_id, workspace_id, project_id, expected_revision)
            .await
    }

    pub(crate) async fn create_remote_environment(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        project_id: Uuid,
        request: &AppendKnowledgeEnvironmentRequest,
    ) -> AppResult<RemoteKnowledgeProject> {
        self.authority
            .create_environment(account_id, workspace_id, project_id, request)
            .await
    }

    pub(crate) async fn list_remote_mappings(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<Vec<KnowledgeMappingProposal>> {
        self.authority.list_mappings(account_id, workspace_id).await
    }

    pub(crate) async fn decide_remote_mapping(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        mapping_id: Uuid,
        expected_graph_revision_id: Uuid,
        decision: MappingProposalState,
    ) -> AppResult<()> {
        self.authority
            .decide_mapping(
                account_id,
                workspace_id,
                mapping_id,
                expected_graph_revision_id,
                decision,
            )
            .await
    }

    pub(crate) async fn list_remote_environment_connections(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Option<Uuid>,
    ) -> AppResult<Vec<RemoteEnvironmentConnectionBinding>> {
        self.authority
            .list_environment_connections(account_id, workspace_id, environment_id)
            .await
    }

    pub(crate) async fn list_remote_inventory(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<RemoteKnowledgeInventory> {
        self.authority
            .list_inventory(account_id, workspace_id)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn bind_remote_environment_connection(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Uuid,
        binding_id: Uuid,
        connection_id: Uuid,
        expected_connection_revision: i64,
        role: &str,
        alias: &str,
    ) -> AppResult<RemoteEnvironmentConnectionBinding> {
        self.authority
            .bind_environment_connection(
                account_id,
                workspace_id,
                environment_id,
                binding_id,
                connection_id,
                expected_connection_revision,
                role,
                alias,
            )
            .await
    }

    pub(crate) async fn revoke_remote_environment_connection(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Uuid,
        binding_id: Uuid,
    ) -> AppResult<()> {
        self.authority
            .revoke_environment_connection(account_id, workspace_id, environment_id, binding_id)
            .await
    }

    pub(crate) async fn begin_github_install(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<String> {
        self.authority
            .begin_github_install(account_id, workspace_id)
            .await
    }

    pub(crate) async fn list_github_repositories(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<Vec<RemoteGithubRepository>> {
        self.authority
            .list_github_repositories(account_id, workspace_id)
            .await
    }

    pub(crate) async fn bind_github_source(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment: &ProjectEnvironment,
        draft: &SourceBindingDraft,
    ) -> AppResult<KnowledgeSourceBindingV1> {
        validate_binding_draft(draft, environment)?;
        let SourceLocator::Github {
            installation_id,
            repository_id,
            repository,
            ref_name,
        } = &draft.locator
        else {
            return Err(crate::error::AppError::Config(
                "the GitHub source received another provider".into(),
            ));
        };
        let created = self
            .authority
            .create_source(
                account_id,
                workspace_id,
                &CreateKnowledgeSourceRequest {
                    source_id: draft.source_id,
                    provider: "github",
                    project_id: draft.project_id,
                    project_environment_id: draft.project_environment_id,
                    display_name: &draft.display_name,
                    installation_id: *installation_id,
                    repository_id,
                    repository_full_name: repository,
                    ref_name,
                },
            )
            .await?;
        let commit_sha = created.commit_sha.ok_or_else(|| {
            crate::error::AppError::Network(
                "GitHub source registration omitted its exact commit".into(),
            )
        })?;
        if created.environment_revision != environment.revision {
            return Err(crate::error::AppError::Blocked {
                reason: "GitHub source registration crossed its Environment revision".into(),
            });
        }
        let binding = KnowledgeSourceBindingV1 {
            source_id: draft.source_id,
            project_id: draft.project_id,
            project_environment_id: draft.project_environment_id,
            provider: KnowledgeSourceProvider::Github,
            display_name: draft.display_name.trim().to_owned(),
            visibility: KnowledgeSourceVisibility::SharedGraph,
            revision: SourceRevisionIdentity::Github {
                repository_id: repository_id.clone(),
                repository: repository.clone(),
                ref_name: ref_name.clone(),
                commit_sha,
            },
        };
        if !binding.validate() {
            return Err(crate::error::AppError::Network(
                "GitHub source registration returned an invalid identity".into(),
            ));
        }
        Ok(binding)
    }

    pub(crate) async fn list_remote_sources(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<Vec<RemoteKnowledgeSource>> {
        self.authority.list_sources(account_id, workspace_id).await
    }

    pub(crate) async fn list_remote_source_sync_progress(
        &self,
        account_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<Vec<RemoteKnowledgeSyncProgress>> {
        self.authority
            .list_source_sync_progress(account_id, workspace_id)
            .await
    }

    pub(crate) async fn request_remote_source_sync(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        source_id: Uuid,
    ) -> AppResult<Option<Uuid>> {
        self.authority
            .request_source_sync(account_id, workspace_id, source_id)
            .await
    }

    pub(crate) async fn delete_remote_source(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        source_id: Uuid,
    ) -> AppResult<()> {
        self.authority
            .delete_source(account_id, workspace_id, source_id)
            .await
    }
}
