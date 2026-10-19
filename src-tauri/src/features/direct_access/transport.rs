//! Tauri transport for direct shared databases.
//!
//! Every command names the signed-in account beside the exact workspace and shared
//! database it acts on, so a background account switch cannot redirect it. Secrets
//! enter as zeroizing, debug-masked fields and are never echoed back; results are
//! categorical.

use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use dopedb_protocol::DirectRevocationEntry;

use super::application::{EndpointPrefill, PreflightInput, RegisterInput, RegisteredDatabase};
use super::revocation::{RevocationOutcome, RevokeApplyRequest};
use super::sync::SyncReport;
use super::types::{DirectScope, DirectStatus, PreflightReport};
use crate::error::AppResult;
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};
use crate::state::AppState;

async fn signed_in_accounts(state: &AppState) -> AppResult<Vec<AccountId>> {
    Ok(state
        .services
        .workspace
        .auth_state()
        .await?
        .accounts
        .into_iter()
        .map(|account| account.user.id)
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectScopeInput {
    account_id: AccountId,
    workspace_id: WorkspaceId,
    connection_id: ConnectionId,
}

impl From<DirectScopeInput> for DirectScope {
    fn from(input: DirectScopeInput) -> Self {
        Self {
            account_id: input.account_id,
            workspace_id: input.workspace_id,
            connection_id: input.connection_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectMemberRequestInput {
    account_id: AccountId,
    workspace_id: WorkspaceId,
    connection_id: ConnectionId,
    ssh_alias: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectRevocationListInput {
    account_id: AccountId,
    workspace_id: WorkspaceId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectRevocationCancelInput {
    account_id: AccountId,
    workspace_id: WorkspaceId,
    revocation_id: Uuid,
}

#[tauri::command]
pub async fn direct_access_prefill_from_connection(
    state: State<'_, AppState>,
    connection_id: ConnectionId,
) -> AppResult<EndpointPrefill> {
    state.services.direct_access.prefill(connection_id).await
}

#[tauri::command]
pub async fn direct_access_preflight(
    state: State<'_, AppState>,
    input: PreflightInput,
) -> AppResult<PreflightReport> {
    let signed_in = signed_in_accounts(&state).await?;
    state
        .services
        .direct_access
        .preflight(&signed_in, input)
        .await
}

#[tauri::command]
pub async fn direct_access_register(
    state: State<'_, AppState>,
    input: RegisterInput,
) -> AppResult<RegisteredDatabase> {
    let signed_in = signed_in_accounts(&state).await?;
    state
        .services
        .direct_access
        .register(&signed_in, input)
        .await
}

#[tauri::command]
pub async fn direct_access_member_request(
    state: State<'_, AppState>,
    input: DirectMemberRequestInput,
) -> AppResult<DirectStatus> {
    let signed_in = signed_in_accounts(&state).await?;
    let scope = DirectScope {
        account_id: input.account_id,
        workspace_id: input.workspace_id,
        connection_id: input.connection_id,
    };
    state
        .services
        .direct_access
        .member_request(&signed_in, scope, input.ssh_alias)
        .await
}

#[tauri::command]
pub async fn direct_access_status(
    state: State<'_, AppState>,
    input: DirectScopeInput,
) -> AppResult<DirectStatus> {
    let signed_in = signed_in_accounts(&state).await?;
    state
        .services
        .direct_access
        .status(&signed_in, input.into())
        .await
}

#[tauri::command]
pub async fn direct_access_sync_now(
    state: State<'_, AppState>,
    input: DirectScopeInput,
) -> AppResult<SyncReport> {
    let signed_in = signed_in_accounts(&state).await?;
    let scope: DirectScope = input.into();
    crate::features::workspace_admin::domain::require_signed_in_account(
        &signed_in,
        &scope.account_id,
    )?;
    state
        .services
        .direct_access
        .sync_once(&scope, true, true)
        .await
}

#[tauri::command]
pub async fn direct_access_revoke_apply(
    state: State<'_, AppState>,
    request: RevokeApplyRequest,
) -> AppResult<RevocationOutcome> {
    let signed_in = signed_in_accounts(&state).await?;
    state
        .services
        .direct_access
        .revoke_apply(&signed_in, request)
        .await
}

#[tauri::command]
pub async fn direct_access_revocations(
    state: State<'_, AppState>,
    input: DirectRevocationListInput,
) -> AppResult<Vec<DirectRevocationEntry>> {
    let signed_in = signed_in_accounts(&state).await?;
    state
        .services
        .direct_access
        .list_revocations(&signed_in, &input.account_id, input.workspace_id)
        .await
}

#[tauri::command]
pub async fn direct_access_revocation_cancel(
    state: State<'_, AppState>,
    input: DirectRevocationCancelInput,
) -> AppResult<()> {
    let signed_in = signed_in_accounts(&state).await?;
    state
        .services
        .direct_access
        .cancel_revocation(
            &signed_in,
            &input.account_id,
            input.workspace_id,
            input.revocation_id,
        )
        .await
}

#[tauri::command]
pub async fn direct_access_forget_admin_credential(
    state: State<'_, AppState>,
    input: DirectScopeInput,
) -> AppResult<()> {
    let signed_in = signed_in_accounts(&state).await?;
    state
        .services
        .direct_access
        .forget_admin_credential(&signed_in, &input.into())
}
