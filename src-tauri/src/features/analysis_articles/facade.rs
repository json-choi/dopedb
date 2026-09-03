//! Analysis Article application facade. It depends only on feature-owned ports;
//! SQLite, connection runtimes, and hosted HTTP remain in concrete adapters.

use std::time::Duration;

use crate::error::AppResult;

use super::domain::{AnalysisDefinitionRunReceipt, AnalysisDefinitionRunRequest};
use super::ports::{
    AnalysisHostedAuthorityPort, AnalysisLocalRepositoryPort, AnalysisReadExecutionPort,
};
use super::runner::AnalysisArticleRunner;
use super::validation::validate_shared_create;

const LOCAL_RESULT_SAVE_TIMEOUT: Duration = Duration::from_secs(10);
const LOCAL_RESULT_RETENTION_DAYS: u16 = 30;

#[derive(Clone)]
pub(crate) struct AnalysisArticlesFeature<L, E, H> {
    runner: AnalysisArticleRunner<E>,
    local: L,
    hosted: H,
}

impl<L, E, H> AnalysisArticlesFeature<L, E, H>
where
    L: AnalysisLocalRepositoryPort,
    E: AnalysisReadExecutionPort,
    H: AnalysisHostedAuthorityPort,
{
    pub(crate) fn new(local: L, execution: E, hosted: H) -> Self {
        Self {
            runner: AnalysisArticleRunner::new(execution),
            local,
            hosted,
        }
    }

    pub(crate) async fn load_local_result(
        &self,
        article_id: uuid::Uuid,
        run_id: Option<uuid::Uuid>,
    ) -> AppResult<Option<AnalysisDefinitionRunReceipt>> {
        self.local.load_result(article_id, run_id).await
    }

    pub(crate) async fn delete_local_results(&self, article_id: uuid::Uuid) -> AppResult<()> {
        self.local.delete_results(article_id).await
    }

    pub(crate) async fn runner_device_id(
        &self,
        account_user_id: &str,
        workspace_id: uuid::Uuid,
    ) -> AppResult<uuid::Uuid> {
        self.local
            .runner_device_id(account_user_id, workspace_id)
            .await
    }

    pub(crate) async fn replace_runner_device_id(
        &self,
        account_user_id: &str,
        workspace_id: uuid::Uuid,
    ) -> AppResult<uuid::Uuid> {
        self.local
            .replace_runner_device_id(account_user_id, workspace_id)
            .await
    }

    pub(crate) async fn list_remote(
        &self,
        account_id: &str,
        workspace_id: uuid::Uuid,
        environment_id: Option<uuid::Uuid>,
    ) -> AppResult<Vec<dopedb_protocol::AnalysisArticleRecord>> {
        self.hosted
            .list_articles(account_id, workspace_id, environment_id)
            .await
    }

    pub(crate) async fn get_remote(
        &self,
        account_id: &str,
        workspace_id: uuid::Uuid,
        article_id: uuid::Uuid,
    ) -> AppResult<dopedb_protocol::AnalysisArticleRecord> {
        self.hosted
            .get_article(account_id, workspace_id, article_id)
            .await
    }

    pub(crate) async fn create_remote(
        &self,
        account_id: &str,
        workspace_id: uuid::Uuid,
        article: &dopedb_protocol::SharedAnalysisArticleCreate,
    ) -> AppResult<dopedb_protocol::AnalysisArticleRecord> {
        validate_shared_create(article)?;
        self.hosted
            .create_article(account_id, workspace_id, article)
            .await
    }

    pub(crate) async fn mutate_remote(
        &self,
        account_id: &str,
        workspace_id: uuid::Uuid,
        article_id: uuid::Uuid,
        expected_revision: i64,
        article: &dopedb_protocol::SharedAnalysisArticleCreate,
    ) -> AppResult<dopedb_protocol::AnalysisArticleRecord> {
        validate_shared_create(article)?;
        self.hosted
            .mutate_article(
                account_id,
                workspace_id,
                article_id,
                expected_revision,
                article,
            )
            .await
    }

    pub(crate) async fn run_definition(
        &self,
        request: AnalysisDefinitionRunRequest,
    ) -> AppResult<AnalysisDefinitionRunReceipt> {
        let workspace_id = request.workspace_id;
        let persist_local_result = request.persist_local_result;
        let receipt = self.runner.run_definition(request).await?;
        if persist_local_result {
            if let Some(workspace_id) = workspace_id {
                // Local recovery is an optional device cache. Never hold the
                // immutable hosted completion receipt behind a locked keychain,
                // slow disk, or repairable cache-schema error.
                let local = self.local.clone();
                let cached_receipt = receipt.clone();
                tokio::spawn(async move {
                    match tokio::time::timeout(
                        LOCAL_RESULT_SAVE_TIMEOUT,
                        local.save_result(
                            workspace_id,
                            &cached_receipt,
                            LOCAL_RESULT_RETENTION_DAYS,
                        ),
                    )
                    .await
                    {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => tracing::warn!(
                            error_kind = error.kind(),
                            article_id = %cached_receipt.article_id,
                            run_id = %cached_receipt.run_id,
                            "Analysis Article local recovery save deferred"
                        ),
                        Err(_) => tracing::warn!(
                            article_id = %cached_receipt.article_id,
                            run_id = %cached_receipt.run_id,
                            "Analysis Article local recovery save exceeded its deadline"
                        ),
                    }
                });
            }
        }
        Ok(receipt)
    }
}
