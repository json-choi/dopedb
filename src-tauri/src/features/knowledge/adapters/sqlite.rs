//! SQLite-backed Project Knowledge repository adapter.
//!
//! The application facade owns this concrete adapter, preventing Tauri,
//! Analysis Articles, and the Broker from receiving a raw global `Store`.

use dopedb_protocol::{GraphBuildArtifactV1, GraphRevisionDiffV1, KnowledgeSourceBindingV1};
use uuid::Uuid;

use crate::error::AppResult;
use crate::kernel::access::{ActiveResourceScope, PinnedConnection};
use crate::store::Store;

use super::super::domain::{
    EnvironmentConnectionBinding, EnvironmentRiskClass, KnowledgeEnvironmentSummary,
    KnowledgeGrant, KnowledgeMappingProposal, KnowledgeSessionScope, Project, ProjectDefinition,
    ProjectEnvironment, SourceSnapshot, StoredKnowledgeScope,
};
use super::super::ports::{
    KnowledgeGrantPort, KnowledgeGraphRepositoryPort, KnowledgeMappingRepositoryPort,
    KnowledgeRepositoryPort, KnowledgeScopeRepositoryPort,
};

#[derive(Clone)]
pub(crate) struct SqliteKnowledgeRepository {
    store: Store,
}

impl KnowledgeScopeRepositoryPort for SqliteKnowledgeRepository {
    async fn save_scope(
        &self,
        project: &Project,
        environment: &ProjectEnvironment,
        binding: &KnowledgeSourceBindingV1,
        environment_revision: u64,
    ) -> AppResult<()> {
        self.store
            .save_scope(project, environment, binding, environment_revision)
            .await
    }

    async fn scopes(&self, workspace_id: Uuid) -> AppResult<Vec<StoredKnowledgeScope>> {
        self.store.scopes(workspace_id).await
    }

    async fn remove_scope(&self, source_id: Uuid) -> AppResult<()> {
        self.store.remove_scope(source_id).await
    }

    async fn save_snapshot(&self, snapshot: &SourceSnapshot) -> AppResult<()> {
        self.store.save_snapshot(snapshot).await
    }

    async fn source_snapshot(&self, source_id: Uuid) -> AppResult<Option<SourceSnapshot>> {
        self.store.source_snapshot(source_id).await
    }
}

impl KnowledgeGraphRepositoryPort for SqliteKnowledgeRepository {
    async fn stage(&self, artifact: &GraphBuildArtifactV1) -> AppResult<()> {
        self.store.stage(artifact).await
    }

    async fn activate(&self, artifact: &GraphBuildArtifactV1) -> AppResult<()> {
        self.store.activate(artifact).await
    }

    async fn active_for_source(&self, source_id: Uuid) -> AppResult<Option<GraphBuildArtifactV1>> {
        self.store.active_for_source(source_id).await
    }

    async fn by_revision(
        &self,
        graph_revision_id: Uuid,
    ) -> AppResult<Option<GraphBuildArtifactV1>> {
        self.store.by_revision(graph_revision_id).await
    }

    async fn diff(
        &self,
        from_graph_revision_id: Uuid,
        to_graph_revision_id: Uuid,
    ) -> AppResult<GraphRevisionDiffV1> {
        self.store
            .diff(from_graph_revision_id, to_graph_revision_id)
            .await
    }
}

impl KnowledgeGrantPort for SqliteKnowledgeRepository {
    async fn save_grant(&self, grant: &KnowledgeGrant) -> AppResult<()> {
        self.store.save_grant(grant).await
    }
}

impl KnowledgeMappingRepositoryPort for SqliteKnowledgeRepository {
    async fn propose_mapping(&self, proposal: &KnowledgeMappingProposal) -> AppResult<()> {
        self.store.propose_mapping(proposal).await
    }
}

impl KnowledgeRepositoryPort for SqliteKnowledgeRepository {
    async fn active_resource_scope(&self) -> AppResult<ActiveResourceScope> {
        self.store.active_resource_scope().await
    }

    async fn knowledge_projects(&self, workspace_id: Uuid) -> AppResult<Vec<ProjectDefinition>> {
        self.store.knowledge_projects(workspace_id).await
    }

    async fn create_knowledge_project(
        &self,
        workspace_id: Uuid,
        name: &str,
        environments: &[(String, EnvironmentRiskClass)],
    ) -> AppResult<ProjectDefinition> {
        self.store
            .create_knowledge_project(workspace_id, name, environments)
            .await
    }

    async fn create_knowledge_environment(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        name: &str,
        risk_class: EnvironmentRiskClass,
    ) -> AppResult<ProjectDefinition> {
        self.store
            .create_knowledge_environment(workspace_id, project_id, name, risk_class)
            .await
    }

    async fn save_knowledge_project(&self, value: &ProjectDefinition) -> AppResult<()> {
        self.store.save_knowledge_project(value).await
    }

    async fn delete_knowledge_project(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        expected_revision: u64,
    ) -> AppResult<()> {
        self.store
            .delete_knowledge_project(workspace_id, project_id, expected_revision)
            .await
    }

    async fn retain_knowledge_projects(
        &self,
        workspace_id: Uuid,
        project_ids: &[Uuid],
    ) -> AppResult<()> {
        self.store
            .retain_knowledge_projects(workspace_id, project_ids)
            .await
    }

    async fn pin_connection_for_read(&self, connection_id: Uuid) -> AppResult<PinnedConnection> {
        self.store.pin_connection_for_read(connection_id).await
    }

    async fn agent_knowledge_environments(
        &self,
        connection: &PinnedConnection,
    ) -> AppResult<Vec<KnowledgeEnvironmentSummary>> {
        self.store.agent_knowledge_environments(connection).await
    }

    async fn knowledge_session_scope(
        &self,
        connection: &PinnedConnection,
        environment_id: Option<Uuid>,
    ) -> AppResult<Option<KnowledgeSessionScope>> {
        self.store
            .knowledge_session_scope(connection, environment_id)
            .await
    }

    async fn exact_knowledge_session_graphs(
        &self,
        scope: &KnowledgeSessionScope,
        workspace_id: Uuid,
        account_id: &str,
    ) -> AppResult<Vec<GraphBuildArtifactV1>> {
        self.store
            .exact_knowledge_session_graphs(scope, workspace_id, account_id)
            .await
    }

    async fn revoke_knowledge_grants_for_account(
        &self,
        workspace_id: Uuid,
        account_id: &str,
    ) -> AppResult<()> {
        self.store
            .revoke_knowledge_grants_for_account(workspace_id, account_id)
            .await
    }

    async fn import_granted_active_graph(&self, graph: &GraphBuildArtifactV1) -> AppResult<()> {
        self.store.import_granted_active_graph(graph).await
    }

    async fn retain_granted_environment_heads(
        &self,
        environment_id: Uuid,
        revisions: &[Uuid],
    ) -> AppResult<()> {
        self.store
            .retain_granted_environment_heads(environment_id, revisions)
            .await
    }

    async fn environment_connections(
        &self,
        workspace_id: Uuid,
        environment_id: Option<Uuid>,
    ) -> AppResult<Vec<EnvironmentConnectionBinding>> {
        self.store
            .environment_connections(workspace_id, environment_id)
            .await
    }

    async fn bind_environment_connection(
        &self,
        binding_id: Uuid,
        connection: &PinnedConnection,
        environment_id: Uuid,
        role: &str,
        alias: &str,
    ) -> AppResult<EnvironmentConnectionBinding> {
        self.store
            .bind_environment_connection(binding_id, connection, environment_id, role, alias)
            .await
    }

    async fn revoke_environment_connection(
        &self,
        workspace_id: Uuid,
        binding_id: Uuid,
    ) -> AppResult<()> {
        self.store
            .revoke_environment_connection(workspace_id, binding_id)
            .await
    }

    async fn remote_connection_id(&self, connection: &PinnedConnection) -> AppResult<Option<Uuid>> {
        self.store.remote_connection_id(connection).await
    }

    async fn local_connection_id_for_remote(
        &self,
        workspace_id: Uuid,
        remote_id: Uuid,
    ) -> AppResult<Option<Uuid>> {
        self.store
            .local_connection_id_for_remote(workspace_id, remote_id)
            .await
    }

    async fn local_connection_ids_for_remote(
        &self,
        workspace_id: Uuid,
    ) -> AppResult<Vec<(Uuid, Uuid)>> {
        self.store
            .local_connection_ids_for_remote(workspace_id)
            .await
    }
}

impl SqliteKnowledgeRepository {
    pub(crate) fn new(store: Store) -> Self {
        Self { store }
    }
}
