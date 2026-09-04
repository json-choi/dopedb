//! Shared desktop SQL policy, preview, and read-streaming support.

use std::time::Instant;

use crate::connection::{ConnectionAccess, DbPool};
use crate::error::AppError;
use crate::executor;
use crate::features::queries::ManualExecutionTarget;
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::OperationId;
use crate::model::{Classification, PreviewMode, PreviewReport, QueryKind, SafetySettings};
use crate::operations::{
    capture_policy, ensure_operation_scope, OperationKind, OperationRiskLevel,
};
use crate::safety;
use crate::safety::PoolRef;

#[cfg(feature = "packaged-benchmark")]
use super::desktop_contracts::DesktopSqlStreamBenchmarkStages;
use super::desktop_contracts::{
    DesktopSqlExecutionFailure, DesktopSqlRunBlocked, DesktopSqlRunError, DesktopSqlStreamReceipt,
    StoredDesktopSqlPayload, DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION,
};
use super::desktop_provenance::{record_desktop_run, DesktopRunRecord};
use super::desktop_trace::{
    BACKEND_COMPLETE as TRACE_BACKEND_COMPLETE,
    BACKEND_EXECUTE_START as TRACE_BACKEND_EXECUTE_START,
    CHANNEL_ACK_WAIT as TRACE_CHANNEL_ACK_WAIT, FIRST_BATCH as TRACE_FIRST_BATCH,
    OPERATION_CLAIM as TRACE_OPERATION_CLAIM,
    OPERATION_FINALIZE_COMPLETE as TRACE_OPERATION_FINALIZE_COMPLETE,
    OPERATION_FINALIZE_START as TRACE_OPERATION_FINALIZE_START,
    POOL_CONNECT_READY as TRACE_POOL_CONNECT_READY, POOL_CONNECT_START as TRACE_POOL_CONNECT_START,
    PROVENANCE_COMPLETE as TRACE_PROVENANCE_COMPLETE,
    SERIALIZE_CHANNEL_SEND as TRACE_SERIALIZE_CHANNEL_SEND,
};
use super::platform::QueryPlatformAdapter;
use crate::features::queries::domain::{
    DesktopSqlStreamBatch, DesktopSqlStreamReady, DesktopSqlStreamSinkError,
};

pub(super) fn operation_kind(kind: QueryKind) -> OperationKind {
    match kind {
        QueryKind::Read => OperationKind::ReadQuery,
        QueryKind::Write => OperationKind::WriteSql,
        QueryKind::Ddl => OperationKind::Ddl,
        QueryKind::Privilege => OperationKind::Privilege,
    }
}

pub(super) fn operation_risk(classification: &Classification) -> OperationRiskLevel {
    if classification.no_where && !matches!(classification.kind, QueryKind::Read) {
        return OperationRiskLevel::Critical;
    }
    match classification.risk {
        crate::model::RiskLevel::Low => OperationRiskLevel::Low,
        crate::model::RiskLevel::Medium => OperationRiskLevel::Medium,
        crate::model::RiskLevel::High => OperationRiskLevel::High,
    }
}

pub(super) fn desktop_preview_connection_access(
    _classification: &Classification,
    _settings: &SafetySettings,
) -> ConnectionAccess {
    ConnectionAccess::Read
}

pub(super) fn skipped_preview_report(note: &str) -> PreviewReport {
    PreviewReport {
        mode: PreviewMode::Skipped,
        estimated_rows: None,
        plan: None,
        note: Some(note.into()),
    }
}

pub(super) fn pool_ref(db: &DbPool) -> PoolRef<'_> {
    match db {
        DbPool::Postgres(pool) => PoolRef::Postgres(pool),
        DbPool::Mysql(pool) => PoolRef::Mysql(pool),
        DbPool::Sqlite(pool) => PoolRef::Sqlite(pool),
        DbPool::Bigquery(connection) => PoolRef::Bigquery(connection),
    }
}

const DESKTOP_STREAM_BATCH_ROWS: usize = 256;

impl QueryPlatformAdapter {
    /// Streams an immutable, already-planned desktop read without retaining all
    /// rows. The durable claim, scope pin, authority snapshot and provenance
    /// ordering are intentionally the same as the materialized read path.
    pub(crate) async fn run_desktop_sql_stream<F>(
        &self,
        operation_id: OperationId,
        owner_webview: String,
        capability: String,
        mut emit: F,
    ) -> Result<DesktopSqlStreamReceipt, DesktopSqlRunError>
    where
        F: FnMut(DesktopSqlStreamReady) -> Result<(), DesktopSqlStreamSinkError> + Send,
    {
        let operation_started = Instant::now();
        let planned = self
            .operation
            .get(operation_id.into())
            .await
            .map_err(DesktopSqlRunError::Application)?;
        if planned.payload_schema_version != DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION
            || planned.kind != OperationKind::ReadQuery
        {
            return Err(DesktopSqlRunError::Application(AppError::Blocked {
                reason: "only a planned desktop read can stream results".into(),
            }));
        }
        let payload: StoredDesktopSqlPayload = serde_json::from_value(planned.payload.clone())
            .map_err(AppError::from)
            .map_err(DesktopSqlRunError::Application)?;
        let scope = self.connections.begin_operation_scope().await;
        let pin = scope
            .pin_connection(planned.connection_id)
            .await
            .map_err(DesktopSqlRunError::Application)?;
        ensure_operation_scope(&planned, &pin).map_err(DesktopSqlRunError::Application)?;
        let namespace = crate::executor::namespace::resolve_sql_namespace(
            &pin.profile,
            Some(&payload.database),
            payload.namespace.clone(),
        )
        .map_err(DesktopSqlRunError::Application)?;
        let settings = self
            .store
            .get_safety(pin.connection_id)
            .await
            .map_err(DesktopSqlRunError::Application)?;
        let policy = capture_policy(&pin, &settings).map_err(DesktopSqlRunError::Application)?;
        if policy.revision != planned.policy_revision {
            return Err(DesktopSqlRunError::Blocked(DesktopSqlRunBlocked {
                reason: "the connection or safety policy changed; create a new proposal".into(),
                _scope: scope,
            }));
        }
        let classification = safety::classify(&payload.sql, pin.profile.engine)
            .map_err(DesktopSqlRunError::Application)?;
        if classification.kind != QueryKind::Read
            || operation_kind(classification.kind) != planned.kind
        {
            return Err(DesktopSqlRunError::Blocked(DesktopSqlRunBlocked {
                reason: "stored SQL is not an immutable read proposal".into(),
                _scope: scope,
            }));
        }
        if !pin.profile.workspace_access.can_read() {
            return Err(DesktopSqlRunError::Blocked(DesktopSqlRunBlocked {
                reason: "your workspace role no longer grants this database access".into(),
                _scope: scope,
            }));
        }
        if let safety::GateDecision::Block { reason } = safety::decide(&settings, &classification) {
            record_desktop_run(
                &self.store,
                &pin,
                DesktopRunRecord {
                    sql: &payload.sql,
                    kind: classification.kind,
                    action: "blocked",
                    status: "blocked",
                    row_count: None,
                    duration_ms: None,
                    error: Some(reason.clone()),
                    origin: &payload.history_origin,
                },
            )
            .await;
            return Err(DesktopSqlRunError::Blocked(DesktopSqlRunBlocked {
                reason,
                _scope: scope,
            }));
        }

        let cancellation = executor::cancel::register(operation_id.into());
        self.operation
            .claim(operation_id.into())
            .await
            .map_err(DesktopSqlRunError::Application)?;
        let mut finalizer = self.desktop_stream_cleanup.arm(
            self.operation.clone(),
            self.desktop_streams.clone(),
            operation_id,
        );
        let operation_claim_ms = operation_started.elapsed().as_millis() as u64;
        tracing::debug!(
            phase = TRACE_OPERATION_CLAIM,
            duration_ms = operation_claim_ms,
            "desktop query stream phase"
        );
        if cancellation.is_cancelled() || self.desktop_streams.is_cancelled(operation_id) {
            let result = self
                .operation
                .confirm_cancelled(
                    operation_id.into(),
                    &serde_json::json!({"reason":"user_cancelled_before_target_access"}),
                )
                .await;
            finalizer.disarm().await;
            result.map_err(DesktopSqlRunError::Application)?;
            return Err(DesktopSqlRunError::Application(AppError::Safety(
                "query cancelled".into(),
            )));
        }
        let pool_connect_start_ms = operation_started.elapsed().as_millis() as u64;
        tracing::debug!(
            phase = TRACE_POOL_CONNECT_START,
            duration_ms = pool_connect_start_ms,
            "desktop query stream phase"
        );
        let lease = match scope
            .connect_to_database(
                pin.clone(),
                ConnectionAccess::Read,
                Some(payload.database.clone()),
            )
            .await
        {
            Ok(lease) => lease,
            Err(error) => {
                let result = self
                    .stream_error(operation_id, &pin, &payload, error, None)
                    .await;
                finalizer.disarm().await;
                return result;
            }
        };
        let pool_connect_ready_ms = operation_started.elapsed().as_millis() as u64;
        tracing::debug!(
            phase = TRACE_POOL_CONNECT_READY,
            duration_ms = pool_connect_ready_ms,
            "desktop query stream phase"
        );
        let live = match lease.live().sql() {
            Ok(live) => live,
            Err(error) => {
                let result = self
                    .stream_error(operation_id, &pin, &payload, error, Some(lease))
                    .await;
                finalizer.disarm().await;
                return result;
            }
        };
        let mut sequence = 0_u64;
        let mut first_batch_ms = None;
        let mut first_ipc_batch_ms = None;
        let mut stream = match self.desktop_streams.begin_reserved(
            operation_id,
            &owner_webview,
            &capability,
            Some(&pin),
        ) {
            Ok(stream) => stream,
            Err(error) => {
                let result = self
                    .stream_error(
                        operation_id,
                        &pin,
                        &payload,
                        AppError::Safety(error.to_string()),
                        Some(lease),
                    )
                    .await;
                finalizer.disarm().await;
                return result;
            }
        };
        let backend_execute_start_ms = operation_started.elapsed().as_millis() as u64;
        tracing::debug!(
            phase = TRACE_BACKEND_EXECUTE_START,
            duration_ms = backend_execute_start_ms,
            "desktop query stream phase"
        );
        let mut consume_batch = |batch: executor::read::ReadBatch| {
            if first_batch_ms.is_none() {
                first_batch_ms = Some(operation_started.elapsed().as_millis() as u64);
                tracing::debug!(
                    phase = TRACE_FIRST_BATCH,
                    duration_ms = first_batch_ms,
                    "desktop query stream phase"
                );
            }
            let batch_sequence = sequence;
            let event = DesktopSqlStreamBatch {
                operation_id,
                sequence: batch_sequence,
                columns: batch.columns,
                rows: batch.rows,
            };
            sequence = sequence.saturating_add(1);
            let send_started = Instant::now();
            let dispatched = stream
                .borrow()
                .dispatch(batch_sequence, event, &mut emit)
                .map_err(stream_sink_error);
            if dispatched.is_ok() && first_ipc_batch_ms.is_none() {
                first_ipc_batch_ms = Some(operation_started.elapsed().as_millis() as u64);
            }
            tracing::debug!(
                phase = TRACE_SERIALIZE_CHANNEL_SEND,
                duration_ms = send_started.elapsed().as_millis() as u64,
                "desktop query stream phase"
            );
            let stream = stream.borrow();
            async move {
                dispatched?;
                let ack_started = Instant::now();
                let result = stream
                    .wait_for_ack(batch_sequence)
                    .await
                    .map_err(stream_sink_error);
                tracing::debug!(
                    phase = TRACE_CHANNEL_ACK_WAIT,
                    duration_ms = ack_started.elapsed().as_millis() as u64,
                    "desktop query stream phase"
                );
                result
            }
        };
        let manual_stream = self
            .manual_transactions
            .run_read_streamed(
                ManualExecutionTarget {
                    connection_id: pin.connection_id,
                    database: &payload.database,
                    namespace: namespace.clone(),
                },
                &payload.sql,
                settings.max_rows,
                DESKTOP_STREAM_BATCH_ROWS,
                Some(&cancellation),
                &mut consume_batch,
            )
            .await;
        let manual_transaction = manual_stream.is_some();
        let streamed = match manual_stream {
            Some(result) => result,
            None => {
                executor::read::run_read_streamed_registered(
                    executor::read::StreamedReadRequest {
                        live,
                        engine: pin.profile.engine,
                        sql: &payload.sql,
                        namespace,
                        max_rows: settings.max_rows,
                        batch_rows: DESKTOP_STREAM_BATCH_ROWS,
                        cancellation: Some(&cancellation),
                    },
                    consume_batch,
                )
                .await
            }
        };
        match streamed {
            Ok(summary) => {
                let ephemeral = stream.is_ephemeral();
                if let Err(error) =
                    stream.complete(summary.row_count, summary.truncated, summary.duration_ms)
                {
                    let result = self
                        .stream_error(
                            operation_id,
                            &pin,
                            &payload,
                            AppError::Safety(error.to_string()),
                            Some(lease),
                        )
                        .await;
                    finalizer.disarm().await;
                    return result;
                }
                tracing::debug!(
                    phase = TRACE_BACKEND_COMPLETE,
                    duration_ms = summary.duration_ms,
                    first_batch_ms = ?first_batch_ms,
                    "desktop query stream phase"
                );
                if ephemeral {
                    let operation = self.operation.clone();
                    let store = self.store.clone();
                    let pin = pin.clone();
                    let payload = payload.clone();
                    let row_count = summary.row_count;
                    let duration_ms = summary.duration_ms;
                    tokio::spawn(async move {
                        let receipt = operation
                            .succeed(
                                operation_id.into(),
                                &serde_json::json!({
                                    "committed": false,
                                    "manualTransaction": manual_transaction,
                                    "durationMs": duration_ms,
                                    "rowCount": row_count,
                                }),
                            )
                            .await;
                        record_desktop_run(
                            &store,
                            &pin,
                            DesktopRunRecord {
                                sql: &payload.sql,
                                kind: QueryKind::Read,
                                action: if receipt.is_ok() { "read" } else { "error" },
                                status: if receipt.is_ok() { "ok" } else { "error" },
                                row_count: Some(row_count as i64),
                                duration_ms: Some(duration_ms as i64),
                                error: receipt.as_ref().err().map(ToString::to_string),
                                origin: &payload.history_origin,
                            },
                        )
                        .await;
                        if receipt.is_err() {
                            let _ = operation
                                .fail(
                                    operation_id.into(),
                                    &serde_json::json!({"reason":"local_receipt_failed"}),
                                )
                                .await;
                        }
                        finalizer.disarm().await;
                    });
                    return Ok(DesktopSqlStreamReceipt {
                        operation_id,
                        row_count: summary.row_count,
                        truncated: summary.truncated,
                        duration_ms: summary.duration_ms,
                        #[cfg(feature = "packaged-benchmark")]
                        benchmark_stages: DesktopSqlStreamBenchmarkStages {
                            operation_claim_ms,
                            pool_connect_start_ms,
                            pool_connect_ready_ms,
                            backend_execute_start_ms,
                            first_row_ms: summary
                                .first_row_ms
                                .map(|value| backend_execute_start_ms.saturating_add(value)),
                            first_ipc_batch_ms,
                        },
                        _lease: lease,
                    });
                }
                tracing::debug!(
                    phase = TRACE_OPERATION_FINALIZE_START,
                    duration_ms = operation_started.elapsed().as_millis() as u64,
                    "desktop query stream phase"
                );
                if let Err(error) = self
                    .operation
                    .succeed(
                        operation_id.into(),
                        &serde_json::json!({
                            "committed": false, "manualTransaction": manual_transaction,
                            "durationMs": summary.duration_ms, "rowCount": summary.row_count,
                        }),
                    )
                    .await
                {
                    let _ = self
                        .operation
                        .fail(
                            operation_id.into(),
                            &serde_json::json!({"reason":"local_receipt_failed"}),
                        )
                        .await;
                    finalizer.disarm().await;
                    return Err(DesktopSqlRunError::Execution(Box::new(
                        DesktopSqlExecutionFailure {
                            error,
                            _lease: lease,
                        },
                    )));
                }
                tracing::debug!(
                    phase = TRACE_OPERATION_FINALIZE_COMPLETE,
                    duration_ms = operation_started.elapsed().as_millis() as u64,
                    "desktop query stream phase"
                );
                record_desktop_run(
                    &self.store,
                    &pin,
                    DesktopRunRecord {
                        sql: &payload.sql,
                        kind: QueryKind::Read,
                        action: "read",
                        status: "ok",
                        row_count: Some(summary.row_count as i64),
                        duration_ms: Some(summary.duration_ms as i64),
                        error: None,
                        origin: &payload.history_origin,
                    },
                )
                .await;
                tracing::debug!(
                    phase = TRACE_PROVENANCE_COMPLETE,
                    duration_ms = operation_started.elapsed().as_millis() as u64,
                    "desktop query stream phase"
                );
                finalizer.disarm().await;
                Ok(DesktopSqlStreamReceipt {
                    operation_id,
                    row_count: summary.row_count,
                    truncated: summary.truncated,
                    duration_ms: summary.duration_ms,
                    #[cfg(feature = "packaged-benchmark")]
                    benchmark_stages: DesktopSqlStreamBenchmarkStages {
                        operation_claim_ms,
                        pool_connect_start_ms,
                        pool_connect_ready_ms,
                        backend_execute_start_ms,
                        first_row_ms: summary
                            .first_row_ms
                            .map(|value| backend_execute_start_ms.saturating_add(value)),
                        first_ipc_batch_ms,
                    },
                    _lease: lease,
                })
            }
            Err(error) => {
                stream.close();
                let result = self
                    .stream_error(operation_id, &pin, &payload, error, Some(lease))
                    .await;
                finalizer.disarm().await;
                result
            }
        }
    }

    async fn stream_error(
        &self,
        operation_id: OperationId,
        pin: &PinnedConnection,
        payload: &StoredDesktopSqlPayload,
        error: AppError,
        lease: Option<crate::connection::ConnectionLease>,
    ) -> Result<DesktopSqlStreamReceipt, DesktopSqlRunError> {
        let cancelled = matches!(&error, AppError::Safety(reason) if reason == "query cancelled");
        let _ = if cancelled {
            self.operation
                .confirm_cancelled(
                    operation_id.into(),
                    &serde_json::json!({"reason":"user_cancelled"}),
                )
                .await
        } else {
            self.operation
                .fail(
                    operation_id.into(),
                    &serde_json::json!({"reason":error.kind()}),
                )
                .await
        };
        record_desktop_run(
            &self.store,
            pin,
            DesktopRunRecord {
                sql: &payload.sql,
                kind: QueryKind::Read,
                action: "error",
                status: "error",
                row_count: None,
                duration_ms: None,
                error: Some(error.to_string()),
                origin: &payload.history_origin,
            },
        )
        .await;
        match lease {
            Some(lease) => Err(DesktopSqlRunError::Execution(Box::new(
                DesktopSqlExecutionFailure {
                    error,
                    _lease: lease,
                },
            ))),
            None => Err(DesktopSqlRunError::Application(error)),
        }
    }
}

fn stream_sink_error(error: DesktopSqlStreamSinkError) -> AppError {
    match error {
        DesktopSqlStreamSinkError::Cancelled => AppError::Safety("query cancelled".into()),
        other => AppError::Safety(other.to_string()),
    }
}
