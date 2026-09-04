//! Authentication lifecycle use cases.

use crate::error::{AppError, AppResult};
use crate::features::connections::ConnectionCredentialVault;
use crate::kernel::identity::AccountId;

use super::super::domain::{
    WorkspaceAuthState, WorkspaceAuthUser, WorkspaceAuthorityFingerprint,
    WorkspaceDeviceAuthorization, WorkspaceFeatureState, WorkspaceLoginPoll,
    WorkspaceLoginPollStatus,
};
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
    pub(crate) fn feature_state(&self) -> WorkspaceFeatureState {
        WorkspaceFeatureState {
            enabled: self.configuration.feature_enabled(),
        }
    }

    pub(crate) async fn auth_state(&self) -> AppResult<WorkspaceAuthState> {
        self.ensure_active_account().await?;
        self.auth_state_from_repository().await
    }

    pub(crate) async fn authority_fingerprint(&self) -> AppResult<WorkspaceAuthorityFingerprint> {
        self.repository.authority_fingerprint().await
    }

    /// Revalidate the active hosted session and memberships without making initial UI
    /// rendering wait on the OS credential store or network. Cached public identity
    /// remains stable during outages; sensitive commands still authorize online.
    pub(crate) async fn refresh_auth_state(&self) -> AppResult<WorkspaceAuthState> {
        self.ensure_active_account().await?;
        if let Some(user_id) = self.repository.active_account_id().await? {
            match self.control_plane.auth_user(&user_id).await {
                Ok(Some(user)) => {
                    self.sync_account_memberships(&user).await?;
                    self.refresh_active_connection_authority(&user.id).await?;
                }
                Ok(None) => {
                    self.runtime.remove_account(&user_id).await?;
                    self.ensure_active_account().await?;
                }
                Err(error) => return Err(error),
            }
        }
        self.auth_state_from_repository().await
    }

    /// Resolves the one account a single-account sign-out may remove.  This is
    /// intentionally separate from `sign_out_all`: callers that also tombstone
    /// provider bindings must never pass an omitted account as an all-account
    /// provider cleanup request.
    pub(crate) async fn resolve_sign_out_account(
        &self,
        requested: Option<AccountId>,
    ) -> AppResult<AccountId> {
        match requested {
            Some(user_id) => Ok(user_id),
            None => Ok(self
                .repository
                .active_account_id()
                .await?
                .ok_or_else(|| AppError::Config("no workspace account is signed in".into()))?),
        }
    }

    pub(crate) async fn sign_out(
        &self,
        user_id: Option<AccountId>,
    ) -> AppResult<WorkspaceAuthState> {
        let user_id = self.resolve_sign_out_account(user_id).await?;
        self.runtime.remove_account(&user_id).await?;
        // Pool retirement releases managed provider credentials while the Better Auth
        // token is still available; session revocation and local token deletion follow.
        self.control_plane.sign_out(&user_id).await?;
        self.auth_state_from_repository().await
    }

    pub(crate) async fn sign_out_all(&self) -> AppResult<WorkspaceAuthState> {
        let accounts = self.repository.accounts().await?;
        let mut first_error = None;
        for account in accounts {
            if let Err(error) = self.runtime.remove_account(&account.user.id).await {
                first_error.get_or_insert(error);
            }
            if let Err(error) = self.control_plane.sign_out(&account.user.id).await {
                first_error.get_or_insert(error);
            }
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        self.auth_state_from_repository().await
    }

    pub(crate) async fn begin_login(&self) -> AppResult<WorkspaceDeviceAuthorization> {
        self.control_plane.begin_login().await
    }

    pub(crate) async fn poll_login(&self, device_code: &str) -> AppResult<WorkspaceLoginPoll> {
        let result = self.control_plane.poll_login(device_code).await?;
        if result.status == WorkspaceLoginPollStatus::SignedIn {
            let user = result.user.as_ref().ok_or_else(|| {
                AppError::Network("workspace login did not return an account".into())
            })?;
            if let Err(error) = self.sync_account_memberships(user).await {
                // The session token is already validated and stored. Do not report a
                // successful login as failed merely because the first membership refresh
                // encountered a transient control-plane or local-cache error.
                tracing::warn!(%error, "workspace membership sync deferred after sign-in");
            }
            self.runtime.activate_account(&user.id).await?;
        }
        Ok(result)
    }

    pub(super) async fn auth_state_from_repository(&self) -> AppResult<WorkspaceAuthState> {
        let accounts = self.repository.accounts().await?;
        let active_account_id = self.repository.active_account_id().await?;
        let authority_generation = self.repository.authority_fingerprint().await?.generation;
        let user = active_account_id.and_then(|active_id| {
            accounts
                .iter()
                .find(|account| account.user.id == active_id)
                .map(|account| account.user.clone())
        });
        Ok(WorkspaceAuthState {
            authenticated: user.is_some(),
            user,
            accounts,
            authority_generation,
        })
    }

    pub(super) async fn ensure_active_account(&self) -> AppResult<()> {
        let active_account_id = self.repository.active_account_id().await?;
        let accounts = self.repository.accounts().await?;
        if active_account_id
            .as_ref()
            .is_some_and(|active_id| accounts.iter().any(|account| account.user.id == *active_id))
        {
            return Ok(());
        }
        if let Some(stale_id) = active_account_id {
            self.runtime.remove_account(&stale_id).await?;
        } else if let Some(account) = accounts.first() {
            self.runtime.activate_account(&account.user.id).await?;
        }
        Ok(())
    }

    pub(super) async fn validated_user(&self, user_id: &AccountId) -> AppResult<WorkspaceAuthUser> {
        match self.control_plane.auth_user(user_id).await? {
            Some(user) => Ok(user),
            None => {
                self.runtime.remove_account(user_id).await?;
                self.ensure_active_account().await?;
                Err(AppError::Network(
                    "workspace session is no longer active".into(),
                ))
            }
        }
    }
}
