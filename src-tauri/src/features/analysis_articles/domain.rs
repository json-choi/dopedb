//! Analysis Article runtime-only values.

use dopedb_protocol::{
    AnalysisArticleDefinition, AnalysisColumn, AnalysisQueryReceipt, AnalysisResultData,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

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
