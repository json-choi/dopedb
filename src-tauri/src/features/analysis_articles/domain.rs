//! Analysis Article runtime-only values.

use dopedb_protocol::{
    AnalysisArticleDefinition, AnalysisArticleRecord, AnalysisArticleSource, AnalysisColumn,
    AnalysisQueryReceipt, AnalysisResultData,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// Bounded list projection of one Article: identity, authority pins, and title.
/// HTML and SQL are read one Article at a time, so a few large bodies cannot push
/// the whole collection past its response cap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisArticleSummary {
    pub(crate) id: Uuid,
    pub(crate) project_environment_id: Uuid,
    pub(crate) environment_revision: i64,
    pub(crate) connection_id: Uuid,
    pub(crate) connection_revision: i64,
    pub(crate) definition: AnalysisArticleSummaryDefinition,
    pub(crate) owner_member_id: String,
    pub(crate) updated_by_member_id: String,
    pub(crate) revision: i64,
    pub(crate) latest_successful_run_id: Option<Uuid>,
    pub(crate) created_at: chrono::DateTime<chrono::Utc>,
    pub(crate) updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisArticleSummaryDefinition {
    pub(crate) version: u32,
    pub(crate) source: AnalysisArticleSource,
    pub(crate) title: String,
}

impl From<AnalysisArticleRecord> for AnalysisArticleSummary {
    fn from(article: AnalysisArticleRecord) -> Self {
        Self {
            id: article.id,
            project_environment_id: article.project_environment_id,
            environment_revision: article.environment_revision,
            connection_id: article.connection_id,
            connection_revision: article.connection_revision,
            definition: AnalysisArticleSummaryDefinition {
                version: article.definition.version,
                source: article.definition.source,
                title: article.definition.title,
            },
            owner_member_id: article.owner_member_id,
            updated_by_member_id: article.updated_by_member_id,
            revision: article.revision,
            latest_successful_run_id: article.latest_successful_run_id,
            created_at: article.created_at,
            updated_at: article.updated_at,
        }
    }
}

/// One optimistic Article write. A stale expected revision is a definite rejection:
/// nothing was applied, so the caller reloads instead of treating it as unknown.
#[derive(Debug, Clone)]
pub(crate) enum AnalysisArticleMutation {
    Applied(Box<AnalysisArticleRecord>),
    RevisionConflict,
}

/// Desktop editor save receipt. A conflict carries the latest revision when it could
/// be read, so the person can re-apply the unsaved draft on top of it.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub(crate) enum AnalysisArticleSaveResult {
    Saved {
        article: Box<AnalysisArticleRecord>,
    },
    Conflict {
        latest: Option<Box<AnalysisArticleRecord>>,
    },
}

#[derive(Debug, Clone)]
pub(crate) struct AnalysisDefinitionRunRequest {
    pub(crate) workspace_id: Option<Uuid>,
    pub(crate) project_environment_id: Option<Uuid>,
    pub(crate) article_id: Uuid,
    pub(crate) article_revision: i64,
    pub(crate) definition: AnalysisArticleDefinition,
    pub(crate) connection_id: Uuid,
    pub(crate) connection_revision: i64,
    pub(crate) run_id: Uuid,
    pub(crate) persist_local_result: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct AnalysisDataSet {
    pub(crate) columns: Vec<AnalysisColumn>,
    pub(crate) rows: Vec<Vec<Value>>,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisDefinitionRunReceipt {
    pub(crate) run_id: Uuid,
    pub(crate) article_id: Uuid,
    pub(crate) article_revision: i64,
    pub(crate) query_receipts: Vec<AnalysisQueryReceipt>,
    pub(crate) result: AnalysisResultData,
    pub(crate) result_hash: String,
    pub(crate) started_at: chrono::DateTime<chrono::Utc>,
    pub(crate) finished_at: chrono::DateTime<chrono::Utc>,
}

pub(crate) fn deserialize_local_result(bytes: &[u8]) -> AppResult<AnalysisDefinitionRunReceipt> {
    serde_json::from_slice(bytes)
        .map_err(|_| AppError::Config("Analysis Article local result format is unsupported".into()))
}
