//! SQLite-backed Project Knowledge repository adapter.
//!
//! The application facade owns this concrete adapter, preventing Tauri,
//! Analysis Articles, and the Broker from receiving a raw global `Store`.

use dopedb_protocol::KnowledgeSourceBindingV1;
use uuid::Uuid;

use crate::error::AppResult;
use crate::kernel::access::{ActiveResourceScope, PinnedConnection};
use crate::kernel::environment::EnvironmentKind;
use crate::store::Store;

use super::super::domain::{
    EnvironmentConnectionBinding, KnowledgeEnvironmentSummary, KnowledgeSessionScope, Project,
    ProjectDefinition, ProjectEnvironment, StoredKnowledgeScope,
};
use super::super::ports::{KnowledgeRepositoryPort, KnowledgeScopeRepositoryPort};

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
        environments: &[EnvironmentKind],
    ) -> AppResult<ProjectDefinition> {
        self.store
            .create_knowledge_project(workspace_id, name, environments)
            .await
    }

    async fn create_knowledge_environment(
        &self,
        workspace_id: Uuid,
        project_id: Uuid,
        kind: EnvironmentKind,
    ) -> AppResult<ProjectDefinition> {
        self.store
            .create_knowledge_environment(workspace_id, project_id, kind)
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
        selected_connection_ids: &[Uuid],
    ) -> AppResult<Option<KnowledgeSessionScope>> {
        self.store
            .knowledge_session_scope(connection, environment_id, selected_connection_ids)
            .await
    }

    async fn validate_knowledge_session_scope(
        &self,
        scope: &KnowledgeSessionScope,
        workspace_id: Uuid,
        account_id: &str,
    ) -> AppResult<()> {
        self.store
            .validate_knowledge_session_scope(scope, workspace_id, account_id)
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
