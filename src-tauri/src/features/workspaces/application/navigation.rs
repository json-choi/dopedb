//! Workspace/account selection and remote synchronization use cases.

use crate::error::{AppError, AppResult};
use crate::features::connections::ConnectionCredentialVault;
use crate::kernel::identity::{AccountId, WorkspaceId};

use crate::kernel::access::WorkspaceKind;

use super::super::domain::{Workspace, WorkspaceAuthUser};
use super::super::ports::{
    WorkspaceConfigurationPort, WorkspaceControlPlanePort, WorkspaceRepositoryPort,
    WorkspaceRuntimePort,
};
use super::WorkspaceUseCases;

impl<R, A, C, V, E, S> WorkspaceUseCases<R, A, C, V, E, S>
where
    R: WorkspaceRepositoryPort,
    A: WorkspaceRuntimePort,
    C: WorkspaceControlPlanePort,
    V: ConnectionCredentialVault + ?Sized,
    E: WorkspaceConfigurationPort,
    S: super::super::ports::WorkspaceSshProfilePort,
{
    pub(crate) fn console_url(&self, workspace_id: Option<WorkspaceId>) -> AppResult<String> {
        self.control_plane.console_url(workspace_id)
    }

    pub(crate) async fn list(&self) -> AppResult<Vec<Workspace>> {
        self.repository.list_workspaces().await
    }

    pub(crate) async fn active(&self) -> AppResult<Workspace> {
        self.repository.active_workspace().await
    }

    pub(crate) async fn activate(
        &self,
        id: WorkspaceId,
        account_user_id: Option<AccountId>,
    ) -> AppResult<Workspace> {
        let target = self
            .repository
            .list_workspaces()
            .await?
            .into_iter()
            .find(|workspace| workspace.id == id)
            .ok_or_else(|| AppError::NotFound(format!("workspace {id}")))?;
        if target.kind == WorkspaceKind::Team {
            let user_id = account_user_id.as_ref().ok_or_else(|| {
                AppError::Config("team workspace selection requires an account".into())
            })?;
            let user = self.validated_user(user_id).await?;
            self.sync_account_memberships(&user).await?;
        }
        let workspace = self
            .runtime
            .activate_workspace(id, account_user_id.as_ref())
            .await?;
        if workspace.kind == WorkspaceKind::Team {
            let account_user_id = account_user_id.ok_or_else(|| {
                AppError::Config("team workspace selection requires an account".into())
            })?;
            if let Err(error) = self
                .sync_workspace_resources(&account_user_id, workspace.id)
                .await
            {
                tracing::warn!(workspace_id = %workspace.id, %error, "workspace resource sync deferred after switch");
            }
        }
        Ok(workspace)
    }

    pub(crate) async fn activate_account(&self, user_id: AccountId) -> AppResult<Workspace> {
        let user = self.validated_user(&user_id).await?;
        self.sync_account_memberships(&user).await?;
        let workspace = self.runtime.activate_account(&user_id).await?;
        if workspace.kind == WorkspaceKind::Team {
            if let Err(error) = self.sync_workspace_resources(&user_id, workspace.id).await {
                tracing::warn!(workspace_id = %workspace.id, %error, "workspace resource sync deferred after account switch");
            }
        }
        Ok(workspace)
    }

    pub(super) async fn sync_account_memberships(&self, user: &WorkspaceAuthUser) -> AppResult<()> {
        self.repository.remember_account(user).await?;
        let remote = self.control_plane.remote_workspaces(&user.id).await?;
        let workspaces = remote
            .into_iter()
            .map(|workspace| (workspace.id, workspace.name, workspace.role))
            .collect::<Vec<_>>();
        self.runtime
            .sync_account_workspaces(user, &workspaces)
            .await?;
        let active = self.repository.active_workspace().await?;
        if active.kind == WorkspaceKind::Team
            && self.repository.active_account_id().await?.as_ref() == Some(&user.id)
        {
            self.sync_workspace_resources(&user.id, active.id).await?;
        }
        Ok(())
    }

    /// Force the active Team connection collection to its authoritative head.
    /// Cursor replay can legitimately have no connection event, while an exact
    /// revision-conflict retry specifically needs the current full collection.
    pub(super) async fn refresh_active_connection_authority(
        &self,
        account_user_id: &AccountId,
    ) -> AppResult<()> {
        let active = self.repository.active_workspace().await?;
        if active.kind != WorkspaceKind::Team
            || self.repository.active_account_id().await?.as_ref() != Some(account_user_id)
        {
            return Ok(());
        }
        let _sync_guard = self.sync_lock.lock().await;
        self.sync_connections(account_user_id, active.id).await
    }

    /// Serialize one account/workspace pull so a late full-collection response can
    /// never overwrite a newer cursor page. Each page checkpoint is committed only
    /// after all selected projections have been reconciled successfully.
    pub(super) async fn sync_workspace_resources(
        &self,
        account_user_id: &AccountId,
        workspace_id: WorkspaceId,
    ) -> AppResult<()> {
        let _sync_guard = self.sync_lock.lock().await;
        let mut cursor = self
            .repository
            .workspace_pull_cursor(workspace_id, account_user_id)
            .await?;
        for _ in 0..64 {
            let Some(page) = self
                .control_plane
                .workspace_pull_page(account_user_id, workspace_id, cursor)
                .await?
            else {
                // During a rolling deployment, refresh connection authority but do
                // not invent a checkpoint for a missing cursor API. Analysis
                // Articles are always read from their authenticated collection.
                self.sync_connections(account_user_id, workspace_id).await?;
                return Ok(());
            };
            if page.refresh_connections {
                self.sync_connections(account_user_id, workspace_id).await?;
            }
            // Article definitions and run receipts have one authenticated
            // control-plane reader. Result rows remain in Desktop's local recovery
            // cache and never become a second shared authority.
            if page.refresh_analyses {
                tracing::debug!(
                    %workspace_id,
                    analysis_tombstone = page.analysis_tombstone,
                    "workspace Analysis change retained by authoritative reader"
                );
            }
            if page.connection_tombstone || page.analysis_tombstone {
                tracing::debug!(
                    %workspace_id,
                    connection_tombstone = page.connection_tombstone,
                    analysis_tombstone = page.analysis_tombstone,
                    "workspace tombstones reconciled through authoritative collections"
                );
            }
            self.repository
                .commit_workspace_pull_cursor(workspace_id, account_user_id, cursor, page)
                .await?;
            cursor = Some(page.next_cursor);
            if !page.has_more {
                return Ok(());
            }
        }
        Err(AppError::Network(
            "workspace sync exceeded the bounded cursor replay window".into(),
        ))
    }

    async fn sync_connections(
        &self,
        account_user_id: &AccountId,
        workspace_id: WorkspaceId,
    ) -> AppResult<()> {
        match self
            .control_plane
            .remote_connections(account_user_id, workspace_id)
            .await
        {
            Ok(Some(connections)) => {
                let removed_credential_ids = self
                    .runtime
                    .sync_remote_connections(workspace_id, account_user_id, &connections)
                    .await?;
                for credential_id in removed_credential_ids {
                    self.delete_secret_best_effort(credential_id, "remove_remote_connection");
                }
                Ok(())
            }
            Ok(None) => Err(AppError::Network(
                "shared connection collection is unavailable during cursor sync".into(),
            )),
            Err(error) => Err(error),
        }
    }
}
