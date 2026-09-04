//! Desktop SQL adapter contracts, lease-backed receipts, and error projections.

use crate::connection::{ConnectionLease, ConnectionOperationScope};
use crate::error::AppError;
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::{ConnectionId, OperationId};
use crate::model::{Classification, ExecOutcome, PreviewReport};
use crate::operations::{OperationRiskLevel, OperationState};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fmt;

pub(crate) const DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION: u32 = 3;

/// Exact immutable proposal rendered by the desktop before approval or execution.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSqlProposalReceipt {
    pub(crate) operation_id: OperationId,
    pub(crate) payload_hash: String,
    pub(crate) state: OperationState,
    pub(crate) approval_required: bool,
    pub(crate) auto_run: bool,
    pub(crate) confirmation_phrase: Option<String>,
    pub(crate) expires_at: chrono::DateTime<Utc>,
    pub(crate) classification: Classification,
    pub(crate) preview: PreviewReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredDesktopSqlPayload {
    pub(crate) sql: String,
    pub(crate) history_origin: String,
    pub(crate) database: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) namespace: Option<String>,
}

/// Trusted Desktop projection of the immutable SQL bytes behind an Agent proposal.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSqlApprovalReview {
    pub(crate) operation_id: OperationId,
    pub(crate) connection_id: ConnectionId,
    pub(crate) payload_hash: String,
    pub(crate) state: OperationState,
    pub(crate) risk_level: OperationRiskLevel,
    pub(crate) sql: String,
    pub(crate) database: String,
    pub(crate) namespace: Option<String>,
    pub(crate) affected: Option<u64>,
    pub(crate) expires_at: Option<chrono::DateTime<Utc>>,
}

/// Authority retained by an impact preview. Pre-connection skipped reports keep
/// the operation scope itself; reports that touched the database keep the exact
/// connection lease used to produce them.
pub(crate) enum DesktopSqlPreviewAuthority {
    Scope {
        _scope: Box<ConnectionOperationScope>,
    },
    Lease {
        _lease: Box<ConnectionLease>,
    },
}

/// Atomic desktop inspection response. The private policy snapshot is the exact
/// policy later persisted in a proposal; the serialized wire only exposes the
/// classification and preview data needed by the desktop.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSqlInspectionReceipt {
    pub(super) classification: Classification,
    pub(super) report: PreviewReport,
    #[serde(skip)]
    pub(super) database: String,
    #[serde(skip)]
    pub(super) namespace: Option<String>,
    #[serde(skip)]
    pub(super) pin: PinnedConnection,
    #[serde(skip)]
    pub(super) policy_snapshot: serde_json::Value,
    #[serde(skip)]
    pub(super) policy_revision: String,
    #[serde(skip)]
    pub(super) _authority: DesktopSqlPreviewAuthority,
}

impl DesktopSqlInspectionReceipt {
    /// Preserve the inspection scope or lease until the transport has projected
    /// a subsequent proposal error to the established AppError wire shape.
    pub(super) fn into_error(self, error: AppError) -> DesktopSqlInspectionError {
        DesktopSqlInspectionError::Scoped {
            error,
            _authority: self._authority,
        }
    }
}

/// Successful desktop execution retaining the exact connection lease until Tauri
/// has serialized the current [`ExecOutcome`] response.
pub(crate) struct DesktopSqlRunReceipt {
    pub(super) outcome: ExecOutcome,
    pub(super) _lease: ConnectionLease,
}

/// Final metadata for a desktop channel stream. Rows are deliberately emitted
/// only through bounded batches and are never retained in this receipt.
pub(crate) struct DesktopSqlStreamReceipt {
    pub(super) operation_id: OperationId,
    pub(super) row_count: usize,
    pub(super) truncated: bool,
    pub(super) duration_ms: u64,
    #[cfg(feature = "packaged-benchmark")]
    pub(super) benchmark_stages: DesktopSqlStreamBenchmarkStages,
    pub(super) _lease: ConnectionLease,
}

/// Closed numeric stage offsets emitted only by the isolated packaged benchmark
/// build. Ordinary Desktop builds do not expose these diagnostics on the wire.
#[cfg(feature = "packaged-benchmark")]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopSqlStreamBenchmarkStages {
    pub(super) operation_claim_ms: u64,
    pub(super) pool_connect_start_ms: u64,
    pub(super) pool_connect_ready_ms: u64,
    pub(super) backend_execute_start_ms: u64,
    pub(super) first_row_ms: Option<u64>,
    pub(super) first_ipc_batch_ms: Option<u64>,
}

#[cfg(feature = "packaged-benchmark")]
impl DesktopSqlStreamReceipt {
    pub(crate) fn offset_benchmark_stages(&mut self, offset_ms: u64) {
        let stages = &mut self.benchmark_stages;
        stages.operation_claim_ms = stages.operation_claim_ms.saturating_add(offset_ms);
        stages.pool_connect_start_ms = stages.pool_connect_start_ms.saturating_add(offset_ms);
        stages.pool_connect_ready_ms = stages.pool_connect_ready_ms.saturating_add(offset_ms);
        stages.backend_execute_start_ms = stages.backend_execute_start_ms.saturating_add(offset_ms);
        stages.first_row_ms = stages
            .first_row_ms
            .map(|value| value.saturating_add(offset_ms));
        stages.first_ipc_batch_ms = stages
            .first_ipc_batch_ms
            .map(|value| value.saturating_add(offset_ms));
    }
}

impl serde::Serialize for DesktopSqlStreamReceipt {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Wire {
            operation_id: OperationId,
            row_count: usize,
            truncated: bool,
            duration_ms: u64,
            #[cfg(feature = "packaged-benchmark")]
            benchmark_stages: DesktopSqlStreamBenchmarkStages,
        }
        Wire {
            operation_id: self.operation_id,
            row_count: self.row_count,
            truncated: self.truncated,
            duration_ms: self.duration_ms,
            #[cfg(feature = "packaged-benchmark")]
            benchmark_stages: self.benchmark_stages,
        }
        .serialize(serializer)
    }
}

impl serde::Serialize for DesktopSqlRunReceipt {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serde::Serialize::serialize(&self.outcome, serializer)
    }
}

/// Desktop execution failures preserve the existing structured `AppError` wire
/// while retaining authority for blocked and post-connect failures until the thin
/// adapter maps the error.
#[derive(Debug)]
pub(crate) enum DesktopSqlRunError {
    Blocked(DesktopSqlRunBlocked),
    Application(AppError),
    Execution(Box<DesktopSqlExecutionFailure>),
}

impl DesktopSqlRunError {
    pub(crate) fn into_error(self) -> AppError {
        match self {
            Self::Blocked(blocked) => blocked.into_error(),
            Self::Application(error) => error,
            Self::Execution(failure) => failure.into_error(),
        }
    }
}

/// A policy rejection that holds the operation scope through adapter error
/// mapping, preventing a concurrent workspace switch from relabeling the result.
pub(crate) struct DesktopSqlRunBlocked {
    pub(super) reason: String,
    pub(super) _scope: ConnectionOperationScope,
}

impl fmt::Debug for DesktopSqlRunBlocked {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DesktopSqlRunBlocked")
            .field("reason", &self.reason)
            .finish_non_exhaustive()
    }
}

impl DesktopSqlRunBlocked {
    pub(super) fn into_error(self) -> AppError {
        AppError::Blocked {
            reason: self.reason,
        }
    }
}

/// A post-connect failure retaining the live lease until adapter error mapping.
pub(crate) struct DesktopSqlExecutionFailure {
    pub(super) error: AppError,
    pub(super) _lease: ConnectionLease,
}

impl fmt::Debug for DesktopSqlExecutionFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DesktopSqlExecutionFailure")
            .field("error", &self.error)
            .finish_non_exhaustive()
    }
}

impl DesktopSqlExecutionFailure {
    pub(super) fn into_error(self) -> AppError {
        self.error
    }
}

/// Desktop classification/preview failures retain the structured `AppError`
/// contract currently returned by Tauri.
pub(crate) enum DesktopSqlInspectionError {
    Application(AppError),
    Scoped {
        error: AppError,
        _authority: DesktopSqlPreviewAuthority,
    },
}

impl fmt::Debug for DesktopSqlInspectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Application(error) => formatter.debug_tuple("Application").field(error).finish(),
            Self::Scoped { error, .. } => formatter.debug_tuple("Scoped").field(error).finish(),
        }
    }
}

impl DesktopSqlInspectionError {
    pub(crate) fn into_error(self) -> AppError {
        match self {
            Self::Application(error) | Self::Scoped { error, .. } => error,
        }
    }
}
