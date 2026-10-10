//! Local SQLite, connection-runtime, and process-configuration adapters.

use std::collections::HashMap;

use uuid::Uuid;

use crate::connection::{ConnectionAccess, ConnectionManager, ConnectionMutation};
use crate::error::{AppError, AppResult};
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};
use crate::model::ConnectionProfile;
use crate::store::Store;

use super::super::domain::{
    workspace_feature_enabled, Workspace, WorkspaceAuthAccount, WorkspaceAuthUser,
    WorkspaceAuthorityFingerprint, WorkspacePullPage, WorkspaceRole,
};
use super::super::ports::{
    WorkspaceConfigurationPort, WorkspaceConnectionMutationPort, WorkspaceRepositoryPort,
    WorkspaceRuntimePort, WorkspaceSshProfilePort,
};

#[derive(Clone, Copy)]
pub(crate) struct SystemWorkspaceSshProfile;

impl WorkspaceSshProfilePort for SystemWorkspaceSshProfile {
    fn bind_alias(
        &self,
        profile: &ConnectionProfile,
        alias: Option<&str>,
    ) -> AppResult<HashMap<String, String>> {
        let mut extra_params = profile.extra_params.clone();
        if let Some(alias) = alias {
            let alias = alias.trim();
            if alias.is_empty() {
                extra_params.remove(crate::connection::ssh::SSH_ALIAS_PARAMETER);
            } else {
                extra_params.insert(
                    crate::connection::ssh::SSH_ALIAS_PARAMETER.into(),
                    alias.into(),
                );
            }
        }
        let mut candidate = profile.clone();
        candidate.extra_params = extra_params.clone();
        crate::connection::ssh::validate_profile(&candidate)?;
        Ok(extra_params)
    }
}

#[derive(Clone)]
pub(crate) struct SqliteWorkspaceRepository {
    store: Store,
}

impl SqliteWorkspaceRepository {
    pub(crate) fn new(store: Store) -> Self {
        Self { store }
    }
}

impl WorkspaceRepositoryPort for SqliteWorkspaceRepository {
    async fn defer_credential_delete(&self, credential_id: Uuid) -> AppResult<()> {
        self.store.defer_credential_delete(credential_id).await
    }

    async fn list_workspaces(&self) -> AppResult<Vec<Workspace>> {
        self.store.list_workspaces().await
    }

    async fn accounts(&self) -> AppResult<Vec<WorkspaceAuthAccount>> {
        self.store.workspace_accounts().await
    }

    async fn active_account_id(&self) -> AppResult<Option<AccountId>> {
        self.store
            .active_workspace_account_id()
            .await?
            .map(|value| {
                AccountId::new(value)
                    .ok_or_else(|| AppError::Config("active workspace account id is empty".into()))
            })
            .transpose()
    }

    async fn active_workspace_id(&self) -> AppResult<WorkspaceId> {
        Ok(self.store.active_workspace_id().await?.into())
    }

    async fn active_workspace(&self) -> AppResult<Workspace> {
        self.store.active_workspace().await
    }

    async fn remember_account(&self, user: &WorkspaceAuthUser) -> AppResult<()> {
        self.store.remember_workspace_account(user).await
    }

    async fn authority_fingerprint(&self) -> AppResult<WorkspaceAuthorityFingerprint> {
        let scope = self.store.active_resource_scope().await?;
        let connections = self
            .store
            .active_connection_authority_fingerprint()
            .await?
            .into_iter()
            .map(|(id, connection_revision, binding_revision)| {
                (
                    ConnectionId::from(id),
                    connection_revision,
                    binding_revision,
                )
            })
            .collect();
        let mut grants = self
            .store
            .workspace_accounts()
            .await?
            .into_iter()
            .flat_map(|account| {
                let account_id = account.user.id;
                account.memberships.into_iter().map(move |membership| {
                    (account_id.clone(), membership.workspace_id, membership.role)
                })
            })
            .collect::<Vec<_>>();
        grants.sort();
        Ok(WorkspaceAuthorityFingerprint {
            workspace_id: scope.workspace_id.into(),
            account_scope: scope.account_scope.storage_key().to_owned(),
            generation: scope.generation,
            connections,
            grants,
        })
    }

    async fn get_connection(&self, connection_id: ConnectionId) -> AppResult<ConnectionProfile> {
        self.store.get_connection(connection_id.into()).await
    }

    async fn bind_connection_credentials(
        &self,
        connection_id: ConnectionId,
        account_id: &AccountId,
        username: &str,
        extra_params: &HashMap<String, String>,
        secret_ref: Option<&str>,
    ) -> AppResult<ConnectionProfile> {
        self.store
            .bind_connection_credentials(
                connection_id.into(),
                account_id.as_str(),
                username,
                extra_params,
                secret_ref,
            )
            .await
    }

    async fn purge_remote_connection_cache(
        &self,
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
    ) -> AppResult<()> {
        self.store
            .purge_remote_connection_cache(workspace_id.into(), connection_id.into())
            .await
    }

    async fn workspace_pull_cursor(
        &self,
        workspace_id: WorkspaceId,
        account_id: &AccountId,
    ) -> AppResult<Option<i64>> {
        self.store
            .workspace_pull_cursor(workspace_id.into(), account_id.as_str())
            .await
    }

    async fn commit_workspace_pull_cursor(
        &self,
        workspace_id: WorkspaceId,
        account_id: &AccountId,
        expected_cursor: Option<i64>,
        page: WorkspacePullPage,
    ) -> AppResult<()> {
        self.store
            .commit_workspace_pull_cursor(
                workspace_id.into(),
                account_id.as_str(),
                expected_cursor,
                page,
            )
            .await
    }
}

pub(crate) struct RuntimeWorkspaceConnectionMutation {
    inner: ConnectionMutation,
}

impl WorkspaceConnectionMutationPort for RuntimeWorkspaceConnectionMutation {
    fn profile(&self) -> &ConnectionProfile {
        &self.inner.pin().profile
    }

    fn selected_account_id(&self) -> AppResult<AccountId> {
        self.inner
            .pin()
            .scope
            .selected_account_id
            .clone()
            .and_then(AccountId::new)
            .ok_or_else(|| AppError::Config("no active workspace account".into()))
    }

    async fn retire(self, connection_id: ConnectionId) {
        self.inner.retire_connection(connection_id.into()).await;
    }
}

#[derive(Clone)]
pub(crate) struct ConnectionWorkspaceRuntime {
    connections: ConnectionManager,
}

impl ConnectionWorkspaceRuntime {
    pub(crate) fn new(connections: ConnectionManager) -> Self {
        Self { connections }
    }
}

impl WorkspaceRuntimePort for ConnectionWorkspaceRuntime {
    type ConnectionMutation = RuntimeWorkspaceConnectionMutation;

    async fn activate_workspace(
        &self,
        workspace_id: WorkspaceId,
        account_id: Option<&AccountId>,
    ) -> AppResult<Workspace> {
        self.connections
            .activate_workspace(workspace_id.into(), account_id.map(AccountId::as_str))
            .await
    }

    async fn activate_account(&self, account_id: &AccountId) -> AppResult<Workspace> {
        self.connections
            .activate_workspace_account(account_id.as_str())
            .await
    }

    async fn remove_account(&self, account_id: &AccountId) -> AppResult<()> {
        self.connections
            .remove_workspace_account(account_id.as_str())
            .await
    }

    async fn sync_account_workspaces(
        &self,
        user: &WorkspaceAuthUser,
        workspaces: &[(WorkspaceId, String, WorkspaceRole)],
    ) -> AppResult<()> {
        let workspaces = workspaces
            .iter()
            .map(|(id, name, role)| (Uuid::from(*id), name.clone(), *role))
            .collect::<Vec<_>>();
        self.connections
            .sync_account_workspaces(user, &workspaces)
            .await
    }

    async fn sync_remote_connections(
        &self,
        workspace_id: WorkspaceId,
        account_id: &AccountId,
        connections: &[(ConnectionProfile, i64)],
    ) -> AppResult<Vec<Uuid>> {
        self.connections
            .sync_remote_connections(workspace_id.into(), account_id.as_str(), connections)
            .await
    }

    async fn begin_connection_mutation(
        &self,
        connection_id: ConnectionId,
    ) -> AppResult<Self::ConnectionMutation> {
        Ok(RuntimeWorkspaceConnectionMutation {
            inner: self
                .connections
                .begin_connection_mutation(connection_id.into(), ConnectionAccess::Read)
                .await?,
        })
    }
}

#[derive(Clone, Copy)]
pub(crate) struct ProcessWorkspaceConfiguration;

impl WorkspaceConfigurationPort for ProcessWorkspaceConfiguration {
    fn feature_enabled(&self) -> bool {
        workspace_feature_enabled(std::env::var("DOPEDB_WORKSPACES_ENABLED").ok().as_deref())
    }
}
