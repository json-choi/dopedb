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
