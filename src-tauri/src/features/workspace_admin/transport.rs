//! Tauri transport adapter for workspace administration use cases.

use serde_json::json;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::kernel::identity::AccountId;
use crate::state::AppState;

use super::application::ProviderAuthorizationStart;
use super::domain::{ProviderAuthorizationRequest, WorkspaceAdminRequest, WorkspaceAdminResponse};

async fn signed_in_accounts(state: &AppState) -> AppResult<Vec<AccountId>> {
    let auth = state.services.workspace.auth_state().await?;
    Ok(auth
        .accounts
        .into_iter()
        .map(|account| account.user.id)
        .collect())
}

#[tauri::command]
pub async fn workspace_admin_request(
    state: State<'_, AppState>,
    request: WorkspaceAdminRequest,
) -> AppResult<WorkspaceAdminResponse> {
    let signed_in = signed_in_accounts(&state).await?;
    state
        .services
        .workspace_admin
        .execute(&signed_in, request)
        .await
}

#[tauri::command]
pub async fn start_workspace_provider_authorization(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: ProviderAuthorizationRequest,
) -> AppResult<WorkspaceAdminResponse> {
    use tauri_plugin_opener::OpenerExt;
    let signed_in = signed_in_accounts(&state).await?;
    match state
        .services
        .workspace_admin
        .start_provider_authorization(&signed_in, request)
        .await?
    {
        ProviderAuthorizationStart::Refused(response) => Ok(response),
        ProviderAuthorizationStart::Open(url) => {
            app.opener().open_url(&url, None::<String>).map_err(|_| {
                AppError::Config("could not open the provider sign-in browser".into())
            })?;
            Ok(WorkspaceAdminResponse {
                status: 200,
                body: Some(json!({ "opened": true })),
            })
        }
    }
}
