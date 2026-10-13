//! Routes definitions to the device-only personal repository or the authenticated
//! team authority. A local definition never falls back to a cloud request.

use super::super::domain::{AnalysisArticleMutation, AnalysisArticleSummary};
use super::super::ports::AnalysisHostedAuthorityPort;
use super::HostedAnalysisAuthority;
use crate::error::{AppError, AppResult};
use crate::kernel::access::WorkspaceKind;
use crate::store::{personal_article_key, Store};
use dopedb_protocol::{AnalysisArticleRecord, SharedAnalysisArticleCreate};
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct ScopedAnalysisAuthority {
    store: Store,
}

impl ScopedAnalysisAuthority {
    pub(crate) fn new(store: Store) -> Self {
        Self { store }
    }
    async fn personal(&self, workspace_id: Uuid) -> AppResult<()> {
        let scope = self.store.active_resource_scope().await?;
        if scope.workspace_kind != WorkspaceKind::Personal || scope.workspace_id != workspace_id {
            return Err(AppError::Blocked {
                reason: "Personal Analysis Article workspace changed".into(),
            });
        }
        self.store.require_personal_articles().await
    }
}

impl AnalysisHostedAuthorityPort for ScopedAnalysisAuthority {
    async fn list_article_summaries(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        environment_id: Option<Uuid>,
    ) -> AppResult<Vec<AnalysisArticleSummary>> {
        if account_id != "personal" {
            return HostedAnalysisAuthority
                .list_article_summaries(account_id, workspace_id, environment_id)
                .await;
        }
        self.personal(workspace_id).await?;
        self.store
            .personal_article_summaries(environment_id, &personal_article_key().await?)
            .await
    }
    async fn get_article(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        article_id: Uuid,
    ) -> AppResult<AnalysisArticleRecord> {
        if account_id != "personal" {
            return HostedAnalysisAuthority
                .get_article(account_id, workspace_id, article_id)
                .await;
        }
        self.personal(workspace_id).await?;
        self.store
            .personal_article(article_id, &personal_article_key().await?)
            .await
    }
    async fn create_article(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        article: &SharedAnalysisArticleCreate,
    ) -> AppResult<AnalysisArticleRecord> {
        if account_id != "personal" {
            return HostedAnalysisAuthority
                .create_article(account_id, workspace_id, article)
                .await;
        }
        self.personal(workspace_id).await?;
        match self
            .store
            .save_personal_article(article, None, &personal_article_key().await?)
            .await?
        {
            AnalysisArticleMutation::Applied(article) => Ok(*article),
            AnalysisArticleMutation::RevisionConflict => Err(AppError::OutcomeUnknown(
                "Analysis Article already exists; creation was not applied".into(),
            )),
        }
    }
    async fn mutate_article(
        &self,
        account_id: &str,
        workspace_id: Uuid,
        article_id: Uuid,
        expected_revision: i64,
        article: &SharedAnalysisArticleCreate,
    ) -> AppResult<AnalysisArticleMutation> {
        if account_id != "personal" {
            return HostedAnalysisAuthority
                .mutate_article(
                    account_id,
                    workspace_id,
                    article_id,
                    expected_revision,
                    article,
                )
                .await;
        }
        if article.id != article_id || expected_revision < 1 {
            return Err(AppError::Config(
                "Analysis Article identity is invalid".into(),
            ));
        }
        self.personal(workspace_id).await?;
        self.store
            .save_personal_article(
                article,
                Some(expected_revision),
                &personal_article_key().await?,
            )
            .await
    }
}
