//! SQL query contracts and pure planning guidance.
//!
//! These values deliberately contain only typed identities and allowlisted display
//! data; platform persistence, pool handles, and protocol UUID conversion stay in adapters.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::kernel::identity::{ConnectionId, OperationId, QueryRunId};
use crate::kernel::TerminalAuthority;
use crate::model::{ConnectionProfile, QueryResult};
use crate::monitoring::HealthSnapshot;

const MAX_QUERY_SERVICE_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;
const MAX_QUERY_SERVICE_ID_BYTES: usize = 512;
const MAX_QUERY_SERVICE_LABEL_BYTES: usize = 512;

#[derive(Debug, thiserror::Error)]
pub(crate) enum QueryDomainError {
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    LimitExceeded(String),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
}

type QueryDomainResult<T> = Result<T, QueryDomainError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum QueryServiceSessionStatus {
    Completed,
    Failed,
    Cancelled,
}

impl QueryServiceSessionStatus {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct QueryServiceSessionSnapshot {
    pub(crate) id: String,
    pub(crate) connection_id: ConnectionId,
    pub(crate) updated_at: i64,
    pub(crate) status: QueryServiceSessionStatus,
    pub(crate) snapshot: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueryServiceSessionEnvelope {
    schema_version: u32,
    id: String,
    document_id: String,
    connection_id: String,
    connection_name: String,
    console_title: String,
    database: String,
    namespace: String,
    sql: String,
    started_at: String,
    started_label: String,
    updated_at: i64,
    status: String,
    result: Value,
}

pub(crate) fn validate_query_service_session_snapshot(
    snapshot: Value,
) -> QueryDomainResult<QueryServiceSessionSnapshot> {
    let encoded = serde_json::to_vec(&snapshot)?;
    if encoded.len() > MAX_QUERY_SERVICE_SNAPSHOT_BYTES {
        return Err(QueryDomainError::LimitExceeded(
            "the Services result exceeded the local persistence limit".into(),
        ));
    }
    let envelope: QueryServiceSessionEnvelope = serde_json::from_slice(&encoded)?;
    if envelope.schema_version != 2 {
        return Err(QueryDomainError::Invalid(
            "Services snapshot schema version is unsupported".into(),
        ));
    }
    validate_bounded_label(
        "Services session id",
        &envelope.id,
        MAX_QUERY_SERVICE_ID_BYTES,
    )?;
    validate_bounded_label(
        "Services document id",
        &envelope.document_id,
        MAX_QUERY_SERVICE_ID_BYTES,
    )?;
    for (label, value) in [
        ("connection name", envelope.connection_name.as_str()),
        ("console title", envelope.console_title.as_str()),
        ("database name", envelope.database.as_str()),
        ("namespace", envelope.namespace.as_str()),
        ("started label", envelope.started_label.as_str()),
    ] {
        validate_bounded_label(label, value, MAX_QUERY_SERVICE_LABEL_BYTES)?;
    }
    if envelope.sql.len() > MAX_QUERY_SERVICE_SNAPSHOT_BYTES {
        return Err(QueryDomainError::LimitExceeded(
            "the Services SQL text exceeded the local persistence limit".into(),
        ));
    }
    DateTime::parse_from_rfc3339(&envelope.started_at)
        .map_err(|_| QueryDomainError::Invalid("Services startedAt is invalid".into()))?;
    if envelope.updated_at <= 0 {
        return Err(QueryDomainError::Invalid(
            "Services updatedAt must be a positive millisecond timestamp".into(),
        ));
    }
    let connection_id = Uuid::parse_str(&envelope.connection_id)
        .map(ConnectionId::from)
        .map_err(|_| QueryDomainError::Invalid("Services connectionId is invalid".into()))?;
    let status = match envelope.status.as_str() {
        "completed" => QueryServiceSessionStatus::Completed,
        "failed" => QueryServiceSessionStatus::Failed,
        "cancelled" => QueryServiceSessionStatus::Cancelled,
        _ => {
            return Err(QueryDomainError::Invalid(
                "only terminal Services sessions can be persisted".into(),
            ))
        }
    };
    let result_kind = envelope
        .result
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| QueryDomainError::Invalid("Services result kind is missing".into()))?;
    let valid_result = match status {
        QueryServiceSessionStatus::Completed => {
            matches!(result_kind, "materialized" | "stream" | "script")
        }
        QueryServiceSessionStatus::Failed => result_kind == "error",
        QueryServiceSessionStatus::Cancelled => result_kind == "none",
    };
    if !valid_result {
        return Err(QueryDomainError::Invalid(
            "Services status and result kind are inconsistent".into(),
        ));
    }
    if result_kind == "stream" {
        validate_disk_backed_stream_snapshot(&envelope.result)?;
    }
    Ok(QueryServiceSessionSnapshot {
        id: envelope.id,
        connection_id,
        updated_at: envelope.updated_at,
        status,
        snapshot,
    })
}

fn validate_disk_backed_stream_snapshot(result: &Value) -> QueryDomainResult<()> {
    let stream = result
        .get("stream")
        .and_then(Value::as_object)
        .ok_or_else(|| QueryDomainError::Invalid("Services stream state is missing".into()))?;
    let source = stream
        .get("rowSource")
        .and_then(Value::as_object)
        .ok_or_else(|| QueryDomainError::Invalid("Services result handle is missing".into()))?;
    let operation_id = source
        .get("operationId")
        .and_then(Value::as_str)
        .ok_or_else(|| QueryDomainError::Invalid("Services result operation is missing".into()))?;
    Uuid::parse_str(operation_id)
        .map_err(|_| QueryDomainError::Invalid("Services result operation is invalid".into()))?;
    let capability = source
        .get("capability")
        .and_then(Value::as_str)
        .ok_or_else(|| QueryDomainError::Invalid("Services result capability is missing".into()))?;
    if capability.len() != 64 || !capability.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(QueryDomainError::Invalid(
            "Services result capability is invalid".into(),
        ));
    }
    let page_rows = source.get("pageRows").and_then(Value::as_u64);
    let row_count = source.get("rowCount").and_then(Value::as_u64);
    let stream_row_count = stream.get("rowCount").and_then(Value::as_u64);
    if page_rows != Some(256)
        || row_count != stream_row_count
        || source.get("complete").and_then(Value::as_bool) != Some(true)
        || stream.get("operationId").and_then(Value::as_str) != Some(operation_id)
        || stream.get("phase").and_then(Value::as_str) != Some("complete")
    {
        return Err(QueryDomainError::Invalid(
            "Services result handle metadata is inconsistent".into(),
        ));
    }
    Ok(())
}

fn validate_bounded_label(label: &str, value: &str, max_bytes: usize) -> QueryDomainResult<()> {
    if value.is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(QueryDomainError::Invalid(format!(
            "{label} is empty or invalid"
        )));
    }
    Ok(())
}

/// Broker-only read-plan input bound to one authenticated Terminal authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TerminalQueryPlanRequest {
    pub(crate) connection_id: ConnectionId,
    pub(crate) sql: String,
    pub(crate) database: Option<String>,
    pub(crate) max_rows: Option<u64>,
    pub(crate) authority: TerminalAuthority,
}

/// The server-owned purpose for a desktop SQL inspection.
///
/// `ReadOnlyExplain` is deliberately narrower than an operation proposal: it
/// must reject any uncertain or target-mutating shape before credentials or a
/// target pool are requested. `ImpactPreview` may return a static skipped report
/// for a dangerous shape so the proposal workflow can still apply its durable
/// approval gate without opening the target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopPreviewIntent {
    ReadOnlyExplain,
    ImpactPreview,
}

/// Atomic desktop SQL inspection input after transport decoding.
///
/// Classification, authority pinning, safety policy capture, and preview are
/// one operation so a caller cannot classify one connection revision and preview
/// another.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DesktopSqlInspectionRequest {
    pub(crate) connection_id: ConnectionId,
    pub(crate) sql: String,
    pub(crate) database: Option<String>,
    pub(crate) namespace: Option<String>,
    pub(crate) intent: DesktopPreviewIntent,
}

/// Immutable desktop SQL proposal input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DesktopSqlProposalRequest {
    pub(crate) connection_id: ConnectionId,
    pub(crate) sql: String,
    pub(crate) database: Option<String>,
    pub(crate) namespace: Option<String>,
    pub(crate) origin: Option<String>,
}

/// One bounded desktop-only page of a read result. It is intentionally not a
/// model contract: CLI, Broker, Analysis Articles, and bounded execution retain their
/// materialized bounded receipt wire.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSqlStreamBatch {
    pub(crate) operation_id: OperationId,
    pub(crate) sequence: u64,
    pub(crate) columns: Vec<String>,
    pub(crate) rows: Vec<Vec<serde_json::Value>>,
}

/// Renderer-requested format for an immutable local SQL result artifact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DesktopSqlResultExportFormat {
    Csv,
    Json,
}

/// Small progress notification. Result rows and filesystem paths never enter it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSqlResultExportProgress {
    pub(crate) export_id: uuid::Uuid,
    pub(crate) operation_id: OperationId,
    pub(crate) rows_written: usize,
    pub(crate) total_rows: usize,
}

/// Completed bounded export receipt; the native destination remains private.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSqlResultExportReceipt {
    pub(crate) export_id: uuid::Uuid,
    pub(crate) operation_id: OperationId,
    pub(crate) rows_written: usize,
}

/// Small notification sent over Tauri Channel; rows remain in the feature-owned
/// registry until the originating renderer proves its one-time capability.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSqlStreamReady {
    pub(crate) operation_id: OperationId,
    pub(crate) sequence: u64,
    pub(crate) capability: String,
}

/// A transport-only sink outcome. It is deliberately feature-owned so core query
/// use cases do not expose the application's platform error type through a port.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopSqlStreamSinkError {
    ReceiverDropped,
    AcknowledgementTimedOut,
    StreamAlreadyActive,
    StreamNotActive,
    InvalidAcknowledgement,
    BatchTooLarge,
    Cancelled,
    ResultStoreUnavailable,
    ResultReceiptMismatch,
}

impl std::fmt::Display for DesktopSqlStreamSinkError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ReceiverDropped => {
                formatter.write_str("desktop query result receiver disconnected")
            }
            Self::AcknowledgementTimedOut => {
                formatter.write_str("desktop query stream acknowledgement timed out")
            }
            Self::StreamAlreadyActive => {
                formatter.write_str("desktop query stream is already active")
            }
            Self::StreamNotActive => formatter.write_str("desktop query stream is not active"),
            Self::InvalidAcknowledgement => {
                formatter.write_str("desktop query stream acknowledgement is invalid")
            }
            Self::BatchTooLarge => {
                formatter.write_str("desktop query stream batch exceeds its safe wire limit")
            }
            Self::Cancelled => formatter.write_str("query cancelled"),
            Self::ResultStoreUnavailable => {
                formatter.write_str("desktop query result storage is unavailable")
            }
            Self::ResultReceiptMismatch => {
                formatter.write_str("desktop query result receipt did not match stored pages")
            }
        }
    }
}

/// Terminal SQL proposal input bound to an authenticated authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TerminalSqlProposalRequest {
    pub(crate) connection_id: ConnectionId,
    pub(crate) sql: String,
    pub(crate) database: Option<String>,
    pub(crate) authority: TerminalAuthority,
}

/// Trusted local adapter family frozen into an Agent plan and its audit trail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentQueryInvocationOrigin {
    Cli,
}

impl AgentQueryInvocationOrigin {
    pub(crate) const fn as_str(self) -> &'static str {
        "cli"
    }

    pub(crate) const fn plan_audit_action(self) -> &'static str {
        "cli:plan_query"
    }

    pub(crate) const fn run_audit_action(self) -> &'static str {
        "cli:run_query"
    }
}

/// Aggregate-only planning result. It deliberately excludes the full profile and
/// every credential or endpoint field.
#[derive(Debug, Clone)]
pub(crate) struct AgentQueryPlan {
    pub(crate) connection_id: ConnectionId,
    pub(crate) connection_name: String,
    pub(crate) database: String,
    pub(crate) environment: Option<String>,
    pub(crate) plan_id: OperationId,
    pub(crate) decision: String,
    pub(crate) notices: Vec<String>,
    pub(crate) suggestions: Vec<String>,
    pub(crate) estimated_rows: Option<i64>,
    pub(crate) health: HealthSnapshot,
    pub(crate) expires_at: DateTime<Utc>,
}

/// Allowlisted event data retained by an opaque prepared read capability.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AgentQueryRunEventContext {
    pub(crate) connection_id: ConnectionId,
    pub(crate) connection_name: String,
    pub(crate) database: String,
    pub(crate) plan_id: OperationId,
    pub(crate) sql: String,
}

/// A successful DB-enforced read and its durable provenance identity.
#[derive(Debug, Clone)]
pub(crate) struct AgentQueryRun {
    pub(crate) connection_id: ConnectionId,
    pub(crate) connection_name: String,
    pub(crate) database: String,
    pub(crate) plan_id: OperationId,
    pub(crate) planning_decision: String,
    pub(crate) query_run_id: QueryRunId,
    pub(crate) result: QueryResult,
}

/// Produces conservative user guidance from already-safe aggregate observations.
pub(crate) fn planning_guidance(
    profile: &ConnectionProfile,
    health: &HealthSnapshot,
    estimated_rows: Option<i64>,
    estimate_limit: i64,
) -> (String, Vec<String>, Vec<String>) {
    let mut caution = false;
    let mut notices = Vec::new();
    let mut suggestions = Vec::new();
    if profile.env.as_deref() == Some("prod") {
        caution = true;
        notices.push("This connection is labeled production.".into());
        suggestions
            .push("Prefer a read replica or a bounded time range for production analysis.".into());
    }
    if health.level != "normal" {
        caution = true;
    }
    notices.extend(health.reasons.clone());
    if health.coverage == "limited" {
        caution = true;
        suggestions.push(
            "Enable PostgreSQL pg_monitor in DopeDB settings for fuller aggregate load checks."
                .into(),
        );
    }
    match estimated_rows {
        Some(rows) if rows > estimate_limit.max(0) => {
            caution = true;
            notices.push(format!("EXPLAIN estimates {rows} result/plan rows, above the configured {estimate_limit} review threshold."));
            suggestions.push("Add a selective time/filter condition or aggregate before joining large log tables.".into());
        }
        None if profile.env.as_deref() == Some("prod") => {
            caution = true;
            notices.push(
                "EXPLAIN did not provide a usable row estimate for this production query.".into(),
            );
            suggestions.push("Review the plan and narrow the query before execution.".into());
        }
        _ => {}
    }
    if health.level == "busy" {
        suggestions.push("Wait for database pressure to fall before running this query.".into());
    }
    suggestions.sort();
    suggestions.dedup();
    (
        if caution { "caution" } else { "ready" }.into(),
        notices,
        suggestions,
    )
}
