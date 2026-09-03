//! Analysis Article runtime-only values.

use dopedb_protocol::{
    AnalysisArticleDefinition, AnalysisColumn, AnalysisQueryReceipt, AnalysisResultData,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalysisDefinitionRunRequest {
    #[serde(default)]
    pub(crate) workspace_id: Option<Uuid>,
    #[serde(default)]
    pub(crate) project_environment_id: Option<Uuid>,
    pub(crate) article_id: Uuid,
    pub(crate) article_revision: i64,
    pub(crate) definition: AnalysisArticleDefinition,
    pub(crate) connections: Vec<dopedb_protocol::AnalysisArticleConnection>,
    pub(crate) run_id: Uuid,
    #[serde(default)]
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
