//! Credential-free contracts for current Analysis Articles.
//!
//! A definition is sanitized HTML plus exactly one bounded read-only query.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Delivery contract advertised by the session's typed MCP bridge.
pub const ANALYSIS_ARTICLE_AGENT_INSTRUCTIONS: &str = concat!(
    "ANALYSIS DELIVERY: DopeDB displays Markdown, tables, code fences, and Mermaid in chat. ",
    "Save requested reports, funnels, charts, and Articles with the Article tools unless the user asks for chat only. A follow-up question alone does not request a save. ",
    "An Article is sanitized HTML plus one bounded read-only saved query on one selected connectionId. Load analysis_article_guide when authoring if its skill is not already in context; it describes the visual HTML and static SVG chart vocabulary. Scripts, author styles, forms, and remote embeds are not allowed. ",
    "Check analysis_article_list for the current Article before creating or editing; use analysis_article_propose for a new Article and analysis_article_update at the exact existing revision for edits. ",
    "Use analysis_article_verify to measure a new or changed saved query before saving. It executes the query: do not also run the same query through query_read. Reuse successful evidence for an unchanged query; title or HTML-only edits need no database read. ",
    "Ground measurements in query receipts, preserve their observation dates, and explain which part the single query reruns. Never invent values or substitute constant results for the saved query. ",
    "Authoring skills may help produce HTML and SVG; deliver the saved result through Article tools. A local file, localhost page, or host-specific render directive is not a saved Article. Confirm saving only from a successful Article ID and revision; on failure keep the analysis in chat and explain the failure. ",
    "Do not automatically retry a save with uncertain outcome or a revision conflict. Do not enable automation, publish query rows, or publish a public snapshot."
);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisArticleSource {
    Human,
    #[serde(rename = "dopedb.acp.claude")]
    DopedbAcpClaude,
    #[serde(rename = "dopedb.acp.codex")]
    DopedbAcpCodex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisColumnType {
    String,
    Number,
    Boolean,
    Date,
    Datetime,
    Duration,
    Currency,
    Percent,
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisColumnRole {
    Dimension,
    Measure,
    Time,
    Identifier,
    FreeText,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisColumnSensitivity {
    Public,
    Internal,
    Confidential,
    Restricted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisColumnMasking {
    None,
    Redact,
    Hash,
    Bucket,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub column_type: AnalysisColumnType,
    pub nullable: bool,
    pub role: AnalysisColumnRole,
    pub sensitivity: AnalysisColumnSensitivity,
    pub masking: AnalysisColumnMasking,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisQueryNode {
    pub id: String,
    pub title: String,
    pub sql: String,
    pub max_rows: u64,
    pub max_bytes: usize,
    pub columns: Vec<AnalysisColumn>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArticleDefinition {
    pub version: u32,
    pub source: AnalysisArticleSource,
    pub title: String,
    pub html: String,
    pub query: AnalysisQueryNode,
}

/// Agent-authored portion of a current Analysis Article. Authority and source
/// attribution are supplied by the exact Desktop session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArticleInputDefinition {
    pub version: u32,
    pub title: String,
    pub html: String,
    pub query: AnalysisQueryNode,
}

impl AnalysisArticleInputDefinition {
    pub fn with_source(self, source: AnalysisArticleSource) -> AnalysisArticleDefinition {
        AnalysisArticleDefinition {
            version: self.version,
            source,
            title: self.title,
            html: self.html,
            query: self.query,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedAnalysisArticleCreate {
    #[serde(deserialize_with = "deserialize_contract_uuid")]
    pub id: Uuid,
    #[serde(deserialize_with = "deserialize_contract_uuid")]
    pub project_environment_id: Uuid,
    pub environment_revision: i64,
    #[serde(deserialize_with = "deserialize_contract_uuid")]
    pub connection_id: Uuid,
    pub connection_revision: i64,
    pub definition: AnalysisArticleDefinition,
}

impl SharedAnalysisArticleCreate {
    pub fn validate(&self) -> bool {
        crate::analysis_article_validation::shared_create_is_valid(self)
    }
}

fn deserialize_contract_uuid<'de, D>(deserializer: D) -> Result<Uuid, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    parse_contract_uuid(&value).ok_or_else(|| serde::de::Error::custom("invalid contract UUID"))
}

fn parse_contract_uuid(value: &str) -> Option<Uuid> {
    let bytes = value.as_bytes();
    (bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|index| bytes[*index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
        && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'A' | b'b' | b'B'))
    .then(|| Uuid::parse_str(value).ok())
    .flatten()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArticleVersionPayload {
    pub id: Uuid,
    pub project_environment_id: Uuid,
    pub environment_revision: i64,
    pub connection_id: Uuid,
    pub connection_revision: i64,
    pub definition: AnalysisArticleDefinition,
    pub owner_member_id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArticleRecord {
    pub id: Uuid,
    pub project_environment_id: Uuid,
    pub environment_revision: i64,
    pub connection_id: Uuid,
    pub connection_revision: i64,
    pub definition: AnalysisArticleDefinition,
    pub owner_member_id: String,
    pub updated_by_member_id: String,
    pub revision: i64,
    pub latest_successful_run_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisRunState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Stale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisQueryState {
    Succeeded,
    Failed,
    Cancelled,
    Stale,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisQueryReceipt {
    pub query_node_id: String,
    pub connection_id: Uuid,
    pub connection_revision: i64,
    pub query_run_id: Uuid,
    pub query_hash: String,
    pub schema_fingerprint: String,
    pub state: AnalysisQueryState,
    pub row_count: u64,
    pub byte_count: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisResultData {
    pub columns: Vec<AnalysisColumn>,
    pub rows: Vec<Vec<Value>>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisRunError {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisRunReceipt {
    pub id: Uuid,
    pub article_id: Uuid,
    pub article_revision: i64,
    pub state: AnalysisRunState,
    pub query_receipts: Vec<AnalysisQueryReceipt>,
    pub result: AnalysisResultData,
    pub result_hash: Option<String>,
    pub error: Option<AnalysisRunError>,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
}
