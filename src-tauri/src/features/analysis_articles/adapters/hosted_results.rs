//! Hosted completion receipts for manual Analysis runs.
//!
//! Query rows never leave Desktop; only authority receipts cross this boundary.

use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompleteRunRequest<'a> {
    state: AnalysisRunState,
    query_receipts: &'a [AnalysisQueryReceipt],
    error: &'a Option<AnalysisRunError>,
}

#[expect(
    clippy::too_many_arguments,
    reason = "the hosted completion request keeps the exact run identity explicit"
)]
pub(crate) async fn complete_analysis_run(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    run_id: Uuid,
    runner_capability: &str,
    state: AnalysisRunState,
    query_receipts: &[AnalysisQueryReceipt],
    error: &Option<AnalysisRunError>,
) -> AppResult<RemoteAnalysisRun> {
    let terminal_receipts = if state == AnalysisRunState::Succeeded {
        query_receipts
    } else {
        &[]
    };
    let payload = CompleteRunRequest {
        state,
        query_receipts: terminal_receipts,
        error,
    };
    let token = token(user_id).await?;
    let raw = client()?
        .patch(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/runs/{run_id}",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .header(ANALYSIS_RUNNER_CAPABILITY_HEADER, runner_capability)
        .timeout(Duration::from_secs(60))
        .json(&payload)
        .send()
        .await
        .map_err(|error| request_error("completing an Analysis run", error))?;
    let body: RunResponse = response(
        raw,
        user_id,
        "completed Analysis run",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    validate_run(&body.run, article_id, Some(run_id))?;
    if body.run.state != state || body.run.finished_at.is_none() {
        return Err(AppError::Network(
            "Analysis run completion changed terminal state".into(),
        ));
    }
    Ok(body.run)
}
