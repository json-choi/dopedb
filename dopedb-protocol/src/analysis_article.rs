//! Credential-free contracts for current Analysis Articles.
//!
//! A definition is sanitized HTML plus exactly one bounded read-only query.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Shared delivery instructions for Desktop prompts and its typed MCP bridge.
pub const ANALYSIS_ARTICLE_AGENT_INSTRUCTIONS: &str = concat!(
    "ANALYSIS DELIVERY: DopeDB displays Markdown, tables, code fences, and Mermaid in chat. ",
    "When asked to create an analysis report, funnel, chart, or Article, save it with the DopeDB Analysis Article tools unless the user asks for a chat-only response. ",
    "Use analysis_article_verify on the complete definition, then analysis_article_propose to save a new workspace Article. ",
    "Check analysis_article_list to avoid duplicates; use analysis_article_update only when editing an existing Article at its exact revision. ",
    "An Article contains ordinary sanitized HTML and exactly one bounded read-only saved query on one selected connectionId. ",
    "Use headings, paragraphs, lists, and tables; omit scripts, styles, inline styles, forms, and remote embeds. ",
    "Keep measured values grounded in actual query receipts. Never replace the saved query with constant copies of its results. ",
    "For an analysis using several reads, state which part the single saved query reruns and date the other observations; never imply that it reruns every source. ",
    "A local HTML file, localhost preview, or host-specific visualization directive is not a DopeDB Article and cannot be displayed as one. ",
    "Do not use external artifact-rendering skills or browser tools to deliver it. ",
    "Report an Article as saved only after a successful propose or update returns its Article ID and revision. ",
    "If verification or saving fails, preserve the analysis in chat and explain the exact failure without claiming completion. ",
    "Do not automatically retry an operation conflict, enable automation, publish query rows, or publish a public snapshot."
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
