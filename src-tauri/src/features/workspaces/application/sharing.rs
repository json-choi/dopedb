//! Shared connection publication and member-local credential binding use cases.

use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::connections::{ConnectionCredentialVault, MAX_CONNECTION_CREDENTIAL_BYTES};
use crate::kernel::identity::ConnectionId;
use crate::model::{ConnectionProfile, WorkspaceConnectionAccess, WorkspaceCredentialMode};

use crate::kernel::access::WorkspaceKind;

use super::super::domain::validate_member_username;
use super::super::ports::{
    WorkspaceConfigurationPort, WorkspaceConnectionMutationPort, WorkspaceControlPlanePort,
    WorkspaceRepositoryPort, WorkspaceRuntimePort,
};
use super::{
    WorkspaceConnectionCopyRequest, WorkspaceConnectionUpdateRequest,
    WorkspaceCredentialBindingRequest, WorkspaceUseCases,
};

enum SharedConnectionMutation {
    Template(Box<ConnectionProfile>),
    WritePolicy(bool),
}

impl<R, A, C, V, E, S> WorkspaceUseCases<R, A, C, V, E, S>
where
    R: WorkspaceRepositoryPort,
    A: WorkspaceRuntimePort,
    C: WorkspaceControlPlanePort,
    V: ConnectionCredentialVault + ?Sized,
    E: WorkspaceConfigurationPort,
    S: super::super::ports::WorkspaceSshProfilePort,
{
    /// Copy a local connection into a team workspace. Only its redacted template
    /// crosses the network; the caller's credential is duplicated locally under the
    /// remote resource UUID.
    pub(crate) async fn copy_connection(
        &self,
        request: WorkspaceConnectionCopyRequest,
    ) -> AppResult<ConnectionProfile> {
        let WorkspaceConnectionCopyRequest {
            connection_id,
            workspace_id,
            account_user_id,
            allow_active_workspace,
        } = request;
        let source = self.repository.get_connection(connection_id).await?;
        if source.workspace_access != WorkspaceConnectionAccess::Local {
            return Err(AppError::Config(
                "only a local connection can be copied into a workspace".into(),
            ));
        }
        let target = self
            .repository
            .list_workspaces()
            .await?
            .into_iter()
            .find(|workspace| workspace.id == workspace_id && workspace.kind == WorkspaceKind::Team)
            .ok_or_else(|| AppError::NotFound(format!("team workspace {workspace_id}")))?;
        let current_account = self.repository.active_account_id().await?;
        if !allow_active_workspace
            && target.id == self.repository.active_workspace_id().await?
            && current_account.as_ref() == Some(&account_user_id)
        {
            return Err(AppError::Config("choose a different team workspace".into()));
        }
        let account = self
            .repository
            .accounts()
            .await?
            .into_iter()
            .find(|account| {
                account.user.id == account_user_id
                    && account
                        .memberships
                        .iter()
                        .any(|membership| membership.workspace_id == workspace_id)
            })
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "workspace {workspace_id} for account {account_user_id}"
                ))
            })?;

        // Resolve every local prerequisite and snapshot the current remote collection
        // before creating the server resource. This avoids a remote template being left
        // behind merely because a later credential read or collection fetch failed.
        let copied_secret = if source.secret_ref.is_some() {
            Some(self.credentials.fetch_profile(&source)?)
        } else {
            None
        };
        let mut remote = self
            .control_plane
            .remote_connections(&account.user.id, workspace_id)
            .await?
            .ok_or_else(|| {
                AppError::Network(
                    "the workspace service has not deployed shared connections yet".into(),
                )
            })?;
        let credential_id = copied_secret.as_ref().map(|_| Uuid::new_v4());
        if let (Some(credential_id), Some(secret)) = (credential_id, copied_secret.as_deref()) {
            self.credentials.store(&credential_id, secret)?;
        }
        let shared = self
            .control_plane
            .share_connection(&account.user.id, workspace_id, &source)
            .await;
        let (created, revision) = match shared {
            Ok(created) => created,
            Err(error) => {
                if let Some(credential_id) = credential_id {
                    self.delete_secret_best_effort(credential_id, "share_connection");
                }
                return Err(error);
            }
        };
        remote.push((created.clone(), revision));
        let credential_ref = credential_id.map(|id| id.to_string());
        let local_result = async {
            let removed_credential_ids = self
                .runtime
                .sync_remote_connections(workspace_id, &account.user.id, &remote)
                .await?;
            for credential_id in removed_credential_ids {
                self.delete_secret_best_effort(credential_id, "remove_remote_connection");
            }
            self.repository
                .bind_connection_credentials(
                    created.id.into(),
                    &account.user.id,
                    &source.username,
                    &source.extra_params,
                    credential_ref.as_deref(),
                )
                .await
        }
        .await;
        match local_result {
            Ok(profile) => Ok(profile),
            Err(error) => {
                if let Some(credential_id) = credential_id {
                    self.delete_secret_best_effort(credential_id, "persist_shared_connection");
                }
                match self
                    .control_plane
                    .delete_connection(&account.user.id, workspace_id, created.id.into(), revision)
                    .await
                {
                    Ok(()) => {
                        if let Err(cache_error) = self
                            .repository
                            .purge_remote_connection_cache(workspace_id, created.id.into())
                            .await
                        {
                            tracing::warn!(
                                connection_id = %created.id,
                                %cache_error,
                                "rolled-back shared connection cache cleanup deferred"
                            );
                        }
                    }
                    Err(rollback_error) => tracing::warn!(
                        connection_id = %created.id,
                        %rollback_error,
                        "shared connection rollback deferred"
                    ),
                }
                Err(error)
            }
        }
    }

    /// Update one shared, secret-free template and reconcile it into the active
    /// account scope while preserving that member's local credential overlay.
    pub(crate) async fn update_connection(
        &self,
        request: WorkspaceConnectionUpdateRequest,
    ) -> AppResult<ConnectionProfile> {
        let WorkspaceConnectionUpdateRequest { profile } = request;
        let connection_id = ConnectionId::from(profile.id);
        self.mutate_connection(
            connection_id,
            SharedConnectionMutation::Template(Box::new(profile)),
        )
        .await
    }

    /// Change only the server-owned write ceiling for a managed connection. The
    /// caller's device gate remains a separate, narrower Safety setting.
    pub(crate) async fn set_connection_write_policy(
        &self,
        connection_id: ConnectionId,
        allow_writes: bool,
    ) -> AppResult<ConnectionProfile> {
        self.mutate_connection(
            connection_id,
            SharedConnectionMutation::WritePolicy(allow_writes),
        )
        .await
    }

    async fn mutate_connection(
        &self,
        connection_id: ConnectionId,
        change: SharedConnectionMutation,
    ) -> AppResult<ConnectionProfile> {
        let mutation = self
            .runtime
            .begin_connection_mutation(connection_id)
            .await?;
        let current = mutation.profile().clone();
        if current.workspace_access != WorkspaceConnectionAccess::Manage {
            return Err(AppError::Blocked {
                reason: "managing this shared connection requires workspace manage access".into(),
            });
        }
        let (mut profile, requested_write_policy) = match change {
            SharedConnectionMutation::Template(profile) => {
                let mut profile = *profile;
                if profile.id != current.id {
                    return Err(AppError::Config(
                        "shared connection update id does not match the active template".into(),
                    ));
                }
                if profile.credential_mode != current.credential_mode {
                    return Err(AppError::Config(
                        "shared connection credential mode cannot be changed by the template editor"
                            .into(),
                    ));
                }
                // The connection editor owns identity and transport only. Preserve
                // the workspace write ceiling that Safety owns.
                profile.allow_writes = current.credential_mode == WorkspaceCredentialMode::Managed
                    && current.allow_writes;
                (profile, None)
            }
            SharedConnectionMutation::WritePolicy(allow_writes) => {
                if current.credential_mode != WorkspaceCredentialMode::Managed {
                    return Err(AppError::Blocked {
                        reason: "workspace writes require a managed connection".into(),
                    });
                }
                (current.clone(), Some(allow_writes))
            }
        };
        let account_user_id = mutation.selected_account_id()?;
        let workspace_id = self.repository.active_workspace_id().await?;

        let mut remote = self
            .control_plane
            .remote_connections(&account_user_id, workspace_id)
            .await?
            .ok_or_else(|| {
                AppError::Network(
                    "the workspace service has not deployed shared connections yet".into(),
                )
            })?;
        let position = remote
            .iter()
            .position(|(candidate, _)| candidate.id == current.id)
            .ok_or_else(|| AppError::NotFound(format!("shared connection {connection_id}")))?;
        if let Some(allow_writes) = requested_write_policy {
            // A policy-only mutation must never overwrite a newer connection
            // template with the local cache. Start from the just-fetched exact
            // hosted revision and change only its write ceiling.
            profile = remote[position].0.clone();
            if profile.credential_mode != WorkspaceCredentialMode::Managed {
                return Err(AppError::Blocked {
                    reason: "workspace writes require a managed connection".into(),
                });
            }
            profile.allow_writes = allow_writes;
        }
        profile.readonly_default = true;
        profile.workspace_access = current.workspace_access;
        profile.credential_mode = current.credential_mode;
        let expected_revision = remote[position].1;
        let updated = self
            .control_plane
            .update_connection(&account_user_id, workspace_id, &profile, expected_revision)
            .await?;
        remote[position] = updated;

        // Release the per-connection read pin before the runtime takes its exclusive
        // workspace sync gate.
        mutation.retire(connection_id).await;
        let removed_credential_ids = self
            .runtime
            .sync_remote_connections(workspace_id, &account_user_id, &remote)
            .await?;
        for credential_id in removed_credential_ids {
            self.delete_secret_best_effort(credential_id, "update_workspace_connection");
        }
        self.repository.get_connection(connection_id).await
    }

    /// Delete a shared template through the workspace authority, then remove its
    /// local cache and every member-local credential reference returned by sync.
    pub(crate) async fn delete_connection(
        &self,
        connection_id: ConnectionId,
    ) -> AppResult<ConnectionProfile> {
        let mutation = self
            .runtime
            .begin_connection_mutation(connection_id)
            .await?;
        let current = mutation.profile().clone();
        if current.workspace_access != WorkspaceConnectionAccess::Manage {
            return Err(AppError::Blocked {
                reason: "deleting this shared connection requires workspace manage access".into(),
            });
        }
        let account_user_id = mutation.selected_account_id()?;
        let workspace_id = self.repository.active_workspace_id().await?;
        let mut remote = self
            .control_plane
            .remote_connections(&account_user_id, workspace_id)
            .await?
            .ok_or_else(|| {
                AppError::Network(
                    "the workspace service has not deployed shared connections yet".into(),
                )
            })?;
        let position = remote
            .iter()
            .position(|(candidate, _)| candidate.id == current.id)
            .ok_or_else(|| AppError::NotFound(format!("shared connection {connection_id}")))?;
        let expected_revision = remote[position].1;
        self.control_plane
            .delete_connection(
                &account_user_id,
                workspace_id,
                connection_id,
                expected_revision,
            )
            .await?;
        remote.remove(position);

        mutation.retire(connection_id).await;
        let removed_credential_ids = self
            .runtime
            .sync_remote_connections(workspace_id, &account_user_id, &remote)
            .await?;
        for credential_id in removed_credential_ids {
            self.delete_secret_best_effort(credential_id, "delete_workspace_connection");
        }
        Ok(current)
    }

    /// Store one member's database credential only in the OS credential store and
    /// atomically publish the new binding revision for a shared template.
    pub(crate) async fn bind_connection_credentials(
        &self,
        request: WorkspaceCredentialBindingRequest,
    ) -> AppResult<ConnectionProfile> {
        let WorkspaceCredentialBindingRequest {
            connection_id,
            username,
            password,
            ssh_alias,
        } = request;
        let username = validate_member_username(&username)?;
        if password.is_empty() || password.len() > MAX_CONNECTION_CREDENTIAL_BYTES {
            return Err(AppError::Config(
                "connection credential is empty or exceeds the size limit".into(),
            ));
        }
        let mutation = self
            .runtime
            .begin_connection_mutation(connection_id)
            .await?;
        let profile = mutation.profile().clone();
        if profile.workspace_access == WorkspaceConnectionAccess::Local {
            return Err(AppError::Config(
                "connection is not a shared workspace template".into(),
            ));
        }
        if profile.credential_mode != WorkspaceCredentialMode::MemberLocal {
            return Err(AppError::Blocked {
                reason: "this shared connection uses automatically managed credentials".into(),
            });
        }
        if profile.engine == crate::model::Engine::Bigquery {
            return Err(AppError::Blocked {
                reason: "BigQuery authentication is owned by Google Cloud CLI and cannot be bound as a workspace password"
                    .into(),
            });
        }
        if !profile.workspace_access.can_read() {
            return Err(AppError::Blocked {
                reason: "your workspace role cannot execute this connection".into(),
            });
        }
        let binding_extra_params = self
            .ssh_profiles
            .bind_alias(&profile, ssh_alias.as_deref())?;
        let account_user_id = mutation.selected_account_id()?;
        let previous_credential_id = profile
            .secret_ref
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| AppError::Config("connection secret reference is invalid".into()))?;
        // Copy-on-write prevents a password-only rotation from mutating credential
        // material behind an unchanged binding revision.
        let credential_id = Uuid::new_v4();
        self.credentials.store(&credential_id, password.as_str())?;
        let credential_ref = credential_id.to_string();
        match self
            .repository
            .bind_connection_credentials(
                connection_id,
                &account_user_id,
                username,
                &binding_extra_params,
                Some(&credential_ref),
            )
            .await
        {
            Ok(profile) => {
                mutation.retire(connection_id).await;
                if let Some(previous_credential_id) = previous_credential_id {
                    self.delete_secret_best_effort(
                        previous_credential_id,
                        "replace_workspace_connection_credentials",
                    );
                }
                Ok(profile)
            }
            Err(error) => {
                self.delete_secret_best_effort(credential_id, "bind_connection_credentials");
                Err(error)
            }
        }
    }

    pub(super) fn delete_secret_best_effort(&self, id: Uuid, action: &'static str) {
        if let Err(error) = self.credentials.delete(&id) {
            tracing::warn!(credential_id = %id, %error, action, "credential cleanup deferred");
        }
    }
}
