//! Account-aware workspace use cases.
//!
//! Mutation ordering and rollback policy live in the child modules. SQLite, hosted
//! HTTP, keychain, connection-pool, environment, and Tauri details remain behind
//! ports.

mod authentication;
mod navigation;
mod sharing;

use std::sync::Arc;

use zeroize::Zeroizing;

use crate::features::connections::ConnectionCredentialVault;
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};

use super::ports::{
    WorkspaceConfigurationPort, WorkspaceControlPlanePort, WorkspaceRepositoryPort,
    WorkspaceRuntimePort, WorkspaceSshProfilePort,
};

pub(crate) struct WorkspaceConnectionCopyRequest {
    pub(crate) connection_id: ConnectionId,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) account_user_id: AccountId,
    /// Project assignment may publish a team-local connection into its current
    /// workspace before binding it. The general copy dialog keeps requiring a
    /// different workspace so this narrower path stays explicit.
    pub(crate) allow_active_workspace: bool,
}

pub(crate) struct WorkspaceCredentialBindingRequest {
    pub(crate) connection_id: ConnectionId,
    pub(crate) username: String,
    pub(crate) password: Zeroizing<String>,
    pub(crate) ssh_alias: Option<String>,
}

pub(crate) struct WorkspaceConnectionUpdateRequest {
    pub(crate) profile: crate::model::ConnectionProfile,
}

pub(crate) struct WorkspaceUseCases<R, A, C, V, E, S>
where
    V: ConnectionCredentialVault + ?Sized,
{
    pub(super) repository: R,
    pub(super) runtime: A,
    pub(super) control_plane: C,
    pub(super) credentials: Arc<V>,
    pub(super) configuration: E,
    pub(super) ssh_profiles: S,
    pub(super) sync_lock: Arc<tokio::sync::Mutex<()>>,
}

impl<R, A, C, V, E, S> Clone for WorkspaceUseCases<R, A, C, V, E, S>
where
    R: Clone,
    A: Clone,
    C: Clone,
    V: ConnectionCredentialVault + ?Sized,
    E: Clone,
    S: Clone,
{
    fn clone(&self) -> Self {
        Self {
            repository: self.repository.clone(),
            runtime: self.runtime.clone(),
            control_plane: self.control_plane.clone(),
            credentials: Arc::clone(&self.credentials),
            configuration: self.configuration.clone(),
            ssh_profiles: self.ssh_profiles.clone(),
            sync_lock: Arc::clone(&self.sync_lock),
        }
    }
}

impl<R, A, C, V, E, S> WorkspaceUseCases<R, A, C, V, E, S>
where
    R: WorkspaceRepositoryPort,
    A: WorkspaceRuntimePort,
    C: WorkspaceControlPlanePort,
    V: ConnectionCredentialVault + ?Sized,
    E: WorkspaceConfigurationPort,
    S: WorkspaceSshProfilePort,
{
    pub(crate) fn new(
        repository: R,
        runtime: A,
        control_plane: C,
        credentials: Arc<V>,
        configuration: E,
        ssh_profiles: S,
    ) -> Self {
        Self {
            repository,
            runtime,
            control_plane,
            credentials,
            configuration,
            ssh_profiles,
            sync_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }
}
