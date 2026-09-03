//! Hosted metadata and authority operations for manual Analysis runs.

use super::*;

// Read compatibility for run rows created before Analysis became manual-only.
// New requests below serialize the literal `manual` and cannot select these
// retired trigger values.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HistoricalAnalysisRunTrigger {
    Manual,
    Schedule,
    Signal,
    Publication,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteAnalysisRun {
    pub(crate) id: Uuid,
    pub(crate) article_id: Uuid,
    pub(crate) article_revision: i64,
    pub(crate) runner_id: Uuid,
    #[serde(default)]
    pub(crate) runner_capability_generation: Option<u64>,
    pub(crate) trigger: HistoricalAnalysisRunTrigger,
    pub(crate) state: AnalysisRunState,
    pub(crate) definition_hash: String,
    pub(crate) schema_fingerprints: BTreeMap<String, String>,
    pub(crate) row_count: u64,
    pub(crate) byte_count: u64,
    pub(crate) result_hash: Option<String>,
    pub(crate) error_kind: Option<String>,
    pub(crate) error_message: Option<String>,
    pub(crate) cancel_requested_at: Option<DateTime<Utc>>,
    pub(crate) cancel_requested_by_member_id: Option<String>,
    pub(crate) started_at: Option<DateTime<Utc>>,
    pub(crate) finished_at: Option<DateTime<Utc>>,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteAnalysisRunControl {
    pub(crate) state: AnalysisRunState,
    pub(crate) cancel_requested_at: Option<DateTime<Utc>>,
    pub(crate) authorized: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RunControlResponse {
    control: RemoteAnalysisRunControl,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RunResponse {
    pub(super) run: RemoteAnalysisRun,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StartedRunResponse {
    run: RemoteAnalysisRun,
    article: AnalysisArticleRecord,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunCollectionResponse {
    runs: Vec<RemoteAnalysisRun>,
    next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartRunRequest {
    id: Uuid,
    article_revision: i64,
    runner_id: Uuid,
    trigger: &'static str,
}

pub(crate) struct StartAnalysisRunInput<'a> {
    pub(crate) user_id: &'a str,
    pub(crate) workspace_id: Uuid,
    pub(crate) article_id: Uuid,
    pub(crate) article_revision: i64,
    pub(crate) runner_id: Uuid,
    pub(crate) run_id: Uuid,
    pub(crate) runner_capability: &'a str,
    pub(crate) runner_capability_generation: u64,
}

pub(crate) async fn start_analysis_run(
    input: StartAnalysisRunInput<'_>,
) -> AppResult<(RemoteAnalysisRun, AnalysisArticleRecord)> {
    let token = token(input.user_id).await?;
    let request = client()?
        .post(format!(
            "{}/api/v1/workspaces/{}/analyses/{}/runs",
            origin()?,
            input.workspace_id,
            input.article_id,
        ))
        .bearer_auth(token.as_str())
        .header(ANALYSIS_RUNNER_CAPABILITY_HEADER, input.runner_capability)
        .json(&StartRunRequest {
            id: input.run_id,
            article_revision: input.article_revision,
            runner_id: input.runner_id,
            trigger: "manual",
        });
    let raw = request
        .send()
        .await
        .map_err(|error| request_error("starting an Analysis run", error))?;
    let body: StartedRunResponse = response(
        raw,
        input.user_id,
        "started Analysis run",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    validate_run(&body.run, input.article_id, Some(input.run_id))?;
    validate_article(&body.article, Some(input.article_id))?;
    if body.run.runner_id != input.runner_id
        || body.run.runner_capability_generation != Some(input.runner_capability_generation)
        || body.run.article_revision != input.article_revision
        || body.run.state != AnalysisRunState::Running
        || body.article.revision != input.article_revision
    {
        return Err(AppError::Network(
            "started Analysis run changed exact revision authority".into(),
        ));
    }
    Ok((body.run, body.article))
}

pub(crate) async fn get_analysis_run_control(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    run_id: Uuid,
    runner_capability: &str,
) -> AppResult<RemoteAnalysisRunControl> {
    let token = token(user_id).await?;
    let request = client()?
        .get(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/runs/{run_id}/control",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .header(ANALYSIS_RUNNER_CAPABILITY_HEADER, runner_capability);
    let raw = request
        .send()
        .await
        .map_err(|error| request_error("checking Analysis run control", error))?;
    let body: RunControlResponse = response(
        raw,
        user_id,
        "Analysis run control",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    Ok(body.control)
}

pub(crate) async fn list_analysis_runs(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    before: Option<DateTime<Utc>>,
) -> AppResult<(Vec<RemoteAnalysisRun>, Option<String>)> {
    let token = token(user_id).await?;
    let mut url = Url::parse(&format!(
        "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/runs",
        origin()?
    ))
    .map_err(|_| AppError::Config("Analysis run endpoint is invalid".into()))?;
    if let Some(before) = before {
        url.query_pairs_mut()
            .append_pair("before", &before.to_rfc3339());
    }
    let raw = client()?
        .get(url)
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading Analysis runs", error))?;
    let body: RunCollectionResponse = response(
        raw,
        user_id,
        "Analysis run collection",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    if body.runs.len() > 100 {
        return Err(AppError::Network(
            "Analysis run collection exceeded its page bound".into(),
        ));
    }
    for run in &body.runs {
        validate_run(run, article_id, None)?;
    }
    Ok((body.runs, body.next_cursor))
}

pub(crate) async fn cancel_analysis_run(
    user_id: &str,
    workspace_id: Uuid,
    article_id: Uuid,
    run_id: Uuid,
) -> AppResult<RemoteAnalysisRun> {
    let token = token(user_id).await?;
    let raw = client()?
        .post(format!(
            "{}/api/v1/workspaces/{workspace_id}/analyses/{article_id}/runs/{run_id}/cancel",
            origin()?
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("cancelling an Analysis run", error))?;
    let body: RunResponse = response(
        raw,
        user_id,
        "Analysis run cancellation",
        MAX_DEFINITION_RESPONSE_BYTES,
    )
    .await?;
    validate_run(&body.run, article_id, Some(run_id))?;
    if body.run.cancel_requested_at.is_none() {
        return Err(AppError::Network(
            "Analysis run cancellation did not record intent".into(),
        ));
    }
    Ok(body.run)
}
