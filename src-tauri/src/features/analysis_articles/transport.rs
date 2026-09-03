//! Tauri commands for current Analysis Articles. Definitions and immutable HTML
//! publications are shared; query results stay in Desktop's local recovery cache.

use std::time::Duration;

use dopedb_protocol::{
    AnalysisArticleRecord, AnalysisRunError, AnalysisRunState, SharedAnalysisArticleCreate,
};
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use super::adapters::hosted::{
    analysis_publication_url, analysis_runner_capability_is_missing,
    analysis_runner_registration_guard, cancel_analysis_run as cancel_remote_analysis_run,
    complete_analysis_run, create_analysis_publication, delete_analysis_article,
    get_analysis_run_control, list_analysis_article_revisions, list_analysis_publications,
    list_analysis_runs, register_analysis_runner, revoke_analysis_publication, start_analysis_run,
    AnalysisPublicationRequest, RemoteAnalysisArticleRevision, RemoteAnalysisPublication,
    RemoteAnalysisRun, StartAnalysisRunInput,
};
use crate::error::{AppError, AppResult};
use crate::executor::cancel;
use crate::kernel::access::{ActiveResourceScope, WorkspaceKind};
use crate::kernel::identity::AccountId;
use crate::state::AppState;

use super::{AnalysisDefinitionRunReceipt, AnalysisDefinitionRunRequest};

// This is execution authority/cancellation supervision, not Analysis log polling.
// Losing the control plane cancels the local query rather than extending a stale grant.
const ANALYSIS_CONTROL_POLL_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisRunCommandResult {
    run: RemoteAnalysisRun,
    result: AnalysisDefinitionRunReceipt,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisRunPage {
    runs: Vec<RemoteAnalysisRun>,
    next_cursor: Option<String>,
}

fn team_account(scope: &ActiveResourceScope) -> AppResult<AccountId> {
    if scope.workspace_kind != WorkspaceKind::Team {
        return Err(AppError::Config(
            "Shared Analysis Articles require a Team workspace".into(),
        ));
    }
    scope
        .selected_account_id
        .as_ref()
        .and_then(AccountId::new)
        .ok_or_else(|| AppError::Config("Analysis Articles require a selected account".into()))
}

async fn remote_scope(state: &AppState) -> AppResult<(ActiveResourceScope, AccountId)> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    let account = team_account(&scope)?;
    Ok((scope, account))
}

fn bounded_error(error: &AppError) -> AnalysisRunError {
    AnalysisRunError {
        kind: error.kind().chars().take(128).collect(),
        message: error.to_string().chars().take(2_000).collect(),
    }
}

fn cancelled_error(error: &AppError) -> bool {
    matches!(error, AppError::Safety(message) if message.to_ascii_lowercase().contains("cancel"))
}

#[tauri::command]
pub(crate) async fn list_analysis_articles_command(
    state: State<'_, AppState>,
    project_environment_id: Option<Uuid>,
) -> AppResult<Vec<AnalysisArticleRecord>> {
    let (scope, account) = remote_scope(&state).await?;
    state
        .services
        .analysis_article
        .list_remote(account.as_str(), scope.workspace_id, project_environment_id)
        .await
}

#[tauri::command]
pub(crate) async fn update_analysis_article_command(
    state: State<'_, AppState>,
    article_id: Uuid,
    expected_revision: i64,
    article: SharedAnalysisArticleCreate,
) -> AppResult<AnalysisArticleRecord> {
    let (scope, account) = remote_scope(&state).await?;
    state
        .services
        .analysis_article
        .mutate_remote(
            account.as_str(),
            scope.workspace_id,
            article_id,
            expected_revision,
            &article,
        )
        .await
}

#[tauri::command]
pub(crate) async fn delete_analysis_article_command(
    state: State<'_, AppState>,
    article_id: Uuid,
    expected_revision: i64,
) -> AppResult<i64> {
    let (scope, account) = remote_scope(&state).await?;
    let revision = delete_analysis_article(
        account.as_str(),
        scope.workspace_id,
        article_id,
        expected_revision,
    )
    .await?;
    if let Err(error) = state
        .services
        .analysis_article
        .delete_local_results(article_id)
        .await
    {
        tracing::warn!(
            error_kind = error.kind(),
            %article_id,
            "Analysis Article local recovery cleanup deferred"
        );
    }
    Ok(revision)
}

#[tauri::command]
pub(crate) async fn get_local_analysis_article_result_command(
    state: State<'_, AppState>,
    article_id: Uuid,
    run_id: Option<Uuid>,
) -> AppResult<Option<AnalysisDefinitionRunReceipt>> {
    state
        .services
        .analysis_article
        .load_local_result(article_id, run_id)
        .await
}

#[tauri::command]
pub(crate) async fn list_analysis_article_revisions_command(
    state: State<'_, AppState>,
    article_id: Uuid,
) -> AppResult<Vec<RemoteAnalysisArticleRevision>> {
    let (scope, account) = remote_scope(&state).await?;
    list_analysis_article_revisions(account.as_str(), scope.workspace_id, article_id).await
}

#[tauri::command]
pub(crate) async fn list_analysis_publications_command(
    state: State<'_, AppState>,
    article_id: Uuid,
) -> AppResult<Vec<RemoteAnalysisPublication>> {
    let (scope, account) = remote_scope(&state).await?;
    list_analysis_publications(account.as_str(), scope.workspace_id, article_id).await
}

#[tauri::command]
pub(crate) async fn create_analysis_publication_command(
    state: State<'_, AppState>,
    article_id: Uuid,
    request: AnalysisPublicationRequest,
) -> AppResult<RemoteAnalysisPublication> {
    let (scope, account) = remote_scope(&state).await?;
    create_analysis_publication(account.as_str(), scope.workspace_id, article_id, &request).await
}

#[tauri::command]
pub(crate) async fn revoke_analysis_publication_command(
    state: State<'_, AppState>,
    article_id: Uuid,
    publication_id: Uuid,
) -> AppResult<chrono::DateTime<chrono::Utc>> {
    let (scope, account) = remote_scope(&state).await?;
    revoke_analysis_publication(
        account.as_str(),
        scope.workspace_id,
        article_id,
        publication_id,
    )
    .await
}

#[tauri::command]
pub(crate) fn analysis_publication_url_command(slug: String) -> AppResult<String> {
    analysis_publication_url(&slug)
}

#[tauri::command]
pub(crate) async fn list_analysis_article_runs_command(
    state: State<'_, AppState>,
    article_id: Uuid,
    before: Option<chrono::DateTime<chrono::Utc>>,
) -> AppResult<AnalysisRunPage> {
    let (scope, account) = remote_scope(&state).await?;
    let (runs, next_cursor) =
        list_analysis_runs(account.as_str(), scope.workspace_id, article_id, before).await?;
    Ok(AnalysisRunPage { runs, next_cursor })
}

#[tauri::command]
pub(crate) async fn run_analysis_article_command(
    state: State<'_, AppState>,
    article_id: Uuid,
    article_revision: i64,
    run_id: Option<Uuid>,
) -> AppResult<AnalysisRunCommandResult> {
    let (scope, account) = remote_scope(&state).await?;
    let registration_guard = analysis_runner_registration_guard().await;
    let mut device_id = state
        .services
        .analysis_article
        .runner_device_id(account.as_str(), scope.workspace_id)
        .await?
        .to_string();
    let runner =
        match register_analysis_runner(account.as_str(), scope.workspace_id, &device_id).await {
            Ok(runner) => runner,
            Err(error) if analysis_runner_capability_is_missing(&error) => {
                device_id = state
                    .services
                    .analysis_article
                    .replace_runner_device_id(account.as_str(), scope.workspace_id)
                    .await?
                    .to_string();
                register_analysis_runner(account.as_str(), scope.workspace_id, &device_id).await?
            }
            Err(error) => return Err(error),
        };
    drop(registration_guard);
    let run_id = run_id.unwrap_or_else(Uuid::new_v4);
    let (_, article) = start_analysis_run(StartAnalysisRunInput {
        user_id: account.as_str(),
        workspace_id: scope.workspace_id,
        article_id,
        article_revision,
        runner_id: runner.runner.id,
        run_id,
        runner_capability: runner.capability(),
        runner_capability_generation: runner.generation(),
    })
    .await?;
    let request = AnalysisDefinitionRunRequest {
        workspace_id: Some(scope.workspace_id),
        project_environment_id: Some(article.project_environment_id),
        article_id,
        article_revision,
        definition: article.definition.clone(),
        connections: article.connections.clone(),
        run_id,
        persist_local_result: true,
    };
    let execution = state.services.analysis_article.run_definition(request);
    tokio::pin!(execution);
    let local = loop {
        let control_check = async {
            tokio::time::sleep(ANALYSIS_CONTROL_POLL_INTERVAL).await;
            get_analysis_run_control(
                account.as_str(),
                scope.workspace_id,
                article_id,
                run_id,
                runner.capability(),
            )
            .await
        };
        tokio::pin!(control_check);
        tokio::select! {
            result = &mut execution => break result,
            control = &mut control_check => {
                match control {
                    Ok(control) if !control.authorized
                        || control.cancel_requested_at.is_some()
                        || control.state != AnalysisRunState::Running => {
                        cancel::cancel(run_id);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::warn!(
                            run_id = %run_id,
                            error_kind = error.kind(),
                            "Analysis run authority could not be verified"
                        );
                        cancel::cancel(run_id);
                        break Err(AppError::Safety(
                            "Analysis Article run cancelled because authority could not be verified"
                                .into(),
                        ));
                    }
                }
            }
        }
    };

    match local {
        Ok(result) => {
            let control = get_analysis_run_control(
                account.as_str(),
                scope.workspace_id,
                article_id,
                run_id,
                runner.capability(),
            )
            .await?;
            if !control.authorized
                || control.cancel_requested_at.is_some()
                || control.state != AnalysisRunState::Running
            {
                if control.authorized && control.state == AnalysisRunState::Running {
                    let error = Some(AnalysisRunError {
                        kind: "cancelled".into(),
                        message: "Analysis Article run was cancelled".into(),
                    });
                    complete_analysis_run(
                        account.as_str(),
                        scope.workspace_id,
                        article_id,
                        run_id,
                        runner.capability(),
                        AnalysisRunState::Cancelled,
                        &result.query_receipts,
                        &error,
                    )
                    .await?;
                }
                return Err(AppError::Safety("Analysis Article run cancelled".into()));
            }
            let run = complete_analysis_run(
                account.as_str(),
                scope.workspace_id,
                article_id,
                run_id,
                runner.capability(),
                AnalysisRunState::Succeeded,
                &result.query_receipts,
                &None,
            )
            .await?;
            Ok(AnalysisRunCommandResult { run, result })
        }
        Err(error) => {
            let terminal_state = if cancelled_error(&error) {
                AnalysisRunState::Cancelled
            } else if matches!(&error, AppError::Blocked { .. } | AppError::NotFound(_)) {
                AnalysisRunState::Stale
            } else {
                AnalysisRunState::Failed
            };
            let completion_error = Some(bounded_error(&error));
            match complete_analysis_run(
                account.as_str(),
                scope.workspace_id,
                article_id,
                run_id,
                runner.capability(),
                terminal_state,
                &[],
                &completion_error,
            )
            .await
            {
                Ok(_) => {}
                Err(completion_failure) => {
                    tracing::error!(
                        run_id = %run_id,
                        error_kind = completion_failure.kind(),
                        "Analysis run failure receipt could not be committed"
                    );
                }
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn cancel_analysis_article_run(
    state: State<'_, AppState>,
    article_id: Uuid,
    run_id: Uuid,
) -> AppResult<RemoteAnalysisRun> {
    let (scope, account) = remote_scope(&state).await?;
    let remote =
        cancel_remote_analysis_run(account.as_str(), scope.workspace_id, article_id, run_id)
            .await?;
    cancel::cancel(run_id);
    Ok(remote)
}
