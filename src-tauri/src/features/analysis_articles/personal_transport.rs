//! Device-only manual Article execution. The saved definition, current Project
//! pins and read-only runner own authority; no hosted runner or credential exists.

use super::domain::{AnalysisRunRecord, AnalysisRunTrigger};
use super::transport::{failed_run_state, AnalysisRunCommandResult, AnalysisRunPage};
use super::AnalysisDefinitionRunRequest;
use crate::error::{AppError, AppResult};
use crate::executor::cancel;
use crate::state::AppState;
use chrono::Utc;
use dopedb_protocol::AnalysisRunState;
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(super) async fn list(
    state: &AppState,
    article_id: Uuid,
    before: Option<chrono::DateTime<Utc>>,
) -> AppResult<AnalysisRunPage> {
    let (runs, next_cursor) = state
        .services
        .analysis_article
        .personal_runs(article_id, before)
        .await?;
    Ok(AnalysisRunPage { runs, next_cursor })
}

pub(super) async fn run(
    state: &AppState,
    article_id: Uuid,
    expected_revision: i64,
    run_id: Option<Uuid>,
) -> AppResult<AnalysisRunCommandResult> {
    let feature = &state.services.analysis_article;
    let scope = state.services.knowledge.active_resource_scope().await?;
    let article = feature
        .get_remote("personal", scope.workspace_id, article_id)
        .await?;
    if article.revision != expected_revision {
        return Err(AppError::SharedConnectionChanged);
    }
    feature.assert_personal_pin(&article).await?;
    let run_id = run_id.unwrap_or_else(Uuid::new_v4);
    let cancellation = cancel::register(run_id);
    let now = Utc::now();
    let mut run = AnalysisRunRecord {
        id: run_id,
        article_id,
        article_revision: article.revision,
        runner_id: feature
            .runner_device_id("personal", scope.workspace_id)
            .await?,
        runner_capability_generation: 0,
        trigger: AnalysisRunTrigger::Manual,
        state: AnalysisRunState::Running,
        definition_hash: hex::encode(Sha256::digest(serde_json::to_vec(&article.definition)?)),
        schema_fingerprints: Default::default(),
        row_count: 0,
        byte_count: 0,
        result_hash: None,
        error_kind: None,
        error_message: None,
        cancel_requested_at: None,
        cancel_requested_by_member_id: None,
        started_at: Some(now),
        finished_at: None,
        created_at: now,
    };
    feature.save_personal_run(&run, true).await?;
    let outcome = state
        .services
        .analysis_article
        .run_definition(AnalysisDefinitionRunRequest {
            workspace_id: Some(scope.workspace_id),
            project_environment_id: Some(article.project_environment_id),
            environment_revision: Some(article.environment_revision),
            article_id,
            article_revision: article.revision,
            definition: article.definition,
            connection_id: article.connection_id,
            connection_revision: article.connection_revision,
            run_id,
            persist_local_result: true,
        })
        .await;
    let outcome = match outcome {
        Ok(_) if cancellation.is_cancelled() => {
            Err(AppError::Safety("Analysis Article run cancelled".into()))
        }
        Ok(result) => match feature
            .get_remote("personal", scope.workspace_id, article_id)
            .await
        {
            Ok(current) if current.revision == expected_revision => Ok(result),
            Ok(_) => Err(AppError::SharedConnectionChanged),
            Err(error) => Err(error),
        },
        Err(error) => Err(error),
    };
    run.finished_at = Some(Utc::now());
    if cancellation.is_cancelled() {
        run.cancel_requested_at = run.finished_at;
        run.cancel_requested_by_member_id = Some("local-owner".into());
    }
    match outcome {
        Ok(result) => {
            run.state = AnalysisRunState::Succeeded;
            run.result_hash = Some(result.result_hash.clone());
            if let Some(query) = result.query_receipts.first() {
                run.row_count = query.row_count;
                run.byte_count = query.byte_count;
                run.schema_fingerprints.insert(
                    query.query_node_id.clone(),
                    query.schema_fingerprint.clone(),
                );
            }
            feature.save_personal_run(&run, false).await?;
            Ok(AnalysisRunCommandResult { run, result })
        }
        Err(error) => {
            run.state = failed_run_state(&error);
            run.error_kind = Some(error.kind().chars().take(128).collect());
            run.error_message = Some(error.to_string().chars().take(2_000).collect());
            // A changed workspace can refuse the completion write; it must never
            // redirect the metadata or result to the newly selected workspace.
            if let Err(save_error) = feature.save_personal_run(&run, false).await {
                tracing::warn!(
                    error_kind = save_error.kind(),
                    "Personal Analysis run completion deferred"
                );
            }
            Err(error)
        }
    }
}

pub(super) async fn cancel(
    state: &AppState,
    article_id: Uuid,
    run_id: Uuid,
) -> AppResult<AnalysisRunRecord> {
    let scope = state.services.knowledge.active_resource_scope().await?;
    state
        .services
        .analysis_article
        .get_remote("personal", scope.workspace_id, article_id)
        .await?;
    let mut run = state
        .services
        .analysis_article
        .personal_run(article_id, run_id)
        .await?;
    if matches!(
        run.state,
        AnalysisRunState::Queued | AnalysisRunState::Running
    ) {
        cancel::cancel(run_id);
        run.cancel_requested_at = Some(Utc::now());
        run.cancel_requested_by_member_id = Some("local-owner".into());
    }
    Ok(run)
}
