//! Adapter-neutral contracts owned by the Analysis Article feature.

use std::future::Future;

use dopedb_protocol::{
    AnalysisArticleRecord, AnalysisQueryNode, AnalysisQueryReceipt, SharedAnalysisArticleCreate,
};
use uuid::Uuid;

use crate::error::AppResult;

use super::domain::{
    AnalysisArticleMutation, AnalysisArticleRevision, AnalysisArticleSummary, AnalysisDataSet,
    AnalysisDefinitionRunReceipt, AnalysisRunRecord,
};

pub(crate) trait AnalysisLocalRepositoryPort: Clone + Send + Sync + 'static {
    fn personal_revisions(
        &self,
        article_id: Uuid,
    ) -> impl Future<Output = AppResult<Vec<AnalysisArticleRevision>>> + Send;
    fn delete_personal_article(
        &self,
        article_id: Uuid,
        expected_revision: i64,
    ) -> impl Future<Output = AppResult<i64>> + Send;
    fn assert_personal_pin(
        &self,
        article: &AnalysisArticleRecord,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn save_personal_run(
        &self,
        run: &AnalysisRunRecord,
        creating: bool,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn personal_run(
        &self,
        article_id: Uuid,
        run_id: Uuid,
    ) -> impl Future<Output = AppResult<AnalysisRunRecord>> + Send;
    fn personal_runs(
        &self,
        article_id: Uuid,
        before: Option<chrono::DateTime<chrono::Utc>>,
    ) -> impl Future<Output = AppResult<(Vec<AnalysisRunRecord>, Option<String>)>> + Send;
    fn load_result(
        &self,
        article_id: Uuid,
        run_id: Option<Uuid>,
    ) -> impl Future<Output = AppResult<Option<AnalysisDefinitionRunReceipt>>> + Send;

    fn delete_results(&self, article_id: Uuid) -> impl Future<Output = AppResult<()>> + Send;

    fn save_result(
        &self,
        workspace_id: Uuid,
        receipt: &AnalysisDefinitionRunReceipt,
        retention_days: u16,
    ) -> impl Future<Output = AppResult<()>> + Send;

    fn runner_device_id(
        &self,
        account_user_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Uuid>> + Send;

    fn replace_runner_device_id(
        &self,
        account_user_id: &str,
        workspace_id: Uuid,
    ) -> impl Future<Output = AppResult<Uuid>> + Send;
}

pub(crate) struct AnalysisReadExecutionRequest<'a> {
    pub(crate) workspace_id: Option<Uuid>,
    pub(crate) project_environment_id: Option<Uuid>,
    pub(crate) environment_revision: Option<i64>,
    pub(crate) connection_id: Uuid,
    pub(crate) connection_revision: i64,
    pub(crate) query: &'a AnalysisQueryNode,
    pub(crate) run_id: Uuid,
    pub(crate) cancellation_id: Uuid,
}

pub(crate) struct AnalysisReadExecutionOutcome {
    pub(crate) receipt: AnalysisQueryReceipt,
    pub(crate) data: AnalysisDataSet,
}

pub(crate) trait AnalysisReadExecutionPort: Clone + Send + Sync + 'static {
    fn execute_read<'a>(
        &'a self,
        request: AnalysisReadExecutionRequest<'a>,
    ) -> impl Future<Output = AppResult<AnalysisReadExecutionOutcome>> + Send + 'a;
}

pub(crate) trait AnalysisHostedAuthorityPort: Clone + Send + Sync + 'static {
    /// Title-and-identity listing whose size does not grow with HTML or SQL bodies.
    fn list_article_summaries(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Option<Uuid>,
    ) -> impl Future<Output = AppResult<Vec<AnalysisArticleSummary>>> + Send;

    fn get_article(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        article_id: Uuid,
    ) -> impl Future<Output = AppResult<AnalysisArticleRecord>> + Send;

    fn create_article(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        article: &SharedAnalysisArticleCreate,
    ) -> impl Future<Output = AppResult<AnalysisArticleRecord>> + Send;

    fn mutate_article(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        article_id: Uuid,
        expected_revision: i64,
        article: &SharedAnalysisArticleCreate,
    ) -> impl Future<Output = AppResult<AnalysisArticleMutation>> + Send;
}
