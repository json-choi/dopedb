//! Exact-approved transactional script mutation execution.

use super::*;

impl ScriptPlatformAdapter {
    pub(super) async fn run_write(
        &self,
        prepared: PreparedScriptRun,
    ) -> Result<DesktopScriptRunReceipt, DesktopScriptRunError> {
        let PreparedScriptRun {
            operation_scope,
            operation_pin,
            operation,
            payload,
            statements,
            kinds,
            settings,
            engine,
            history_origin,
        } = prepared;
        let operation_id = operation.record().id;
        let has_ddl = kinds.iter().any(|kind| matches!(kind, QueryKind::Ddl));
        if (has_ddl && !operation_pin.profile.workspace_access.can_manage())
            || (!has_ddl && !operation_pin.profile.workspace_access.can_write())
        {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: if has_ddl {
                        "your workspace role does not permit schema changes".into()
                    } else {
                        "your workspace role grants read-only database access".into()
                    },
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if !settings.allow_writes {
            let reason = "writing is disabled for this connection (writes are off by default). \
                          Enable writes in the connection's safety settings to run this script."
                .to_string();
            record_script_run(
                &self.store,
                &operation_pin,
                ScriptRunRecord {
                    sql: &payload.sql,
                    kind: QueryKind::Write,
                    action: "blocked",
                    status: "blocked",
                    row_count: None,
                    error: Some(reason.clone()),
                    origin: &history_origin,
                },
            )
            .await;
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked { reason },
                _scope: Box::new(operation_scope),
            }));
        }
        let script_kind = if has_ddl {
            QueryKind::Ddl
        } else if kinds
            .iter()
            .any(|kind| matches!(kind, QueryKind::Privilege))
        {
            QueryKind::Privilege
        } else {
            QueryKind::Write
        };
        if has_ddl && !settings.allow_schema_changes {
            let reason = "schema changes are disabled for this connection; review the required permission shown with this result before running this DDL script.";
            record_script_run(
                &self.store,
                &operation_pin,
                ScriptRunRecord {
                    sql: &payload.sql,
                    kind: script_kind,
                    action: "blocked",
                    status: "blocked",
                    row_count: None,
                    error: Some(reason.into()),
                    origin: &history_origin,
                },
            )
            .await;
            let _ = self
                .operation
                .fail(
                    operation_id,
                    &serde_json::json!({"reason": "schema_access_disabled"}),
                )
                .await;
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: reason.into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if let Err(error) = audit::record(
            &self.store,
            RecordArgs {
                connection_id: operation_pin.connection_id,
                engine,
                agent_prompt: None,
                sql: payload.sql.clone(),
                kind: script_kind,
                action: "script:execute:attempt".into(),
                approved_by: Some(operation.record().actor.id.clone()),
                affected_estimate: None,
                error: None,
            },
        )
        .await
        {
            let _ = self
                .operation
                .fail(
                    operation_id,
                    &serde_json::json!({"reason": "audit_pre_record_failed"}),
                )
                .await;
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Config(format!(
                    "audit pre-record failed — refusing to run script: {error}"
                )),
                _scope: Box::new(operation_scope),
            }));
        }

        let lease = match operation_scope
            .connect_to_database(
                operation_pin.clone(),
                if has_ddl {
                    ConnectionAccess::Schema
                } else {
                    ConnectionAccess::Write
                },
                Some(payload.database.clone()),
            )
            .await
        {
            Ok(lease) => lease,
            Err(error) => {
                record_script_run(
                    &self.store,
                    &operation_pin,
                    ScriptRunRecord {
                        sql: &payload.sql,
                        kind: script_kind,
                        action: "script:execute",
                        status: "error",
                        row_count: None,
                        error: Some(error.to_string()),
                        origin: &history_origin,
                    },
                )
                .await;
                let _ = self
                    .operation
                    .fail(
                        operation_id,
                        &serde_json::json!({"reason": "connection_failed"}),
                    )
                    .await;
                return Err(DesktopScriptRunError::Application(error));
            }
        };
        let live = match lease.live().sql() {
            Ok(live) => live,
            Err(error) => {
                record_script_run(
                    &self.store,
                    &operation_pin,
                    ScriptRunRecord {
                        sql: &payload.sql,
                        kind: script_kind,
                        action: "script:execute",
                        status: "error",
                        row_count: None,
                        error: Some(error.to_string()),
                        origin: &history_origin,
                    },
                )
                .await;
                let _ = self
                    .operation
                    .fail(
                        operation_id,
                        &serde_json::json!({"reason": "sql_backend_unavailable"}),
                    )
                    .await;
                return Err(DesktopScriptRunError::Execution(Box::new(
                    DesktopScriptExecutionFailure {
                        error,
                        _lease: lease,
                    },
                )));
            }
        };
        let cancellation = executor::cancel::register(operation_id);
        let expected_affected = payload
            .table_change
            .as_ref()
            .map(|context| context.expected_affected.as_slice());
        let manual_execution = self
            .manual_transactions
            .run_script(ManualScriptRequest {
                target: ManualExecutionTarget {
                    connection_id: operation_pin.connection_id,
                    database: &payload.database,
                    namespace: payload.namespace.clone(),
                },
                statements: &statements,
                kinds: &kinds,
                expected_affected,
                max_rows: settings.max_rows,
                cancellation: &cancellation,
                grant: operation.grant(),
                contains_unsupported_kind: kinds
                    .iter()
                    .any(|kind| matches!(kind, QueryKind::Ddl | QueryKind::Privilege)),
            })
            .await;
        let (manual_transaction, transaction_result) = match manual_execution {
            Some(result) => (true, result.map(|result| (result.statements, false))),
            None => (
                false,
                executor::cancel::guard_registered(
                    Some(&cancellation),
                    executor::cancel::QUERY_TIMEOUT,
                    execute_script_transaction(
                        &live.write_pool,
                        &statements,
                        payload.namespace.clone(),
                        expected_affected,
                        operation.grant(),
                        operation_id,
                    ),
                )
                .await,
            ),
        };
        let (outcomes, committed) = match transaction_result {
            Ok(result) => result,
            Err(error) => {
                let interrupted = matches!(
                    &error,
                    AppError::Safety(reason)
                        if reason == "query cancelled"
                            || reason.starts_with("query timed out after ")
                );
                let error = if interrupted && !manual_transaction {
                    AppError::OutcomeUnknown(format!(
                        "script execution was interrupted before rollback or commit could be confirmed: {error}"
                    ))
                } else {
                    error
                };
                record_script_run(
                    &self.store,
                    &operation_pin,
                    ScriptRunRecord {
                        sql: &payload.sql,
                        kind: script_kind,
                        action: "script:execute",
                        status: "error",
                        row_count: None,
                        error: Some(error.to_string()),
                        origin: &history_origin,
                    },
                )
                .await;
                let _ = if matches!(&error, AppError::OutcomeUnknown(_)) {
                    self.operation
                        .mark_outcome_unknown(
                            operation_id,
                            &serde_json::json!({"reason": "target_outcome_unconfirmed"}),
                        )
                        .await
                } else {
                    self.operation
                        .fail(operation_id, &serde_json::json!({"reason": error.kind()}))
                        .await
                };
                return Err(DesktopScriptRunError::Execution(Box::new(
                    DesktopScriptExecutionFailure {
                        error,
                        _lease: lease,
                    },
                )));
            }
        };

        if !manual_transaction
            && !committed
            && matches!(engine, crate::model::Engine::Mysql)
            && kinds
                .iter()
                .any(|kind| matches!(kind, QueryKind::Ddl | QueryKind::Privilege))
        {
            let error = AppError::OutcomeUnknown(
                "MySQL may implicitly commit DDL or privilege statements before a later script statement fails"
                    .into(),
            );
            record_script_run(
                &self.store,
                &operation_pin,
                ScriptRunRecord {
                    sql: &payload.sql,
                    kind: script_kind,
                    action: "script:execute",
                    status: "outcome_unknown",
                    row_count: None,
                    error: Some(error.to_string()),
                    origin: &history_origin,
                },
            )
            .await;
            let _ = self
                .operation
                .mark_outcome_unknown(
                    operation_id,
                    &serde_json::json!({"reason": "mysql_implicit_commit_unconfirmed"}),
                )
                .await;
            return Err(DesktopScriptRunError::Execution(Box::new(
                DesktopScriptExecutionFailure {
                    error,
                    _lease: lease,
                },
            )));
        }

        if committed && has_ddl {
            let _ = self
                .store
                .clear_schema_cache(operation_pin.connection_id)
                .await;
        }
        let total = outcomes
            .iter()
            .filter_map(|statement| statement.affected)
            .sum();
        let first_error = outcomes
            .iter()
            .find_map(|statement| statement.error.clone());
        record_script_run(
            &self.store,
            &operation_pin,
            ScriptRunRecord {
                sql: &payload.sql,
                kind: script_kind,
                action: "script:execute",
                status: if manual_transaction {
                    "staged"
                } else if committed {
                    "ok"
                } else {
                    "error"
                },
                row_count: Some(total),
                error: first_error,
                origin: &history_origin,
            },
        )
        .await;
        let lifecycle = if committed || manual_transaction {
            self.operation
                .succeed(
                    operation_id,
                    &serde_json::json!({
                        "committed": committed,
                        "manualTransaction": manual_transaction,
                        "rowCount": total,
                        "statementCount": statements.len(),
                    }),
                )
                .await
        } else {
            self.operation
                .fail(
                    operation_id,
                    &serde_json::json!({"reason": "script_transaction_rolled_back"}),
                )
                .await
        };
        if let Err(error) = lifecycle {
            if committed {
                let _ = self
                    .operation
                    .mark_outcome_unknown(
                        operation_id,
                        &serde_json::json!({"reason": "local_receipt_failed"}),
                    )
                    .await;
            }
            return Err(DesktopScriptRunError::Execution(Box::new(
                DesktopScriptExecutionFailure {
                    error,
                    _lease: lease,
                },
            )));
        }
        Ok(DesktopScriptRunReceipt {
            outcome: ScriptOutcome {
                statements: outcomes,
                committed,
                all_reads: false,
                manual_transaction,
            },
            _lease: lease,
        })
    }
}
