//! Shared serde types — the data contract between the Rust core and the React
//! frontend. All types serialize `camelCase`. Keep this file authoritative:
//! module agents conform to these shapes rather than redefining them.
//!
use std::collections::HashMap;

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Supported target database engines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Engine {
    Postgres,
    Mysql,
    Sqlite,
    Mongodb,
    Bigquery,
}

impl Engine {
    /// Document-family engines: no SQL surface, queried through the typed
    /// document API. THE single place a future document engine gets added —
    /// every SQL-vs-document branch asks this instead of matching variants.
    pub fn is_document(self) -> bool {
        matches!(self, Engine::Mongodb)
    }
}

/// Hosting/control-plane provider. `Auto` preserves connection-URL convenience while
/// keeping provider-specific behavior separate from the database wire protocol.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    #[default]
    Auto,
    Generic,
    Neon,
    PlanetScale,
    GcpCloudSql,
}

/// Cached server authority for a shared connection. Personal connections are Local;
/// team modes are narrowing permissions and never elevate the target DB credential.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceConnectionAccess {
    View,
    Read,
    Write,
    Manage,
    #[default]
    Local,
}

impl WorkspaceConnectionAccess {
    pub fn can_read(self) -> bool {
        matches!(self, Self::Read | Self::Write | Self::Manage | Self::Local)
    }

    pub fn can_write(self) -> bool {
        matches!(self, Self::Write | Self::Manage | Self::Local)
    }

    pub fn can_manage(self) -> bool {
        matches!(self, Self::Manage | Self::Local)
    }
}

/// Credential source for a connection. Managed secrets are leased into process memory
/// only; member-local and personal secrets may reference the OS credential store.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceCredentialMode {
    #[default]
    Local,
    MemberLocal,
    Managed,
}

/// Redacted provider identity pinned to a managed connection. Provider credentials,
/// connection URIs, and database passwords are deliberately not representable here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NeonBranchState {
    Init,
    Resetting,
    Ready,
    Archived,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "provider",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ConnectionProviderTarget {
    #[serde(rename = "neon")]
    Neon {
        project_id: String,
        branch_id: String,
        branch_name: Option<String>,
        current_state: Option<NeonBranchState>,
        pending_state: Option<NeonBranchState>,
        default: Option<bool>,
        protected: Option<bool>,
    },
}

/// A saved connection. Plaintext secrets never live here. `secretRef` points at an OS
/// credential item; managed profiles instead obtain a short-lived in-memory lease.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: Uuid,
    pub name: String,
    pub engine: Engine,
    /// Provider overlay selected by the user; `Auto` resolves from the endpoint.
    #[serde(default)]
    pub provider: Provider,
    /// Explicit driver selection. `None` asks the registry for its best compatible driver.
    #[serde(default)]
    pub driver_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub sslmode: String,
    #[serde(default)]
    pub extra_params: HashMap<String, String>,
    /// Open connections read-only by default.
    pub readonly_default: bool,
    /// Master per-connection gate for the write path (default false).
    pub allow_writes: bool,
    /// Credential-store item id for the secret, if one has been stored.
    pub secret_ref: Option<String>,
    /// Environment label ("dev" | "staging" | "prod") — drives the sidebar/header chip.
    #[serde(default)]
    pub env: Option<String>,
    /// Shared schema family. Connections with the same value are compared as
    /// dev/staging/prod siblings, using prod as the default baseline when present.
    #[serde(default)]
    pub schema_group: Option<String>,
    /// Local cache of the authenticated workspace member's effective permission.
    #[serde(default)]
    pub workspace_access: WorkspaceConnectionAccess,
    /// Personal, member-local OS credential, or server-brokered in-memory lease.
    #[serde(default)]
    pub credential_mode: WorkspaceCredentialMode,
    /// Provider-owned target identity cached from the authenticated workspace.
    /// Local connections never populate this field.
    #[serde(default)]
    pub provider_target: Option<ConnectionProviderTarget>,
}

/// Per-connection safety configuration (mirrors `connection_safety` in app.db).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetySettings {
    /// Legacy persisted compatibility field. Exact Operation approval is always
    /// required for target mutations regardless of this value.
    pub require_approval: bool,
    pub allow_writes: bool,
    /// Device-local opt-in for DDL. This can only narrow a local owner credential
    /// or a workspace-managed schema lease authorized by an exact manage grant.
    #[serde(default)]
    pub allow_schema_changes: bool,
    pub wrap_writes_in_tx: bool,
    pub explain_preview: bool,
    pub auto_run_reads: bool,
    /// Row cap applied to read result sets.
    pub max_rows: u64,
    /// L3 review threshold. EXPLAIN estimates above this value receive an
    /// extra-review note; the value neither skips preview nor approves execution.
    pub exec_preview_row_limit: i64,
}

/// Monitoring capability exposed by one saved connection. PostgreSQL can opt in to
/// the built-in `pg_monitor` role; other engines keep a basic, role-free collector.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringStatus {
    pub engine: Engine,
    /// "full" when pg_monitor is granted, "limited" without it, "basic" for
    /// engines that do not use PostgreSQL's predefined monitoring roles.
    pub coverage: String,
    pub role_available: bool,
    pub role_granted: bool,
    pub current_user: Option<String>,
    /// Best-effort hint only. The server remains authoritative when GRANT/REVOKE runs.
    pub can_manage: bool,
    pub note: String,
}

impl Default for SafetySettings {
    fn default() -> Self {
        SafetySettings {
            require_approval: true,
            allow_writes: false,
            allow_schema_changes: false,
            wrap_writes_in_tx: true,
            explain_preview: true,
            auto_run_reads: true,
            max_rows: 1000,
            exec_preview_row_limit: 50_000,
        }
    }
}

/// Statement class from L1 parse/classify.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueryKind {
    Read,
    Write,
    Ddl,
    Privilege,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

/// Result of L1 classification. A UX pre-filter — L2 is the authoritative boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Classification {
    pub kind: QueryKind,
    pub risk: RiskLevel,
    /// Number of top-level statements parsed. `> 1` is rejected.
    pub statement_count: u32,
    /// UPDATE/DELETE without a WHERE clause (high-risk flag).
    pub no_where: bool,
    pub tables: Vec<String>,
    pub notes: Vec<String>,
    /// True only for one cleanly parsed top-level INSERT/UPDATE/DELETE. This
    /// remains classification metadata for consumers that require rollback-safe
    /// DML; the current L3 preview path is EXPLAIN-only and never executes it.
    #[serde(default)]
    pub rollback_safe: bool,
}

/// How an impact preview was produced (L3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewMode {
    /// Read path: EXPLAIN plan only, never executed.
    Explain,
    /// Legacy wire value retained for older preview reports. The current preview
    /// path never executes a mutation before approval.
    ExecRollback,
    /// No plan was requested for this statement or because preview is disabled.
    Skipped,
}

/// L3 impact preview shown on the approval card.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewReport {
    pub mode: PreviewMode,
    /// EXPLAIN-derived row estimate.
    pub estimated_rows: Option<i64>,
    /// Legacy exact-row field retained for older preview reports.
    pub exact_rows: Option<i64>,
    /// Raw/formatted plan text, if captured.
    pub plan: Option<String>,
    /// Human note describing the preview result or why no plan was requested.
    pub note: Option<String>,
}

/// A materialized result set (or a page of one).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    /// True if the result was cut off at the row cap.
    pub truncated: bool,
    pub duration_ms: u64,
}

/// One typed, read-only MongoDB request — the ONLY way document operations run.
/// There is deliberately no raw-command variant: reads are constructed from these
/// shapes plus a pipeline-stage allowlist, never classified from strings.
/// `filter`/`pipeline`/… accept MongoDB Extended JSON.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", tag = "op")]
pub enum DocumentQuery {
    /// `db.collection.find(filter)` with optional projection/sort/skip/limit.
    Find {
        collection: String,
        #[serde(default)]
        filter: Option<serde_json::Value>,
        #[serde(default)]
        projection: Option<serde_json::Value>,
        #[serde(default)]
        sort: Option<serde_json::Value>,
        #[serde(default)]
        skip: Option<u64>,
        #[serde(default)]
        limit: Option<u64>,
    },
    /// `db.collection.aggregate(pipeline)` — stages pass a read-only allowlist.
    Aggregate {
        collection: String,
        pipeline: Vec<serde_json::Value>,
    },
    /// `db.collection.countDocuments(filter)`.
    Count {
        collection: String,
        #[serde(default)]
        filter: Option<serde_json::Value>,
    },
}

/// A page of documents from one [`DocumentQuery`] run. Each element is one BSON
/// document rendered as relaxed Extended JSON (ObjectId/Date/Decimal128/Int64/
/// Binary keep their meaning — never cast to lossy plain numbers).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPage {
    pub documents: Vec<serde_json::Value>,
    pub doc_count: usize,
    /// True if the result was cut off at the row cap.
    pub truncated: bool,
    pub duration_ms: u64,
}

/// Outcome of a `run_sql` call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutcome {
    pub result: Option<QueryResult>,
    pub affected: Option<u64>,
    /// True only when a write actually committed.
    pub committed: bool,
    /// True when this result remains inside the connection's open manual transaction.
    #[serde(default)]
    pub manual_transaction: bool,
}

/// One statement's outcome inside a `run_script` run. Exactly one of `result`/
/// `affected`/`error` is meaningful: a read carries `result`, a write carries
/// `affected`, a failed or skipped statement carries `error`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStatement {
    pub sql: String,
    pub result: Option<QueryResult>,
    pub affected: Option<i64>,
    pub error: Option<String>,
}

/// Outcome of a `run_script` call. `committed` is true only for a write script whose
/// single transaction committed; `all_reads` picks the read-only sequential path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptOutcome {
    pub statements: Vec<ScriptStatement>,
    pub committed: bool,
    pub all_reads: bool,
    /// True when successful mutations remain staged until an explicit commit.
    #[serde(default)]
    pub manual_transaction: bool,
}

/// One append-only, hash-chained audit record (compliance log).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub ts: DateTime<Utc>,
    pub engine: Engine,
    pub agent_prompt: Option<String>,
    pub sql: String,
    pub kind: QueryKind,
    /// e.g. "propose" | "approve" | "reject" | "execute" | "blocked".
    pub action: String,
    pub approved_by: Option<String>,
    pub affected_estimate: Option<i64>,
    pub error: Option<String>,
    pub prev_hash: Option<String>,
    /// SHA256(prev_hash ‖ canonical_row) — tamper-evidence chain link.
    pub hash: String,
}

/// One `query_history` row (UX/replay log, kept separate from the audit log).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub sql: String,
    pub kind: QueryKind,
    /// "ok" | "error" | "blocked".
    pub status: String,
    pub row_count: Option<i64>,
    pub duration_ms: Option<i64>,
    pub error: Option<String>,
    pub executed_at: DateTime<Utc>,
    /// "agent" | "manual" | "analysis_article" | "migration" | surface id.
    pub origin: String,
}

/// Stable newest-first cursor for one scoped query-history page. The SQLite row id
/// only disambiguates executions that share the same timestamp and is never used as
/// an authority boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCursor {
    pub executed_at: DateTime<Utc>,
    pub row_id: i64,
}

/// Bounded query-history metadata. Full SQL and error bodies are fetched only when
/// the user selects this execution for replay.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntrySummary {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub sql_preview: String,
    pub sql_truncated: bool,
    pub kind: QueryKind,
    pub status: String,
    pub row_count: Option<i64>,
    pub duration_ms: Option<i64>,
    pub error_preview: Option<String>,
    pub error_truncated: bool,
    pub executed_at: DateTime<Utc>,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub items: Vec<HistoryEntrySummary>,
    pub next_cursor: Option<HistoryCursor>,
    pub statuses: Vec<String>,
    pub origins: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditCursor {
    pub row_id: i64,
}

/// One bounded audit-list row. Full prompt, SQL, and error bodies remain behind an
/// exact connection/id detail read so a single page has a deterministic byte ceiling.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntrySummary {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub ts: DateTime<Utc>,
    pub engine: Engine,
    pub agent_prompt_preview: Option<String>,
    pub agent_prompt_truncated: bool,
    pub sql_preview: String,
    pub sql_truncated: bool,
    pub kind: QueryKind,
    pub action: String,
    pub approved_by: Option<String>,
    pub affected_estimate: Option<i64>,
    pub error_preview: Option<String>,
    pub error_truncated: bool,
    pub prev_hash: Option<String>,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    pub items: Vec<AuditEntrySummary>,
    pub next_cursor: Option<AuditCursor>,
}
