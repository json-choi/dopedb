//! Adapter-neutral contracts owned by the Analysis Article feature.

use std::future::Future;

use dopedb_protocol::{
    AnalysisArticleRecord, AnalysisQueryNode, AnalysisQueryReceipt, SharedAnalysisArticleCreate,
};
use uuid::Uuid;

use crate::error::AppResult;

use super::domain::{AnalysisDataSet, AnalysisDefinitionRunReceipt};

pub(crate) trait AnalysisLocalRepositoryPort: Clone + Send + Sync + 'static {
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
    fn list_articles(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Option<Uuid>,
    ) -> impl Future<Output = AppResult<Vec<AnalysisArticleRecord>>> + Send;

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
    ) -> impl Future<Output = AppResult<AnalysisArticleRecord>> + Send;
}
