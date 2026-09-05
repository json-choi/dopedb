//! Serializable Job Engine contracts. Plans contain opaque file capability ids,
//! never renderer-supplied paths, and are canonical-hash pinned before execution.

use dopedb_protocol::catalog::ObjectRef;
use dopedb_protocol::operation::OperationState;
use serde::{Deserialize, Serialize};

use crate::kernel::identity::{
    ConnectionId, JobArtifactId, JobFileCapabilityId, JobId, OperationId,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum JobKind {
    Import,
    Export,
}

impl JobKind {
    pub(crate) fn storage_key(self) -> &'static str {
        match self {
            Self::Import => "import",
            Self::Export => "export",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "import" => Some(Self::Import),
            "export" => Some(Self::Export),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum JobFormat {
    Csv,
    Tsv,
    Json,
    Ndjson,
    Sql,
    Xlsx,
    CsvGzip,
    JsonGzip,
    NdjsonGzip,
    SqlGzip,
}

impl JobFormat {
    pub(crate) fn storage_key(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Tsv => "tsv",
            Self::Json => "json",
            Self::Ndjson => "ndjson",
            Self::Sql => "sql",
            Self::Xlsx => "xlsx",
            Self::CsvGzip => "csv_gzip",
            Self::JsonGzip => "json_gzip",
            Self::NdjsonGzip => "ndjson_gzip",
            Self::SqlGzip => "sql_gzip",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "csv" => Some(Self::Csv),
            "tsv" => Some(Self::Tsv),
            "json" => Some(Self::Json),
            "ndjson" => Some(Self::Ndjson),
            "sql" => Some(Self::Sql),
            "xlsx" => Some(Self::Xlsx),
            "csv_gzip" => Some(Self::CsvGzip),
            "json_gzip" => Some(Self::JsonGzip),
            "ndjson_gzip" => Some(Self::NdjsonGzip),
            "sql_gzip" => Some(Self::SqlGzip),
            _ => None,
        }
    }

    pub(crate) const fn compressed(self) -> bool {
        matches!(
            self,
            Self::CsvGzip | Self::JsonGzip | Self::NdjsonGzip | Self::SqlGzip
        )
    }

    pub(crate) const fn resumable(self) -> bool {
        matches!(
            self,
            Self::Csv | Self::Tsv | Self::Json | Self::Ndjson | Self::Sql
        )
    }

    pub(crate) const fn base(self) -> Self {
        match self {
            Self::CsvGzip => Self::Csv,
            Self::JsonGzip => Self::Json,
            Self::NdjsonGzip => Self::Ndjson,
            Self::SqlGzip => Self::Sql,
            value => value,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum JobState {
    Queued,
    Running,
    PauseRequested,
    Paused,
    CancelRequested,
    Cancelled,
    Succeeded,
    Failed,
}

impl JobState {
    pub(crate) fn storage_key(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::PauseRequested => "pause_requested",
            Self::Paused => "paused",
            Self::CancelRequested => "cancel_requested",
            Self::Cancelled => "cancelled",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "pause_requested" => Some(Self::PauseRequested),
            "paused" => Some(Self::Paused),
            "cancel_requested" => Some(Self::CancelRequested),
            "cancelled" => Some(Self::Cancelled),
            "succeeded" => Some(Self::Succeeded),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }

    pub(crate) const fn terminal(self) -> bool {
        matches!(self, Self::Cancelled | Self::Succeeded | Self::Failed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum JobFileDirection {
    Input,
    Output,
}

impl JobFileDirection {
    pub(crate) fn storage_key(self) -> &'static str {
        match self {
            Self::Input => "input",
            Self::Output => "output",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobFileCapability {
    pub(crate) id: JobFileCapabilityId,
    pub(crate) connection_id: ConnectionId,
    pub(crate) direction: JobFileDirection,
    pub(crate) display_name: String,
    pub(crate) size_bytes: Option<u64>,
    pub(crate) modified_at: Option<String>,
    pub(crate) source_sha256: Option<String>,
    pub(crate) expires_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobInputInspection {
    pub(crate) fields: Vec<String>,
    pub(crate) item_count: Option<u64>,
    pub(crate) sample_rows: Vec<serde_json::Value>,
    pub(crate) resumable: bool,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JobFieldMapping {
    pub(crate) source: String,
    pub(crate) target: String,
    pub(crate) required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum JobErrorPolicy {
    Stop,
    Continue,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum JobConsistency {
    #[default]
    PerBatchCurrent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JobValidation {
    pub(crate) on_error: JobErrorPolicy,
    pub(crate) max_errors: u64,
    pub(crate) null_values: Vec<String>,
}

impl Default for JobValidation {
    fn default() -> Self {
        Self {
            on_error: JobErrorPolicy::Stop,
            max_errors: 1_000,
            null_values: vec!["".into(), "NULL".into(), "null".into()],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum JobPlan {
    Export {
        capability_id: JobFileCapabilityId,
        relation: ObjectRef,
        consistency: JobConsistency,
        columns: Vec<String>,
        field_names: Vec<JobFieldMapping>,
        batch_size: u32,
    },
    Import {
        capability_id: JobFileCapabilityId,
        target_relation: Option<ObjectRef>,
        mapping: Vec<JobFieldMapping>,
        validation: JobValidation,
        batch_size: u32,
    },
}

impl JobPlan {
    pub(crate) const fn kind(&self) -> JobKind {
        match self {
            Self::Export { .. } => JobKind::Export,
            Self::Import { .. } => JobKind::Import,
        }
    }

    pub(crate) const fn capability_id(&self) -> JobFileCapabilityId {
        match self {
            Self::Export { capability_id, .. } | Self::Import { capability_id, .. } => {
                *capability_id
            }
        }
    }

    pub(crate) const fn batch_size(&self) -> u32 {
        match self {
            Self::Export { batch_size, .. } | Self::Import { batch_size, .. } => *batch_size,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateJobRequest {
    pub(crate) connection_id: ConnectionId,
    pub(crate) format: JobFormat,
    pub(crate) plan: JobPlan,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Job {
    pub(crate) id: JobId,
    pub(crate) operation_id: OperationId,
    pub(crate) connection_id: ConnectionId,
    pub(crate) kind: JobKind,
    pub(crate) format: JobFormat,
    pub(crate) state: JobState,
    pub(crate) source_summary: String,
    pub(crate) target_summary: String,
    pub(crate) rows_processed: u64,
    pub(crate) bytes_processed: u64,
    pub(crate) rows_total: Option<u64>,
    pub(crate) bytes_total: Option<u64>,
    pub(crate) resumable: bool,
    pub(crate) error_code: Option<String>,
    pub(crate) redacted_error: Option<String>,
    pub(crate) created_at: String,
    pub(crate) started_at: Option<String>,
    pub(crate) finished_at: Option<String>,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobProposal {
    pub(crate) job: Job,
    pub(crate) payload_hash: String,
    pub(crate) approval_required: bool,
    pub(crate) confirmation_phrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobArtifact {
    pub(crate) id: JobArtifactId,
    pub(crate) job_id: JobId,
    pub(crate) artifact_type: String,
    pub(crate) display_name: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
    pub(crate) created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobDetail {
    pub(crate) job: Job,
    pub(crate) artifacts: Vec<JobArtifact>,
    pub(crate) operation_state: OperationState,
    pub(crate) payload_hash: String,
    pub(crate) approval_required: bool,
    pub(crate) confirmation_phrase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobChangedEvent {
    pub(crate) connection_id: ConnectionId,
    pub(crate) job_id: JobId,
    pub(crate) kind: JobKind,
    pub(crate) state: JobState,
    pub(crate) rows_processed: u64,
    pub(crate) bytes_processed: u64,
}
