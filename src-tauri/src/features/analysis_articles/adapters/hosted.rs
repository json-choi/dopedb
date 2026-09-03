//! Authenticated Analysis Article control-plane adapter. Bearer sessions and
//! manual-run capabilities stay in Rust; result rows never leave Desktop.

use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{DateTime, Utc};
use dopedb_protocol::{
    AnalysisArticleRecord, AnalysisArticleVersionPayload, AnalysisQueryReceipt, AnalysisRunError,
    AnalysisRunState, SharedAnalysisArticleCreate,
};
use reqwest::{Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::connection::keychain::{
    delete_analysis_runner_capability, delete_workspace_session, fetch_analysis_runner_capability,
    fetch_workspace_session, store_analysis_runner_capability,
};
use crate::error::{AppError, AppResult};
use crate::hosted_control_plane::{
    bounded_json_response, client, origin, request_error, response_error as oauth_error,
    EXPECTED_REVISION_HEADER,
};

use super::super::ports::AnalysisHostedAuthorityPort;

#[path = "hosted_articles.rs"]
mod articles;
#[path = "hosted_results.rs"]
mod results;
#[path = "hosted_runners.rs"]
mod runners;
#[path = "hosted_runs.rs"]
mod runs;

pub(crate) use articles::*;
pub(crate) use results::complete_analysis_run;
pub(crate) use runners::*;
pub(crate) use runs::*;

const MAX_DEFINITION_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const ANALYSIS_RUNNER_CAPABILITY_HEADER: &str = "x-dopedb-analysis-runner-capability";
const ANALYSIS_RUNNER_CAPABILITY_VERSION_HEADER: &str =
    "x-dopedb-analysis-runner-capability-version";
const ANALYSIS_RUNNER_CAPABILITY_VERSION: &str = "1";
const ANALYSIS_RUNNER_CAPABILITY_MISSING: &str =
    "Analysis runner possession is missing from this device";

static ANALYSIS_RUNNER_REGISTRATION_LOCK: tokio::sync::Mutex<()> =
    tokio::sync::Mutex::const_new(());

pub(crate) fn analysis_runner_capability_is_missing(error: &AppError) -> bool {
    matches!(error, AppError::Blocked { reason } if reason == ANALYSIS_RUNNER_CAPABILITY_MISSING)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArticleCollectionResponse {
    workspace_id: Uuid,
    articles: Vec<AnalysisArticleRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ArticleResponse {
    article: AnalysisArticleRecord,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteAnalysisArticleRevision {
    pub(crate) revision: i64,
    pub(crate) base_revision: Option<i64>,
    pub(crate) operation: String,
    pub(crate) payload: AnalysisArticleVersionPayload,
    pub(crate) payload_hash: String,
    pub(crate) created_by_member_id: String,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevisionCollectionResponse {
    article_id: Uuid,
    revisions: Vec<RemoteAnalysisArticleRevision>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DeletedArticleResponse {
    deleted: bool,
    revision: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisPublicationRequest {
    pub(crate) id: Uuid,
    pub(crate) run_id: Uuid,
    pub(crate) slug: String,
    pub(crate) replace_publication_id: Option<Uuid>,
    pub(crate) visibility: String,
    pub(crate) search_indexable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteAnalysisPublication {
    pub(crate) id: Uuid,
    pub(crate) article_revision: i64,
    pub(crate) source_run_id: Uuid,
    pub(crate) slug: String,
    pub(crate) version: i64,
    pub(crate) replaces_publication_id: Option<Uuid>,
    pub(crate) visibility: String,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) snapshot_hash: String,
    pub(crate) published_at: DateTime<Utc>,
    pub(crate) revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicationCollectionResponse {
    publications: Vec<RemoteAnalysisPublication>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicationResponse {
    publication: RemoteAnalysisPublication,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicationRevocationResponse {
    id: Uuid,
    revoked_at: DateTime<Utc>,
}

async fn token(user_id: &str) -> AppResult<Zeroizing<String>> {
    fetch_workspace_session(user_id)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| AppError::Config("Analysis Articles require sign-in".into()))
}

async fn bounded_json<T: DeserializeOwned>(
    response: Response,
    action: &str,
    maximum: usize,
) -> AppResult<T> {
    bounded_json_response(response, action, maximum).await
}

async fn response<T: DeserializeOwned>(
    response: Response,
    user_id: &str,
    action: &str,
    maximum: usize,
) -> AppResult<T> {
    if response.status() == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
    }
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    bounded_json(response, action, maximum).await
}

async fn article_mutation_response<T: DeserializeOwned>(
    response: Response,
    user_id: &str,
    action: &str,
    maximum: usize,
) -> AppResult<T> {
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
    }
    if status.is_success() {
        return bounded_json(response, action, maximum).await;
    }

    // Consume the bounded hosted error for connection reuse, but expose only
    // domain-owned messages to the Broker. Control-plane text is not trusted
    // Agent output and must not cross the ACP boundary verbatim.
    let hosted_error = oauth_error(response).await;
    Err(classify_article_mutation_error(status, hosted_error))
}

fn classify_article_mutation_error(status: StatusCode, hosted_error: AppError) -> AppError {
    match status {
        StatusCode::BAD_REQUEST
        | StatusCode::UNPROCESSABLE_ENTITY
        | StatusCode::PRECONDITION_REQUIRED => {
            AppError::Config("Analysis Article definition or mutation contract is invalid".into())
        }
        StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED => AppError::OutcomeUnknown(
            "Analysis Article revision changed before the mutation could be applied".into(),
        ),
        StatusCode::FORBIDDEN => AppError::Blocked {
            reason: "Analysis Article mutation authority is no longer available".into(),
        },
        StatusCode::NOT_FOUND => AppError::NotFound("Analysis Article".into()),
        _ => hosted_error,
    }
}

#[cfg(test)]
pub(crate) fn assert_hosted_mutation_error_contract() {
    let upstream = || AppError::Network("untrusted upstream detail".into());
    assert!(matches!(
        classify_article_mutation_error(StatusCode::BAD_REQUEST, upstream()),
        AppError::Config(_)
    ));
    assert!(matches!(
        classify_article_mutation_error(StatusCode::UNPROCESSABLE_ENTITY, upstream()),
        AppError::Config(_)
    ));
    assert!(matches!(
        classify_article_mutation_error(StatusCode::CONFLICT, upstream()),
        AppError::OutcomeUnknown(_)
    ));
    assert!(matches!(
        classify_article_mutation_error(StatusCode::BAD_GATEWAY, upstream()),
        AppError::Network(_)
    ));
}

fn validate_article(article: &AnalysisArticleRecord, expected_id: Option<Uuid>) -> AppResult<()> {
    if expected_id.is_some_and(|id| id != article.id)
        || article.environment_revision < 1
        || article.revision < 1
        || article.connections.is_empty()
        || article.definition.version != 3
    {
        return Err(AppError::Network(
            "Analysis Article returned invalid identity or authority".into(),
        ));
    }
    Ok(())
}

fn deserialize_optional_secret<'de, D>(
    deserializer: D,
) -> Result<Option<Zeroizing<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(|value| value.map(Zeroizing::new))
}

fn validate_run(run: &RemoteAnalysisRun, article_id: Uuid, run_id: Option<Uuid>) -> AppResult<()> {
    if run.article_id != article_id
        || run_id.is_some_and(|id| run.id != id)
        || run.article_revision < 1
        || run.definition_hash.len() != 64
        || matches!(
            run.state,
            AnalysisRunState::Queued | AnalysisRunState::Running
        ) && !matches!(run.runner_capability_generation, Some(generation) if generation > 0)
        || run
            .result_hash
            .as_ref()
            .is_some_and(|hash| hash.len() != 64)
    {
        return Err(AppError::Network(
            "Analysis run returned invalid identity or evidence".into(),
        ));
    }
    Ok(())
}

fn validate_publication(
    publication: &RemoteAnalysisPublication,
    expected_id: Option<Uuid>,
) -> AppResult<()> {
    let slug_valid = publication.slug.len() >= 8
        && publication.slug.len() <= 128
        && publication.slug.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if expected_id.is_some_and(|id| publication.id != id)
        || publication.article_revision < 1
        || publication.version < 1
        || !slug_valid
        || !matches!(publication.visibility.as_str(), "unlisted" | "public")
        || publication.title.trim().is_empty()
        || publication.title.chars().count() > 160
        || publication.description.chars().count() > 2_000
        || publication.snapshot_hash.len() != 64
    {
        return Err(AppError::Network(
            "Analysis publication returned invalid immutable evidence".into(),
        ));
    }
    Ok(())
}

#[derive(Clone, Copy)]
pub(crate) struct HostedAnalysisAuthority;

impl AnalysisHostedAuthorityPort for HostedAnalysisAuthority {
    async fn list_articles(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Option<Uuid>,
    ) -> AppResult<Vec<AnalysisArticleRecord>> {
        list_analysis_articles(account_id, workspace_id, environment_id).await
    }

    async fn get_article(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        article_id: Uuid,
    ) -> AppResult<AnalysisArticleRecord> {
        get_analysis_article(account_id, workspace_id, article_id).await
    }

    async fn create_article(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        article: &SharedAnalysisArticleCreate,
    ) -> AppResult<AnalysisArticleRecord> {
        create_analysis_article(account_id, workspace_id, article).await
    }

    async fn mutate_article(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        article_id: Uuid,
        expected_revision: i64,
        article: &SharedAnalysisArticleCreate,
    ) -> AppResult<AnalysisArticleRecord> {
        mutate_analysis_article(
            account_id,
            workspace_id,
            article_id,
            expected_revision,
            article,
        )
        .await
    }
}
