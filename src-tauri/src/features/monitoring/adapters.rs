//! Concrete local Monitoring adapter for authority, SQL, audit, and operation I/O.

use super::*;

impl MonitoringPlatformAdapter {
    pub(crate) async fn status(
        &self,
        connection_id: Uuid,
    ) -> Result<MonitoringStatusReceipt, MonitoringError> {
        let operation_scope = self.connections.begin_operation_scope().await;
        let pin = match operation_scope.pin_connection_for_view(connection_id).await {
            Ok(pin) => pin,
            Err(error) => {
                return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }))
            }
        };
        if pin.profile.engine.is_document() {
            return Ok(MonitoringStatusReceipt::scoped(
                MonitoringStatus {
                    engine: pin.profile.engine,
                    coverage: "basic".into(),
                    role_available: false,
                    role_granted: false,
                    current_user: None,
                    can_manage: false,
                    note: "MongoDB connections use the basic, role-free collector.".into(),
                },
                operation_scope,
            ));
        }

        let engine = pin.profile.engine;
        let lease = operation_scope
            .connect(pin, ConnectionAccess::Read)
            .await
            .map_err(MonitoringError::Application)?;
        let live = match lease.live().sql() {
            Ok(live) => live,
            Err(error) => {
                return Err(MonitoringError::Execution(Box::new(
                    MonitoringExecutionFailure {
                        error,
                        _lease: lease,
                    },
                )))
            }
        };
        match monitoring::status(live, engine).await {
            Ok(status) => Ok(MonitoringStatusReceipt::leased(status, lease)),
            Err(error) => Err(MonitoringError::Execution(Box::new(
                MonitoringExecutionFailure {
                    error,
                    _lease: lease,
                },
            ))),
        }
    }

    /// Persist one fixed PostgreSQL role change as a high-risk exact proposal.
    /// The literal SQL is part of the immutable payload rendered to the user.
    pub(crate) async fn propose_postgres_role(
        &self,
        request: MonitoringProposalRequest,
    ) -> Result<MonitoringProposalReceipt, MonitoringError> {
        let operation_scope = self.connections.begin_operation_scope().await;
        let pin = match operation_scope
            .pin_connection_for_view(request.connection_id)
            .await
        {
            Ok(pin) => pin,
            Err(error) => {
                return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }));
            }
        };
        if !pin.profile.workspace_access.can_write() {
            return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                error: AppError::Blocked {
                    reason: "your workspace role cannot change database monitoring grants".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if !matches!(pin.profile.engine, Engine::Postgres) {
            return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                error: AppError::Config(
                    "pg_monitor is only available for PostgreSQL connections".into(),
                ),
                _scope: Box::new(operation_scope),
            }));
        }
        let settings = self
            .store
            .get_safety(pin.connection_id)
            .await
            .map_err(MonitoringError::Application)?;
        if !settings.allow_writes {
            return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                error: AppError::Blocked {
                    reason: "writes are disabled for this connection".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        let policy = capture_policy(&pin, &settings).map_err(MonitoringError::Application)?;
        let sql = monitoring_role_sql(request.enabled);
        let payload = serde_json::to_value(StoredMonitoringPayload {
            enabled: request.enabled,
            sql: sql.into(),
        })
        .map_err(AppError::from)
        .map_err(MonitoringError::Application)?;
        let operation_id = Uuid::new_v4();
        let expires_at = Utc::now() + ChronoDuration::minutes(5);
        let operation = self
            .operation
            .plan(
                NewOperation {
                    id: operation_id,
                    workspace_id: pin.scope.workspace_id,
                    account_scope: pin.scope.account_scope.storage_key().into(),
                    connection_id: pin.connection_id,
                    connection_revision: pin.connection_revision,
                    terminal_session_id: None,
                    actor: actor_for_pin(&pin, "settings-safety-monitoring".into()),
                    kind: OperationKind::Privilege,
                    payload_schema_version: 1,
                    payload,
                    schema_fingerprint: None,
                    risk_level: OperationRiskLevel::High,
                    preview: serde_json::json!({
                        "action": if request.enabled { "grant" } else { "revoke" },
                        "role": "pg_monitor",
                        "sql": sql,
                    }),
                    policy_snapshot: policy.snapshot,
                    policy_revision: policy.revision,
                    single_use: true,
                    idempotency_key: operation_id.to_string(),
                    expires_at: Some(expires_at),
                },
                OperationPlanDisposition::ApprovalRequired,
            )
            .await
            .map_err(MonitoringError::Application)?;
        let confirmation_phrase = required_confirmation(&operation).map(str::to_owned);
        Ok(MonitoringProposalReceipt {
            operation_id: operation.id,
            payload_hash: operation.payload_hash,
            state: operation.state,
            enabled: request.enabled,
            sql: sql.into(),
            confirmation_phrase,
            expires_at,
        })
    }

    /// Execute an exactly approved fixed-role proposal by operation id only.
    pub(crate) async fn run_postgres_role(
        &self,
        operation_id: Uuid,
    ) -> Result<MonitoringStatusReceipt, MonitoringError> {
        let planned = self
            .operation
            .get(operation_id)
            .await
            .map_err(MonitoringError::Application)?;
        if planned.payload_schema_version != 1 || planned.kind != OperationKind::Privilege {
            return Err(MonitoringError::Application(AppError::Blocked {
                reason: "operation is not a PostgreSQL monitoring-role proposal".into(),
            }));
        }
        let payload: StoredMonitoringPayload = serde_json::from_value(planned.payload.clone())
            .map_err(AppError::from)
            .map_err(MonitoringError::Application)?;
        if payload.sql != monitoring_role_sql(payload.enabled) {
            return Err(MonitoringError::Application(AppError::Blocked {
                reason: "stored monitoring operation does not match the fixed role action".into(),
            }));
        }

        let operation_scope = self.connections.begin_operation_scope().await;
        let operation_pin = match operation_scope.pin_connection(planned.connection_id).await {
            Ok(pin) => pin,
            Err(error) => {
                return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }));
            }
        };
        ensure_operation_scope(&planned, &operation_pin).map_err(MonitoringError::Application)?;
        if !operation_pin.profile.workspace_access.can_write() {
            return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                error: AppError::Blocked {
                    reason: "your workspace role no longer grants monitoring changes".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if !matches!(operation_pin.profile.engine, Engine::Postgres) {
            return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                error: AppError::Config(
                    "pg_monitor is only available for PostgreSQL connections".into(),
                ),
                _scope: Box::new(operation_scope),
            }));
        }
        let settings = self
            .store
            .get_safety(operation_pin.connection_id)
            .await
            .map_err(MonitoringError::Application)?;
        if !settings.allow_writes {
            return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                error: AppError::Blocked {
                    reason: "writes are disabled for this connection".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        let policy =
            capture_policy(&operation_pin, &settings).map_err(MonitoringError::Application)?;
        if policy.revision != planned.policy_revision {
            return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                error: AppError::Blocked {
                    reason: "the connection or safety policy changed; create a new proposal".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }

        let claimed = match self.operation.claim(operation_id).await {
            Ok(claimed) => claimed,
            Err(error) => {
                return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }));
            }
        };
        let approved_by: &str = &crate::operations::approver_for_pin(&operation_pin).id;
        if let Err(error) = audit::record(
            &self.store,
            RecordArgs {
                connection_id: operation_pin.connection_id,
                engine: operation_pin.profile.engine,
                agent_prompt: None,
                sql: payload.sql.clone(),
                kind: QueryKind::Privilege,
                action: if payload.enabled {
                    "monitoring:grant:attempt"
                } else {
                    "monitoring:revoke:attempt"
                }
                .into(),
                approved_by: Some(approved_by.into()),
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
                    &serde_json::json!({
                        "error": error.to_string(),
                        "reason": "audit_pre_record_failed",
                    }),
                )
                .await;
            return Err(MonitoringError::Scoped(MonitoringScopedFailure {
                error: AppError::Config(format!(
                    "audit pre-record failed — refusing to change pg_monitor: {error}"
                )),
                _scope: Box::new(operation_scope),
            }));
        }

        let lease = match operation_scope
            .connect(operation_pin.clone(), ConnectionAccess::Write)
            .await
        {
            Ok(lease) => lease,
            Err(error) => {
                record_monitoring_change(
                    &self.store,
                    &operation_pin,
                    MonitoringRunRecord {
                        sql: &payload.sql,
                        status: "error",
                        error: Some(error.to_string()),
                        approved_by: Some(approved_by),
                    },
                )
                .await;
                let _ = self
                    .operation
                    .fail(
                        operation_id,
                        &serde_json::json!({
                            "error": error.to_string(),
                            "reason": "target_connection_failed",
                        }),
                    )
                    .await;
                return Err(MonitoringError::Application(error));
            }
        };
        let live = match lease.live().sql() {
            Ok(live) => live,
            Err(error) => {
                let _ = self
                    .operation
                    .fail(
                        operation_id,
                        &serde_json::json!({
                            "error": error.to_string(),
                            "reason": "target_pool_unavailable",
                        }),
                    )
                    .await;
                return Err(MonitoringError::Execution(Box::new(
                    MonitoringExecutionFailure {
                        error,
                        _lease: lease,
                    },
                )));
            }
        };
        if let Err(error) = monitoring::set_postgres_role(
            live,
            payload.enabled,
            claimed.grant(),
            operation_id,
            operation_pin.connection_id,
        )
        .await
        {
            record_monitoring_change(
                &self.store,
                &operation_pin,
                MonitoringRunRecord {
                    sql: &payload.sql,
                    status: "error",
                    error: Some(error.to_string()),
                    approved_by: Some(approved_by),
                },
            )
            .await;
            let _ = self
                .operation
                .mark_outcome_unknown(
                    operation_id,
                    &serde_json::json!({
                        "error": error.to_string(),
                        "reason": "monitoring_role_execution_failed",
                    }),
                )
                .await;
            return Err(MonitoringError::Execution(Box::new(
                MonitoringExecutionFailure {
                    error,
                    _lease: lease,
                },
            )));
        }
        record_monitoring_change(
            &self.store,
            &operation_pin,
            MonitoringRunRecord {
                sql: &payload.sql,
                status: "ok",
                error: None,
                approved_by: Some(approved_by),
            },
        )
        .await;
        if let Err(error) = self
            .operation
            .succeed(
                operation_id,
                &serde_json::json!({
                    "enabled": payload.enabled,
                    "role": "pg_monitor",
                }),
            )
            .await
        {
            let _ = self
                .operation
                .mark_outcome_unknown(
                    operation_id,
                    &serde_json::json!({"reason": "local_receipt_failed"}),
                )
                .await;
            return Err(MonitoringError::Execution(Box::new(
                MonitoringExecutionFailure {
                    error,
                    _lease: lease,
                },
            )));
        }
        match monitoring::status(live, operation_pin.profile.engine).await {
            Ok(status) => Ok(MonitoringStatusReceipt::leased(status, lease)),
            Err(error) => Err(MonitoringError::Execution(Box::new(
                MonitoringExecutionFailure {
                    error,
                    _lease: lease,
                },
            ))),
        }
    }
}
