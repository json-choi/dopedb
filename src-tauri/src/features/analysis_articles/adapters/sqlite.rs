//! SQLite-backed local result recovery and manual-run capability identity.

use uuid::Uuid;

use crate::error::AppResult;
use crate::store::Store;

use super::super::domain::AnalysisDefinitionRunReceipt;
use super::super::ports::AnalysisLocalRepositoryPort;

#[derive(Clone)]
pub(crate) struct SqliteAnalysisLocalRepository {
    store: Store,
}

impl SqliteAnalysisLocalRepository {
    pub(crate) fn new(store: Store) -> Self {
        Self { store }
    }
}

impl AnalysisLocalRepositoryPort for SqliteAnalysisLocalRepository {
    async fn personal_revisions(
        &self,
        article_id: Uuid,
    ) -> AppResult<Vec<crate::features::analysis_articles::AnalysisArticleRevision>> {
        self.store
            .personal_article_revisions(article_id, &crate::store::personal_article_key().await?)
            .await
    }
    async fn delete_personal_article(
        &self,
        article_id: Uuid,
        expected_revision: i64,
    ) -> AppResult<i64> {
        self.store
            .delete_personal_article(
                article_id,
                expected_revision,
                &crate::store::personal_article_key().await?,
            )
            .await
    }
    async fn assert_personal_pin(
        &self,
        article: &dopedb_protocol::AnalysisArticleRecord,
    ) -> AppResult<()> {
        self.store
            .check_personal_article_pin(
                article.project_environment_id,
                article.environment_revision,
                article.connection_id,
                article.connection_revision,
            )
            .await
    }
    async fn save_personal_run(
        &self,
        run: &crate::features::analysis_articles::AnalysisRunRecord,
        creating: bool,
    ) -> AppResult<()> {
        self.store
            .save_personal_analysis_run(run, creating, &crate::store::personal_article_key().await?)
            .await
    }
    async fn personal_run(
        &self,
        article_id: Uuid,
        run_id: Uuid,
    ) -> AppResult<crate::features::analysis_articles::AnalysisRunRecord> {
        self.store
            .personal_analysis_run(
                article_id,
                run_id,
                &crate::store::personal_article_key().await?,
            )
            .await
    }
    async fn personal_runs(
        &self,
        article_id: Uuid,
        before: Option<chrono::DateTime<chrono::Utc>>,
    ) -> AppResult<(
        Vec<crate::features::analysis_articles::AnalysisRunRecord>,
        Option<String>,
    )> {
        self.store
            .personal_analysis_runs(
                article_id,
                before,
                &crate::store::personal_article_key().await?,
            )
            .await
    }
    async fn load_result(
        &self,
        article_id: Uuid,
        run_id: Option<Uuid>,
    ) -> AppResult<Option<AnalysisDefinitionRunReceipt>> {
        self.store
            .load_analysis_article_local_result(article_id, run_id)
            .await
    }

    async fn delete_results(&self, article_id: Uuid) -> AppResult<()> {
        self.store
            .delete_analysis_article_local_results(article_id)
            .await
    }

    async fn save_result(
        &self,
        workspace_id: Uuid,
        receipt: &AnalysisDefinitionRunReceipt,
        retention_days: u16,
    ) -> AppResult<()> {
        self.store
            .save_analysis_article_local_result(workspace_id, receipt, retention_days)
            .await
    }

    async fn runner_device_id(&self, account_user_id: &str, workspace_id: Uuid) -> AppResult<Uuid> {
        self.store
            .analysis_run_device_id(account_user_id, workspace_id)
            .await
    }

    async fn replace_runner_device_id(
        &self,
        account_user_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<Uuid> {
        self.store
            .replace_analysis_run_device_id(account_user_id, workspace_id)
            .await
    }
}
