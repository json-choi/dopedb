//! Account-aware workspace feature.

pub(crate) mod adapters;
mod application;
pub(crate) mod domain;
mod ports;
pub(crate) mod transport;

use std::sync::Arc;

use crate::connection::ConnectionManager;
use crate::features::connections::ConnectionCredentialVault;
use crate::store::Store;

use adapters::{
    ConnectionWorkspaceRuntime, HostedWorkspaceControlPlane, ProcessWorkspaceConfiguration,
    SqliteWorkspaceRepository, SystemWorkspaceSshProfile,
};
pub(crate) use application::{
    WorkspaceConnectionCopyRequest, WorkspaceConnectionUpdateRequest,
    WorkspaceCredentialBindingRequest, WorkspaceUseCases,
};
pub(crate) use domain::{
    RemoteWorkspace, Workspace, WorkspaceAccountMembership, WorkspaceAuthAccount,
    WorkspaceAuthState, WorkspaceAuthUser, WorkspaceFeatureState, WorkspaceLifecycleState,
    WorkspaceLoginResult, WorkspaceLoginStatus, WorkspacePullPage, WorkspaceRole,
};

pub(crate) type WorkspacesFeature = WorkspaceUseCases<
    SqliteWorkspaceRepository,
    ConnectionWorkspaceRuntime,
    HostedWorkspaceControlPlane,
    dyn ConnectionCredentialVault,
    ProcessWorkspaceConfiguration,
    SystemWorkspaceSshProfile,
>;

pub(crate) fn compose(
    store: Store,
    connections: ConnectionManager,
    credentials: Arc<dyn ConnectionCredentialVault>,
) -> WorkspacesFeature {
    WorkspaceUseCases::new(
        SqliteWorkspaceRepository::new(store),
        ConnectionWorkspaceRuntime::new(connections),
        HostedWorkspaceControlPlane,
        credentials,
        ProcessWorkspaceConfiguration,
        SystemWorkspaceSshProfile,
    )
}
