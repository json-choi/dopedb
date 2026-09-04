//! Desktop SQL execution, cancellation, audit, history, and outcome reconciliation.

use crate::audit::{self, RecordArgs};
use crate::connection::ConnectionAccess;
use crate::error::AppError;
use crate::executor;
use crate::features::queries::ManualExecutionTarget;
use crate::kernel::identity::OperationId;
use crate::model::QueryKind;
use crate::operations::{capture_policy, ensure_operation_scope, OperationKind};
use crate::safety;

use super::desktop_contracts::{
    DesktopSqlExecutionFailure, DesktopSqlRunBlocked, DesktopSqlRunError, DesktopSqlRunReceipt,
    StoredDesktopSqlPayload, DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION,
};
use super::desktop_provenance::{record_desktop_run, DesktopRunRecord};
use super::desktop_support::operation_kind;
use super::platform::QueryPlatformAdapter;

impl QueryPlatformAdapter {
    /// and approval are reloaded from the durable record before an opaque grant is
    /// issued; no transport can resend or alter them at execution time.
    pub(crate) async fn run_desktop_sql(
        &self,
        operation_id: OperationId,
    ) -> Result<DesktopSqlRunReceipt, DesktopSqlRunError> {
        let planned = self
            .operation
            .get(operation_id.into())
            .await
            .map_err(DesktopSqlRunError::Application)?;
        if planned.payload_schema_version != DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION
            || !matches!(
                planned.kind,
                OperationKind::ReadQuery
                    | OperationKind::WriteSql
                    | OperationKind::Ddl
                    | OperationKind::Privilege
            )
        {
            return Err(DesktopSqlRunError::Application(AppError::Blocked {
                reason: "operation is not a supported desktop SQL proposal".into(),
            }));
        }
        let payload: StoredDesktopSqlPayload = serde_json::from_value(planned.payload.clone())
            .map_err(AppError::from)
            .map_err(DesktopSqlRunError::Application)?;
        let operation_scope = self.connections.begin_operation_scope().await;
        let operation_pin = operation_scope
            .pin_connection(planned.connection_id)
            .await
            .map_err(DesktopSqlRunError::Application)?;
        ensure_operation_scope(&planned, &operation_pin)
            .map_err(DesktopSqlRunError::Application)?;
        let namespace = crate::executor::namespace::resolve_sql_namespace(
            &operation_pin.profile,
            Some(&payload.database),
            payload.namespace.clone(),
        )
        .map_err(DesktopSqlRunError::Application)?;
        let settings = self
            .store
            .get_safety(operation_pin.connection_id)
            .await
            .map_err(DesktopSqlRunError::Application)?;
        let policy =
            capture_policy(&operation_pin, &settings).map_err(DesktopSqlRunError::Application)?;
        if policy.revision != planned.policy_revision {
            return Err(DesktopSqlRunError::Blocked(DesktopSqlRunBlocked {
                reason: "the connection or safety policy changed; create a new proposal".into(),
                _scope: operation_scope,
            }));
        }
        let classification = safety::classify(&payload.sql, operation_pin.profile.engine)
            .map_err(DesktopSqlRunError::Application)?;
        if operation_kind(classification.kind) != planned.kind {
            return Err(DesktopSqlRunError::Blocked(DesktopSqlRunBlocked {
                reason: "stored SQL classification no longer matches its immutable proposal".into(),
                _scope: operation_scope,
            }));
        }
        let engine = operation_pin.profile.engine;
        let history_origin = payload.history_origin;
        let is_write = !matches!(classification.kind, QueryKind::Read);

        let access_allowed = match classification.kind {
            QueryKind::Read => operation_pin.profile.workspace_access.can_read(),
            QueryKind::Ddl => operation_pin.profile.workspace_access.can_manage(),
            QueryKind::Write | QueryKind::Privilege => {
                operation_pin.profile.workspace_access.can_write()
            }
        };
        if !access_allowed {
            return Err(DesktopSqlRunError::Blocked(DesktopSqlRunBlocked {
                reason: "your workspace role no longer grants this database access".into(),
                _scope: operation_scope,
            }));
        }
        if let safety::GateDecision::Block { reason } = safety::decide(&settings, &classification) {
            record_desktop_run(
                &self.store,
                &operation_pin,
                DesktopRunRecord {
                    sql: &payload.sql,
                    kind: classification.kind,
                    action: "blocked",
                    status: "blocked",
                    row_count: None,
                    duration_ms: None,
                    error: Some(reason.clone()),
                    origin: &history_origin,
                },
            )
            .await;
            return Err(DesktopSqlRunError::Blocked(DesktopSqlRunBlocked {
                reason,
                _scope: operation_scope,
            }));
        }
        let cancellation = executor::cancel::register(operation_id.into());
        let claimed = self
            .operation
            .claim(operation_id.into())
            .await
            .map_err(DesktopSqlRunError::Application)?;
        if cancellation.is_cancelled() {
            self.operation
                .confirm_cancelled(
                    operation_id.into(),
                    &serde_json::json!({"reason": "user_cancelled_before_target_access"}),
                )
                .await
                .map_err(DesktopSqlRunError::Application)?;
            return Err(DesktopSqlRunError::Application(AppError::Safety(
                "query cancelled".into(),
            )));
        }

        if is_write {
            if let Err(error) = audit::record(
                &self.store,
                RecordArgs {
                    connection_id: operation_pin.connection_id,
                    engine,
                    agent_prompt: None,
                    sql: payload.sql.clone(),
                    kind: classification.kind,
                    action: "execute:attempt".into(),
                    approved_by: Some(planned.actor.id.clone()),
                    affected_estimate: None,
                    error: None,
                },
            )
            .await
            {
                let refusal = AppError::Config(format!(
                    "audit pre-record failed — refusing to run write: {error}"
                ));
                let _ = self
                    .operation
                    .fail(
                        operation_id.into(),
                        &serde_json::json!({"reason": "audit_pre_record_failed"}),
                    )
                    .await;
                return Err(DesktopSqlRunError::Application(refusal));
            }
        }

        let lease = match operation_scope
            .connect_to_database(
                operation_pin.clone(),
                match classification.kind {
                    QueryKind::Read => ConnectionAccess::Read,
                    QueryKind::Ddl => ConnectionAccess::Schema,
                    QueryKind::Write | QueryKind::Privilege => ConnectionAccess::Write,
                },
                Some(payload.database.clone()),
            )
            .await
        {
            Ok(lease) => lease,
            Err(error) => {
                record_desktop_run(
                    &self.store,
                    &operation_pin,
                    DesktopRunRecord {
                        sql: &payload.sql,
                        kind: classification.kind,
                        action: "error",
                        status: "error",
                        row_count: None,
                        duration_ms: None,
                        error: Some(error.to_string()),
                        origin: &history_origin,
                    },
                )
                .await;
                let _ = self
                    .operation
                    .fail(
                        operation_id.into(),
                        &serde_json::json!({"reason": "connection_failed"}),
                    )
                    .await;
                return Err(DesktopSqlRunError::Application(error));
            }
        };
        let live = match lease.live().sql() {
            Ok(live) => live,
            Err(error) => {
                record_desktop_run(
                    &self.store,
                    &operation_pin,
                    DesktopRunRecord {
                        sql: &payload.sql,
                        kind: classification.kind,
                        action: "error",
                        status: "error",
                        row_count: None,
                        duration_ms: None,
                        error: Some(error.to_string()),
                        origin: &history_origin,
                    },
                )
                .await;
                let _ = self
                    .operation
                    .fail(
                        operation_id.into(),
                        &serde_json::json!({"reason": "sql_backend_unavailable"}),
                    )
                    .await;
                return Err(DesktopSqlRunError::Execution(Box::new(
                    DesktopSqlExecutionFailure {
                        error,
                        _lease: lease,
                    },
                )));
            }
        };

        let manual_execution = match classification.kind {
            QueryKind::Write => {
                self.manual_transactions
                    .run_write(
                        ManualExecutionTarget {
                            connection_id: operation_pin.connection_id,
                            database: &payload.database,
                            namespace: namespace.clone(),
                        },
                        &classification,
                        &payload.sql,
                        &settings,
                        claimed.grant(),
                        &cancellation,
                    )
                    .await
            }
            QueryKind::Read => self
                .manual_transactions
                .run_read(
                    ManualExecutionTarget {
                        connection_id: operation_pin.connection_id,
                        database: &payload.database,
                        namespace: namespace.clone(),
                    },
                    &payload.sql,
                    settings.max_rows,
                    Some(&cancellation),
                )
                .await
                .map(|result| {
                    result.map(|result| crate::model::ExecOutcome {
                        result: Some(result),
                        affected: None,
                        committed: false,
                        manual_transaction: true,
                    })
                }),
            // DDL has its own exact schema authority and must never be routed
            // through the generic manual read/write transaction pool.
            QueryKind::Ddl | QueryKind::Privilege => None,
        };
        let (manual_transaction, execution) = match manual_execution {
            Some(execution) => (true, execution),
            None => (
                false,
                executor::execute(executor::ExecutionRequest {
                    live,
                    engine,
                    classification: &classification,
                    sql: &payload.sql,
                    namespace,
                    settings: &settings,
                    grant: if is_write {
                        Some(claimed.grant())
                    } else {
                        None
                    },
                    cancellation: Some(&cancellation),
                })
                .await,
            ),
        };

        match execution {
            Ok(outcome) => {
                let row_count = outcome
                    .result
                    .as_ref()
                    .map(|result| result.row_count as i64)
                    .or_else(|| outcome.affected.map(|affected| affected as i64));
                let duration_ms = outcome
                    .result
                    .as_ref()
                    .map(|result| result.duration_ms as i64);
                if let Err(error) = self
                    .operation
                    .succeed(
                        operation_id.into(),
                        &serde_json::json!({
                            "committed": outcome.committed,
                            "manualTransaction": manual_transaction,
                            "durationMs": duration_ms,
                            "rowCount": row_count,
                        }),
                    )
                    .await
                {
                    let _ = if is_write {
                        self.operation
                            .mark_outcome_unknown(
                                operation_id.into(),
                                &serde_json::json!({"reason": "local_receipt_failed"}),
                            )
                            .await
                    } else {
                        self.operation
                            .fail(
                                operation_id.into(),
                                &serde_json::json!({"reason": "local_receipt_failed"}),
                            )
                            .await
                    };
                    return Err(DesktopSqlRunError::Execution(Box::new(
                        DesktopSqlExecutionFailure {
                            error,
                            _lease: lease,
                        },
                    )));
                }
                if matches!(classification.kind, QueryKind::Ddl) && outcome.committed {
                    let _ = self
                        .store
                        .clear_schema_cache(operation_pin.connection_id)
                        .await;
                }
                record_desktop_run(
                    &self.store,
                    &operation_pin,
                    DesktopRunRecord {
                        sql: &payload.sql,
                        kind: classification.kind,
                        action: if is_write {
                            if outcome.committed {
                                "execute"
                            } else {
                                "execute:staged"
                            }
                        } else {
                            "read"
                        },
                        status: if is_write && !outcome.committed {
                            "staged"
                        } else {
                            "ok"
                        },
                        row_count,
                        duration_ms,
                        error: None,
                        origin: &history_origin,
                    },
                )
                .await;
                Ok(DesktopSqlRunReceipt {
                    outcome,
                    _lease: lease,
                })
            }
            Err(error) => {
                let cancelled = matches!(
                    &error,
                    AppError::Safety(reason) if reason == "query cancelled"
                );
                let timed_out = matches!(
                    &error,
                    AppError::Safety(reason) if reason.starts_with("query timed out after ")
                );
                let error = if is_write
                    && !manual_transaction
                    && (cancelled || timed_out || matches!(&error, AppError::OutcomeUnknown(_)))
                {
                    match error {
                        unknown @ AppError::OutcomeUnknown(_) => unknown,
                        other => AppError::OutcomeUnknown(format!(
                            "write execution was interrupted before rollback or commit could be confirmed: {other}"
                        )),
                    }
                } else {
                    error
                };
                let _ = if matches!(&error, AppError::OutcomeUnknown(_)) {
                    self.operation
                        .mark_outcome_unknown(
                            operation_id.into(),
                            &serde_json::json!({"reason": "target_outcome_unconfirmed"}),
                        )
                        .await
                } else if cancelled {
                    self.operation
                        .confirm_cancelled(
                            operation_id.into(),
                            &serde_json::json!({"reason": "user_cancelled"}),
                        )
                        .await
                } else {
                    self.operation
                        .fail(
                            operation_id.into(),
                            &serde_json::json!({"reason": error.kind()}),
                        )
                        .await
                };
                record_desktop_run(
                    &self.store,
                    &operation_pin,
                    DesktopRunRecord {
                        sql: &payload.sql,
                        kind: classification.kind,
                        action: "error",
                        status: "error",
                        row_count: None,
                        duration_ms: None,
                        error: Some(error.to_string()),
                        origin: &history_origin,
                    },
                )
                .await;
                Err(DesktopSqlRunError::Execution(Box::new(
                    DesktopSqlExecutionFailure {
                        error,
                        _lease: lease,
                    },
                )))
            }
        }
    }
}
