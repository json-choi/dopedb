//! Tauri transport adapter for workspace use cases.

use std::collections::HashMap;

use tauri::State;
use zeroize::Zeroizing;

use crate::error::AppResult;
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};
use crate::model::ConnectionProfile;
use crate::state::AppState;

use super::domain::WorkspaceAuthorityFingerprint;
use super::{
    Workspace, WorkspaceAuthState, WorkspaceConnectionCopyRequest,
    WorkspaceConnectionUpdateRequest, WorkspaceCredentialBindingRequest,
    WorkspaceDeviceAuthorization, WorkspaceFeatureState, WorkspaceLoginPoll,
    WorkspaceLoginPollStatus,
};

fn fence_runtime_authority(state: &AppState, app: &tauri::AppHandle) {
    // Runtime grants fail closed. This fence does not depend on a second
    // authority read: a proven change (or a successful refresh whose pre-state
    // was unreadable) must never leave an old process capability alive.
    state.terminals.stop_all(app);
    state
        .agents_acp
        .interrupt_all_for_workspace_authority_change();
    state.broker.revoke_all_sessions();
}

fn active_scope_authority_changed(
    before: &WorkspaceAuthorityFingerprint,
    after: &WorkspaceAuthorityFingerprint,
) -> bool {
    before.workspace_id != after.workspace_id
        || before.account_scope != after.account_scope
        || before.generation != after.generation
}

fn changed_connection_authorities(
    before: &WorkspaceAuthorityFingerprint,
    after: &WorkspaceAuthorityFingerprint,
) -> Vec<ConnectionId> {
    let current = after
        .connections
        .iter()
        .map(|(id, connection_revision, binding_revision)| {
            (*id, (*connection_revision, *binding_revision))
        })
        .collect::<HashMap<_, _>>();
    before
        .connections
        .iter()
        .filter_map(|(id, connection_revision, binding_revision)| {
            (current.get(id) != Some(&(*connection_revision, *binding_revision))).then_some(*id)
        })
        .collect()
}

fn apply_runtime_authority_delta(
    state: &AppState,
    app: &tauri::AppHandle,
    before: &WorkspaceAuthorityFingerprint,
    after: &WorkspaceAuthorityFingerprint,
) {
    if active_scope_authority_changed(before, after) {
        fence_runtime_authority(state, app);
        return;
    }
    for connection_id in changed_connection_authorities(before, after) {
        state.terminals.stop_connection(connection_id, app);
        state.agents_acp.stop_connection(connection_id);
    }
}

fn local_personal_authority(snapshot: Option<&WorkspaceAuthorityFingerprint>) -> bool {
    snapshot.is_some_and(|snapshot| snapshot.account_scope == "personal")
}

/// A successful workspace authority snapshot is the only input allowed to
/// tombstone durable member-local provider bindings. It deliberately spans all
/// account/workspace grants, not just the selected UI scope.
async fn reconcile_provider_grants_after_refresh(state: &AppState) -> AppResult<()> {
    let Ok(snapshot) = state.services.workspace.authority_fingerprint().await else {
        // A failed authority read is not proof of revocation.
        return Ok(());
    };
    let grants = snapshot
        .grants
        .iter()
        .map(|(account, workspace, _)| (account.clone(), *workspace))
        .collect::<Vec<_>>();
    state.services.providers.reconcile_grants(&grants).await
}

#[tauri::command]
pub fn workspace_feature_state(state: State<'_, AppState>) -> WorkspaceFeatureState {
    state.services.workspace.feature_state()
}

#[tauri::command]
pub async fn workspace_auth_state(state: State<'_, AppState>) -> AppResult<WorkspaceAuthState> {
    state.services.workspace.auth_state().await
}

#[tauri::command]
pub async fn refresh_workspace_auth_state(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<WorkspaceAuthState> {
    // Pause new Broker authentication while the hosted authority is in flight,
    // but keep ACP/PTY processes alive. Exact generation/revision checks still
    // fence operations committed under an old authority. Only a proven change
    // below terminates a conversation.
    let authority_refresh = state.broker.begin_authority_refresh();
    let before = state.services.workspace.authority_fingerprint().await;
    let result = state.services.workspace.refresh_auth_state().await;
    match result {
        Ok(auth_state) => {
            let after = match state.services.workspace.authority_fingerprint().await {
                Ok(after) => after,
                Err(error) => {
                    // The hosted refresh may already have committed local
                    // authority. Without its post-state, no old process can be
                    // proven safe to resume on a later retry.
                    fence_runtime_authority(&state, &app);
                    state.broker.mark_authority_unverified();
                    drop(authority_refresh);
                    return Err(error);
                }
            };
            match before.as_ref() {
                Ok(before) => apply_runtime_authority_delta(&state, &app, before, &after),
                Err(_) => {
                    // The refresh succeeded but its pre-state could not be proven.
                    // Conservatively retire old processes once, then allow new work
                    // under the successfully read post-refresh authority.
                    fence_runtime_authority(&state, &app);
                }
            }
            if let Err(error) = state.services.providers.invalidate_scope().await {
                fence_runtime_authority(&state, &app);
                state.broker.mark_authority_unverified();
                drop(authority_refresh);
                return Err(error);
            }
            if let Err(error) = reconcile_provider_grants_after_refresh(&state).await {
                fence_runtime_authority(&state, &app);
                state.broker.mark_authority_unverified();
                drop(authority_refresh);
                return Err(error);
            }
            state.broker.confirm_authority();
            drop(authority_refresh);
            Ok(auth_state)
        }
        Err(error) => {
            let after = state.services.workspace.authority_fingerprint().await;
            match (before.as_ref(), after.as_ref()) {
                (Ok(before), Ok(after)) => {
                    apply_runtime_authority_delta(&state, &app, before, after);
                }
                (_, Err(_)) => {
                    // A failed refresh with no readable post-state could have
                    // crossed a local commit. Retire the unprovable capability.
                    fence_runtime_authority(&state, &app);
                }
                (Err(_), Ok(_)) => {
                    // A missing pre-state does not prove a change, but the Broker
                    // remains gated for Team scope until a complete retry.
                }
            }
            // Personal Workspace execution is device-local and remains usable
            // offline. Team execution stays paused after a failed remote proof and
            // resumes automatically after the next successful refresh.
            if local_personal_authority(after.as_ref().ok()) {
                state.broker.confirm_authority();
            } else {
                state.broker.mark_authority_unverified();
            }
            drop(authority_refresh);
            if let Err(cleanup_error) = state.services.providers.invalidate_scope().await {
                tracing::warn!(%cleanup_error, "provider scope cleanup failed after workspace auth refresh failure");
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn workspace_sign_out(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    user_id: Option<AccountId>,
) -> AppResult<WorkspaceAuthState> {
    // Resolve omission before touching Provider cleanup. `None` means one
    // active workspace account here, while Provider's durable tombstone API
    // reserves `None` for the explicit all-account sign-out command below.
    let account_id = state
        .services
        .workspace
        .resolve_sign_out_account(user_id)
        .await?;
    let authority_transition = state.broker.begin_authority_refresh();
    // Tombstone every member-local provider binding while the account record is
    // still present. The Broker gate prevents a capability from crossing this
    // transition, while an early failure leaves the still-valid chat process up.
    if let Err(error) = state.services.providers.sign_out(Some(&account_id)).await {
        state.broker.mark_authority_unverified();
        drop(authority_transition);
        return Err(error);
    }
    // Provider cleanup is itself a durable authority change. Once it succeeds,
    // retire the old exact-grant processes even if the later account mutation
    // fails and leaves the account signed in.
    fence_runtime_authority(&state, &app);
    let result = state.services.workspace.sign_out(Some(account_id)).await;
    if result.is_ok() {
        state.broker.confirm_authority();
    } else {
        state.broker.mark_authority_unverified();
    }
    drop(authority_transition);
    result
}

#[tauri::command]
pub async fn workspace_sign_out_all(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<WorkspaceAuthState> {
    let authority_transition = state.broker.begin_authority_refresh();
    if let Err(error) = state.services.providers.sign_out(None).await {
        state.broker.mark_authority_unverified();
        drop(authority_transition);
        return Err(error);
    }
    fence_runtime_authority(&state, &app);
    let result = state.services.workspace.sign_out_all().await;
    if result.is_ok() {
        state.broker.confirm_authority();
    } else {
        state.broker.mark_authority_unverified();
    }
    drop(authority_transition);
    result
}

#[tauri::command]
pub async fn begin_workspace_login(
    state: State<'_, AppState>,
) -> AppResult<WorkspaceDeviceAuthorization> {
    state.services.workspace.begin_login().await
}

#[tauri::command]
pub async fn poll_workspace_login(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    device_code: String,
) -> AppResult<WorkspaceLoginPoll> {
    // Most polls are still pending and must not close unrelated live chats. The
    // Broker gate prevents a new exact-grant operation from crossing the one poll
    // that commits a signed-in account; generation checks fence any old pin.
    let authority_refresh = state.broker.begin_authority_refresh();
    let before = state.services.workspace.authority_fingerprint().await;
    let result = match state.services.workspace.poll_login(&device_code).await {
        Ok(result) => result,
        Err(error) => {
            drop(authority_refresh);
            return Err(error);
        }
    };
    let after = match state.services.workspace.authority_fingerprint().await {
        Ok(after) => after,
        Err(error) => {
            state.broker.mark_authority_unverified();
            drop(authority_refresh);
            return Err(error);
        }
    };
    match before.as_ref() {
        Ok(before) => apply_runtime_authority_delta(&state, &app, before, &after),
        Err(_) if result.status == WorkspaceLoginPollStatus::SignedIn => {
            fence_runtime_authority(&state, &app);
        }
        Err(_) => {}
    }
    if result.status == WorkspaceLoginPollStatus::SignedIn {
        if let Err(error) = state.services.providers.invalidate_scope().await {
            state.broker.mark_authority_unverified();
            drop(authority_refresh);
            return Err(error);
        }
        if let Err(error) = reconcile_provider_grants_after_refresh(&state).await {
            state.broker.mark_authority_unverified();
            drop(authority_refresh);
            return Err(error);
        }
        state.broker.confirm_authority();
    }
    drop(authority_refresh);
    Ok(result)
}

#[tauri::command]
pub fn workspace_console_url(
    state: State<'_, AppState>,
    workspace_id: Option<WorkspaceId>,
) -> AppResult<String> {
    state.services.workspace.console_url(workspace_id)
}

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> AppResult<Vec<Workspace>> {
    state.services.workspace.list().await
}

#[tauri::command]
pub async fn get_active_workspace(state: State<'_, AppState>) -> AppResult<Workspace> {
    state.services.workspace.active().await
}

#[tauri::command]
pub async fn set_active_workspace(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: WorkspaceId,
    account_user_id: Option<AccountId>,
) -> AppResult<Workspace> {
    let authority_transition = state.broker.begin_authority_refresh();
    let result = state.services.workspace.activate(id, account_user_id).await;
    if result.is_ok() {
        fence_runtime_authority(&state, &app);
        if let Err(error) = state.services.providers.invalidate_scope().await {
            state.broker.mark_authority_unverified();
            drop(authority_transition);
            return Err(error);
        }
        state.broker.confirm_authority();
    }
    drop(authority_transition);
    result
}

#[tauri::command]
pub async fn set_active_workspace_account(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    user_id: AccountId,
) -> AppResult<Workspace> {
    let authority_transition = state.broker.begin_authority_refresh();
    let result = state.services.workspace.activate_account(user_id).await;
    if result.is_ok() {
        fence_runtime_authority(&state, &app);
        if let Err(error) = state.services.providers.invalidate_scope().await {
            state.broker.mark_authority_unverified();
            drop(authority_transition);
            return Err(error);
        }
        state.broker.confirm_authority();
    }
    drop(authority_transition);
    result
}

#[tauri::command]
pub async fn copy_connection_to_workspace(
    state: State<'_, AppState>,
    connection_id: ConnectionId,
    workspace_id: WorkspaceId,
    account_user_id: AccountId,
) -> AppResult<ConnectionProfile> {
    state
        .services
        .workspace
        .copy_connection(WorkspaceConnectionCopyRequest {
            connection_id,
            workspace_id,
            account_user_id,
            allow_active_workspace: false,
        })
        .await
}

#[tauri::command]
pub async fn bind_workspace_connection_credentials(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: ConnectionId,
    username: String,
    password: String,
    ssh_alias: Option<String>,
) -> AppResult<ConnectionProfile> {
    let profile = state
        .services
        .workspace
        .bind_connection_credentials(WorkspaceCredentialBindingRequest {
            connection_id: id,
            username,
            password: Zeroizing::new(password),
            ssh_alias,
        })
        .await?;
    state.terminals.stop_connection(id, &app);
    state.agents_acp.stop_connection(id);
    Ok(profile)
}

#[tauri::command]
pub async fn update_workspace_connection(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    profile: ConnectionProfile,
) -> AppResult<ConnectionProfile> {
    let connection_id = profile.id.into();
    let profile = state
        .services
        .workspace
        .update_connection(WorkspaceConnectionUpdateRequest { profile })
        .await?;
    state.terminals.stop_connection(connection_id, &app);
    state.agents_acp.stop_connection(connection_id);
    Ok(profile)
}

#[tauri::command]
pub async fn set_workspace_connection_write_policy(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: ConnectionId,
    allow_writes: bool,
) -> AppResult<ConnectionProfile> {
    let profile = state
        .services
        .workspace
        .set_connection_write_policy(id, allow_writes)
        .await?;
    state.terminals.stop_connection(id, &app);
    state.agents_acp.stop_connection(id);
    Ok(profile)
}

#[tauri::command]
pub async fn delete_workspace_connection(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: ConnectionId,
) -> AppResult<ConnectionProfile> {
    let profile = state.services.workspace.delete_connection(id).await?;
    state.terminals.stop_connection(id, &app);
    state.agents_acp.stop_connection(id);
    Ok(profile)
}
