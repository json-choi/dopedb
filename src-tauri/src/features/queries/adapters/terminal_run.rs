//! Claiming and executing one Terminal-bound, single-use SQL-read plan.

use crate::connection::{
    ensure_terminal_pin, ConnectionAccess, ConnectionContext, ConnectionLease,
};
use crate::error::AppError;
use crate::executor;
use crate::kernel::access::PinnedConnection;
use crate::kernel::agent_policy::MAX_AGENT_ROWS;
use crate::kernel::identity::{ConnectionId, OperationId};
use crate::kernel::TerminalAuthority;
use crate::operations::{
    ensure_operation_scope, ClaimedOperation, OperationActorKind, OperationKind, OperationRuntime,
    OperationState,
};
use crate::safety;
use crate::store::Store;
use uuid::Uuid;

use super::super::domain::{AgentQueryRun, AgentQueryRunEventContext};
use super::super::ManualExecutionTarget;
use super::errors::{
    AgentQueryExecutionFailure, AgentQueryProvenanceFailure, AgentQueryRunError,
    AgentQueryRunPrepareError,
};
use super::platform::QueryPlatformAdapter;
use super::terminal_plan::StoredAgentReadPayload;
use super::terminal_support::{
    audit_best_effort, capture_agent_read_policy, persist_history, pool_ref, record_run_failure,
};

/// Opaque capability whose ownership proves the durable plan was claimed exactly once.
pub(crate) struct PreparedAgentQueryRun {
    store: Store,
    context: ConnectionContext,
    operation_pin: PinnedConnection,
    operation: OperationRuntime,
    claimed: ClaimedOperation,
    event_context: AgentQueryRunEventContext,
    decision: String,
    max_rows: u64,
    origin: super::super::domain::AgentQueryInvocationOrigin,
    cancellation: executor::cancel::CancelHandle,
    manual_transactions: crate::features::queries::ManualTransactionRuntime,
}

/// Successful result whose lease survives Broker response projection.
pub(crate) struct AgentQueryRunReceipt {
    run: AgentQueryRun,
    _lease: ConnectionLease,
}

impl AgentQueryRunReceipt {
    pub(crate) fn run(&self) -> &AgentQueryRun {
        &self.run
    }
}

impl PreparedAgentQueryRun {
    pub(crate) async fn execute(self) -> Result<AgentQueryRunReceipt, AgentQueryRunError> {
        let Self {
            store,
            context,
            operation_pin,
            operation,
            claimed,
            event_context,
            decision,
            max_rows,
            origin,
            cancellation,
            manual_transactions,
        } = self;
        let operation_id = claimed.record().id;
        let engine = operation_pin.profile.engine;
        if operation_pin.profile.provider == crate::model::Provider::CloudflareD1 {
            let error = AppError::Blocked {
                reason: "Cloudflare D1 is unavailable to Agents because Wrangler OAuth does not provide a database-enforced read-only session".into(),
            };
            let _ = operation
                .fail(
                    operation_id,
                    &serde_json::json!({
                        "error": error.to_string(), "reason": "read_only_boundary_unavailable",
                    }),
                )
                .await;
            return Err(AgentQueryRunError::Connection(error));
        }
        let lease = match context
            .connect_to_database(Some(event_context.database.clone()))
            .await
        {
            Ok(lease) => lease,
            Err(error) => {
                record_run_failure(
                    &store,
                    &operation_pin,
                    &event_context.sql,
                    engine,
                    origin,
                    &error,
                )
                .await;
                let _ = operation
                    .fail(
                        operation_id,
                        &serde_json::json!({
                            "error": error.to_string(), "reason": "target_connection_failed",
                        }),
                    )
                    .await;
                return Err(AgentQueryRunError::Connection(error));
            }
        };
        let live = match lease.live().sql() {
            Ok(live) => live,
            Err(error) => {
                record_run_failure(
                    &store,
                    &operation_pin,
                    &event_context.sql,
                    engine,
                    origin,
                    &error,
                )
                .await;
                let _ = operation
                    .fail(
                        operation_id,
                        &serde_json::json!({
                            "error": error.to_string(), "reason": "target_pool_unavailable",
                        }),
                    )
                    .await;
                return Err(AgentQueryRunError::Execution(
                    AgentQueryExecutionFailure::new(error, lease),
                ));
            }
        };
        let manual_result = manual_transactions
            .run_read(
                ManualExecutionTarget {
                    connection_id: operation_pin.connection_id,
                    database: lease.target_database(),
                    namespace: None,
                },
                &event_context.sql,
                max_rows,
                Some(&cancellation),
            )
            .await;
        let manual_transaction = manual_result.is_some();
        let result = if let Some(result) = manual_result {
            result
        } else {
            safety::run_read_only_cancellable(
                pool_ref(live.ro()),
                &event_context.sql,
                max_rows,
                Some(&cancellation),
            )
            .await
        };
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                let cancelled =
                    matches!(&error, AppError::Safety(reason) if reason == "query cancelled");
                record_run_failure(
                    &store,
                    &operation_pin,
                    &event_context.sql,
                    engine,
                    origin,
                    &error,
                )
                .await;
                let _ = if cancelled {
                    operation
                        .confirm_cancelled(
                            operation_id,
                            &serde_json::json!({"reason": "user_cancelled"}),
                        )
                        .await
                } else {
                    operation
                        .fail(
                            operation_id,
                            &serde_json::json!({
                                "error": error.to_string(),
                                "reason": if manual_transaction {
                                    "manual_transaction_read_failed"
                                } else {
                                    "read_execution_failed"
                                },
                            }),
                        )
                        .await
                };
                return Err(AgentQueryRunError::Execution(
                    AgentQueryExecutionFailure::new(error, lease),
                ));
            }
        };
        audit_best_effort(
            &store,
            operation_pin.connection_id,
            engine,
            &event_context.sql,
            crate::model::QueryKind::Read,
            origin.run_audit_action(),
            None,
        )
        .await;
        let query_run_id = match persist_history(
            &store,
            &operation_pin,
            &event_context.sql,
            "ok",
            Some(result.row_count as i64),
            Some(result.duration_ms as i64),
            None,
        )
        .await
        {
            Ok(id) => id,
            Err(error) => {
                let _ = operation
                    .fail(
                        operation_id,
                        &serde_json::json!({
                            "error": error.to_string(), "reason": "history_receipt_failed",
                        }),
                    )
                    .await;
                return Err(AgentQueryRunError::ProvenancePersistence(
                    AgentQueryProvenanceFailure::new(error, lease),
                ));
            }
        };
        if let Err(error) = operation.succeed(operation_id, &serde_json::json!({
            "durationMs": result.duration_ms, "queryRunId": Uuid::from(query_run_id), "rowCount": result.row_count,
        })).await {
            let _ = operation.fail(operation_id, &serde_json::json!({
                "error": error.to_string(), "reason": "operation_receipt_failed",
            })).await;
            return Err(AgentQueryRunError::ProvenancePersistence(
                AgentQueryProvenanceFailure::new(error, lease),
            ));
        }
        Ok(AgentQueryRunReceipt {
            run: AgentQueryRun {
                connection_id: event_context.connection_id,
                connection_name: event_context.connection_name,
                database: event_context.database,
                plan_id: event_context.plan_id,
                planning_decision: decision,
                query_run_id,
                result,
            },
            _lease: lease,
        })
    }
}

impl QueryPlatformAdapter {
    pub(super) async fn prepare(
        &self,
        plan_id: OperationId,
        authority: &TerminalAuthority,
    ) -> Result<PreparedAgentQueryRun, AgentQueryRunPrepareError> {
        let planned = match self.operation.get(plan_id.into()).await {
            Ok(planned) => planned,
            Err(AppError::NotFound(_)) => {
                return Err(AgentQueryRunPrepareError::UnknownOrAlreadyUsed)
            }
            Err(error) => return Err(AgentQueryRunPrepareError::Application(error)),
        };
        if planned.payload_schema_version != 2
            || planned.kind != OperationKind::ReadQuery
            || planned.actor.kind != OperationActorKind::Agent
        {
            return Err(AgentQueryRunPrepareError::StoredPlanInvalid);
        }
        let payload: StoredAgentReadPayload = serde_json::from_value(planned.payload.clone())
            .map_err(|_| AgentQueryRunPrepareError::StoredPlanInvalid)?;
        if planned.actor.id != payload.origin.as_str() {
            return Err(AgentQueryRunPrepareError::StoredPlanInvalid);
        }
        if planned.terminal_session_id != Some(authority.terminal_session_id.into())
            || payload.origin != super::super::domain::AgentQueryInvocationOrigin::Cli
        {
            return Err(AgentQueryRunPrepareError::SessionMismatch);
        }
        if planned.state == OperationState::Expired {
            return Err(AgentQueryRunPrepareError::UnknownOrAlreadyUsed);
        }
        let expired = planned
            .expires_at
            .is_some_and(|expires_at| expires_at <= chrono::Utc::now());
        let cancellation = executor::cancel::register(plan_id.into());
        let claimed = match self.operation.claim(plan_id.into()).await {
            Ok(claimed) => claimed,
            Err(_) if expired => return Err(AgentQueryRunPrepareError::Expired),
            Err(_) if planned.state != OperationState::Ready => {
                return Err(AgentQueryRunPrepareError::UnknownOrAlreadyUsed)
            }
            Err(error) => return Err(AgentQueryRunPrepareError::Application(error)),
        };
        let context = match self
            .connections
            .pin(planned.connection_id, ConnectionAccess::Read)
            .await
        {
            Ok(context) => context,
            Err(error) => {
                let _ = self.operation.fail(plan_id.into(), &serde_json::json!({"error": error.to_string(), "reason": "connection_scope_unavailable"})).await;
                return Err(AgentQueryRunPrepareError::Application(error));
            }
        };
        let pin = context.pin().clone();
        if ensure_terminal_pin(authority, &pin).is_err() {
            let _ = self
                .operation
                .fail(
                    plan_id.into(),
                    &serde_json::json!({"reason": "terminal_authority_changed"}),
                )
                .await;
            return Err(AgentQueryRunPrepareError::AuthorityChanged);
        }
        if ensure_operation_scope(&planned, &pin).is_err() {
            let _ = self
                .operation
                .fail(
                    plan_id.into(),
                    &serde_json::json!({"reason": "operation_authority_changed"}),
                )
                .await;
            return Err(AgentQueryRunPrepareError::AuthorityChanged);
        }
        let settings = match self.store.get_safety(pin.connection_id).await {
            Ok(settings) => settings,
            Err(error) => {
                let _ = self.operation.fail(plan_id.into(), &serde_json::json!({"error": error.to_string(), "reason": "safety_policy_unavailable"})).await;
                return Err(AgentQueryRunPrepareError::Application(error));
            }
        };
        let policy = match capture_agent_read_policy(&pin) {
            Ok(policy) => policy,
            Err(error) => {
                let _ = self.operation.fail(plan_id.into(), &serde_json::json!({"error": error.to_string(), "reason": "policy_snapshot_failed"})).await;
                return Err(AgentQueryRunPrepareError::Application(error));
            }
        };
        if policy.1 != planned.policy_revision {
            let _ = self
                .operation
                .fail(
                    plan_id.into(),
                    &serde_json::json!({"reason": "operation_policy_changed"}),
                )
                .await;
            return Err(AgentQueryRunPrepareError::AuthorityChanged);
        }
        let classification = match safety::classify(&payload.sql, pin.profile.engine) {
            Ok(classification) => classification,
            Err(error) => {
                let _ = self.operation.fail(plan_id.into(), &serde_json::json!({"error": error.to_string(), "reason": "stored_plan_reclassification_failed"})).await;
                return Err(AgentQueryRunPrepareError::Application(error));
            }
        };
        if !matches!(classification.kind, crate::model::QueryKind::Read)
            || classification.statement_count != 1
        {
            let _ = self
                .operation
                .fail(
                    plan_id.into(),
                    &serde_json::json!({"reason": "stored_plan_classification_changed"}),
                )
                .await;
            return Err(AgentQueryRunPrepareError::StoredPlanInvalid);
        }
        Ok(PreparedAgentQueryRun {
            store: self.store.clone(),
            context,
            operation_pin: pin.clone(),
            operation: self.operation.clone(),
            claimed,
            event_context: AgentQueryRunEventContext {
                connection_id: ConnectionId::from(pin.connection_id),
                connection_name: pin.profile.name.clone(),
                database: payload.database,
                plan_id,
                sql: payload.sql,
            },
            decision: payload.decision,
            max_rows: payload.max_rows.min(settings.max_rows).min(MAX_AGENT_ROWS),
            origin: payload.origin,
            cancellation,
            manual_transactions: self.manual_transactions.clone(),
        })
    }
}
