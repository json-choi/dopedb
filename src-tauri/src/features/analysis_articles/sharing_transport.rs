//! Sharing commands keep browser links free of credentials and fence account changes.
use super::adapters::hosted::{self, ArticleInvitationLink, ArticleSharing};
use crate::error::{AppError, AppResult};
use crate::kernel::identity::AccountId;
use crate::state::AppState;
use tauri::State;
use uuid::Uuid;

async fn selected_identity(state: &AppState, account_id: &AccountId) -> AppResult<i64> {
    let auth = state.services.workspace.auth_state().await?;
    if !auth.authenticated || auth.user.as_ref().map(|user| &user.id) != Some(account_id) {
        return Err(AppError::Blocked {
            reason: "Sign in with the account invited to this Article".into(),
        });
    }
    Ok(auth.authority_generation)
}

// Resolution can start from the personal workspace, but only for the explicitly
// selected account. The hosted request checks membership before any workspace switch.
#[tauri::command]
pub(crate) async fn article_sharing_command(
    state: State<'_, AppState>,
    account_id: AccountId,
    workspace_id: Uuid,
    article_id: Uuid,
) -> AppResult<ArticleSharing> {
    let generation = selected_identity(&state, &account_id).await?;
    let sharing = hosted::article_sharing(account_id.as_str(), workspace_id, article_id).await?;
    if selected_identity(&state, &account_id).await? != generation {
        return Err(AppError::Blocked {
            reason: "Workspace authority changed while opening the Article".into(),
        });
    }
    Ok(sharing)
}

async fn require_active_scope(
    state: &AppState,
    account_id: &AccountId,
    workspace_id: Uuid,
) -> AppResult<()> {
    selected_identity(state, account_id).await?;
    let scope = state.services.knowledge.active_resource_scope().await?;
    if scope.workspace_id != workspace_id
        || scope.selected_account_id.as_deref() != Some(account_id.as_str())
    {
        return Err(AppError::Blocked {
            reason: "Article sharing workspace changed".into(),
        });
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn create_article_invitation_command(
    state: State<'_, AppState>,
    account_id: AccountId,
    workspace_id: Uuid,
    article_id: Uuid,
    email: String,
) -> AppResult<ArticleInvitationLink> {
    require_active_scope(&state, &account_id, workspace_id).await?;
    hosted::invite_to_article(account_id.as_str(), workspace_id, article_id, &email).await
}

#[tauri::command]
pub(crate) async fn revoke_article_invitation_command(
    state: State<'_, AppState>,
    account_id: AccountId,
    workspace_id: Uuid,
    article_id: Uuid,
    invitation_id: Uuid,
) -> AppResult<()> {
    require_active_scope(&state, &account_id, workspace_id).await?;
    hosted::revoke_article_invitation(account_id.as_str(), workspace_id, article_id, invitation_id)
        .await
}
