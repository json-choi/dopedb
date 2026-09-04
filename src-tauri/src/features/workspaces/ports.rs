//! Platform ports required by workspace use cases.

use std::future::Future;

use uuid::Uuid;

use crate::error::AppResult;
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};
use crate::model::ConnectionProfile;

use super::domain::{
    RemoteWorkspace, Workspace, WorkspaceAuthAccount, WorkspaceAuthUser,
    WorkspaceAuthorityFingerprint, WorkspaceDeviceAuthorization, WorkspaceLoginPoll,
    WorkspacePullPage, WorkspaceRole,
};

pub(crate) trait WorkspaceRepositoryPort: Clone + Send + Sync + 'static {
    fn list_workspaces(&self) -> impl Future<Output = AppResult<Vec<Workspace>>> + Send;

    fn accounts(&self) -> impl Future<Output = AppResult<Vec<WorkspaceAuthAccount>>> + Send;

    fn active_account_id(&self) -> impl Future<Output = AppResult<Option<AccountId>>> + Send;

    fn active_workspace_id(&self) -> impl Future<Output = AppResult<WorkspaceId>> + Send;

    fn active_workspace(&self) -> impl Future<Output = AppResult<Workspace>> + Send;

    fn remember_account(
        &self,
        user: &WorkspaceAuthUser,
    ) -> impl Future<Output = AppResult<()>> + Send;

    fn authority_fingerprint(
        &self,
    ) -> impl Future<Output = AppResult<WorkspaceAuthorityFingerprint>> + Send;

    fn get_connection(
        &self,
        connection_id: ConnectionId,
    ) -> impl Future<Output = AppResult<ConnectionProfile>> + Send;

    fn bind_connection_credentials(
        &self,
        connection_id: ConnectionId,
        account_id: &AccountId,
        username: &str,
        extra_params: &std::collections::HashMap<String, String>,
        secret_ref: Option<&str>,
    ) -> impl Future<Output = AppResult<ConnectionProfile>> + Send;

    fn purge_remote_connection_cache(
        &self,
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
    ) -> impl Future<Output = AppResult<()>> + Send;

    fn workspace_pull_cursor(
        &self,
        workspace_id: WorkspaceId,
        account_id: &AccountId,
    ) -> impl Future<Output = AppResult<Option<i64>>> + Send;

    fn commit_workspace_pull_cursor(
        &self,
        workspace_id: WorkspaceId,
        account_id: &AccountId,
        expected_cursor: Option<i64>,
        page: WorkspacePullPage,
    ) -> impl Future<Output = AppResult<()>> + Send;
}

/// Applies and validates the OS-owned SSH transport configuration for a
/// member-local binding. The application layer does not know the concrete SSH
/// parameter name or invoke the system transport adapter directly.
pub(crate) trait WorkspaceSshProfilePort: Clone + Send + Sync + 'static {
    fn bind_alias(
        &self,
        profile: &ConnectionProfile,
        alias: Option<&str>,
    ) -> AppResult<std::collections::HashMap<String, String>>;
}

pub(crate) trait WorkspaceConnectionMutationPort: Send {
    fn profile(&self) -> &ConnectionProfile;
    fn selected_account_id(&self) -> AppResult<AccountId>;
    fn retire(self, connection_id: ConnectionId) -> impl Future<Output = ()> + Send;
}

pub(crate) trait WorkspaceRuntimePort: Clone + Send + Sync + 'static {
    type ConnectionMutation: WorkspaceConnectionMutationPort;

    fn activate_workspace(
        &self,
        workspace_id: WorkspaceId,
        account_id: Option<&AccountId>,
    ) -> impl Future<Output = AppResult<Workspace>> + Send;

    fn activate_account(
        &self,
        account_id: &AccountId,
    ) -> impl Future<Output = AppResult<Workspace>> + Send;

    fn remove_account(&self, account_id: &AccountId) -> impl Future<Output = AppResult<()>> + Send;

    fn sync_account_workspaces(
        &self,
        user: &WorkspaceAuthUser,
        workspaces: &[(WorkspaceId, String, WorkspaceRole)],
    ) -> impl Future<Output = AppResult<()>> + Send;

    fn sync_remote_connections(
        &self,
        workspace_id: WorkspaceId,
        account_id: &AccountId,
        connections: &[(ConnectionProfile, i64)],
    ) -> impl Future<Output = AppResult<Vec<Uuid>>> + Send;

    fn begin_connection_mutation(
        &self,
        connection_id: ConnectionId,
    ) -> impl Future<Output = AppResult<Self::ConnectionMutation>> + Send;
}

pub(crate) trait WorkspaceControlPlanePort: Clone + Send + Sync + 'static {
    fn begin_login(&self) -> impl Future<Output = AppResult<WorkspaceDeviceAuthorization>> + Send;

    fn poll_login(
        &self,
        device_code: &str,
    ) -> impl Future<Output = AppResult<WorkspaceLoginPoll>> + Send;

    fn auth_user(
        &self,
        account_id: &AccountId,
    ) -> impl Future<Output = AppResult<Option<WorkspaceAuthUser>>> + Send;

    fn sign_out(&self, account_id: &AccountId) -> impl Future<Output = AppResult<()>> + Send;

    fn remote_workspaces(
        &self,
        account_id: &AccountId,
    ) -> impl Future<Output = AppResult<Vec<RemoteWorkspace>>> + Send;

    fn workspace_pull_page(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        cursor: Option<i64>,
    ) -> impl Future<Output = AppResult<Option<WorkspacePullPage>>> + Send;

    fn remote_connections(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
    ) -> impl Future<Output = AppResult<Option<Vec<(ConnectionProfile, i64)>>>> + Send;

    fn share_connection(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        profile: &ConnectionProfile,
    ) -> impl Future<Output = AppResult<(ConnectionProfile, i64)>> + Send;

    fn update_connection(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        profile: &ConnectionProfile,
        expected_revision: i64,
    ) -> impl Future<Output = AppResult<(ConnectionProfile, i64)>> + Send;

    fn delete_connection(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
        expected_revision: i64,
    ) -> impl Future<Output = AppResult<()>> + Send;

    fn console_url(&self, workspace_id: Option<WorkspaceId>) -> AppResult<String>;
}

pub(crate) trait WorkspaceConfigurationPort: Clone + Send + Sync + 'static {
    fn feature_enabled(&self) -> bool;
}
