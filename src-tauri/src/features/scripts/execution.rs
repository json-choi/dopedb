//! Stored script validation and execution-claim preparation.

use super::*;

impl ScriptPlatformAdapter {
    /// Execute an immutable script by operation id only.
    pub(crate) async fn run_desktop(
        &self,
        operation_id: Uuid,
    ) -> Result<DesktopScriptRunReceipt, DesktopScriptRunError> {
        let planned = self
            .operation
            .get(operation_id)
            .await
            .map_err(DesktopScriptRunError::Application)?;
        if planned.payload_schema_version != DESKTOP_SCRIPT_PAYLOAD_SCHEMA_VERSION
            || !matches!(
                planned.kind,
                OperationKind::ReadQuery
                    | OperationKind::SqlScript
                    | OperationKind::SchemaChange
                    | OperationKind::TableDataChange
            )
        {
            return Err(DesktopScriptRunError::Application(AppError::Blocked {
                reason: "operation is not a supported SQL script proposal".into(),
            }));
        }
        let mut payload: StoredDesktopScriptPayload =
            serde_json::from_value(planned.payload.clone())
                .map_err(AppError::from)
                .map_err(DesktopScriptRunError::Application)?;
        let operation_scope = self.connections.begin_operation_scope().await;
        let operation_pin = match operation_scope.pin_connection(planned.connection_id).await {
            Ok(pin) => pin,
            Err(error) => {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }))
            }
        };
        ensure_operation_scope(&planned, &operation_pin)
            .map_err(DesktopScriptRunError::Application)?;
        if operation_pin.profile.engine == crate::model::Engine::Bigquery {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "BigQuery supports one read statement per operation in DopeDB".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        let namespace = match crate::executor::namespace::resolve_sql_namespace(
            &operation_pin.profile,
            Some(&payload.database),
            payload.namespace.clone(),
        ) {
            Ok(namespace) => namespace,
            Err(error) => {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }))
            }
        };
        payload.namespace = namespace;
        let settings = match self.store.get_safety(operation_pin.connection_id).await {
            Ok(settings) => settings,
            Err(error) => {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }))
            }
        };
        let policy = capture_policy(&operation_pin, &settings)
            .map_err(DesktopScriptRunError::Application)?;
        if policy.revision != planned.policy_revision {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "the connection or safety policy changed; create a new proposal".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if let Some(context) = &payload.schema_change {
            if planned.kind != OperationKind::SchemaChange
                || planned.schema_fingerprint.as_deref()
                    != Some(context.request.catalog_fingerprint.as_str())
                || payload.sql != context.plan.sql()
            {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error: AppError::Blocked {
                        reason: "stored schema-change provenance is inconsistent".into(),
                    },
                    _scope: Box::new(operation_scope),
                }));
            }
            let snapshot = self
                .catalog
                .load_database_snapshot(planned.connection_id.into(), payload.database.clone())
                .await
                .map_err(DesktopScriptRunError::Application)?;
            if snapshot.fingerprint() != context.request.catalog_fingerprint {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error: AppError::Blocked {
                        reason: "the target schema changed after approval; create a new proposal"
                            .into(),
                    },
                    _scope: Box::new(operation_scope),
                }));
            }
            let rendered = crate::ddl::render(&snapshot, &context.request)
                .map_err(DesktopScriptRunError::Application)?;
            if rendered != context.plan {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error: AppError::Blocked {
                        reason: "the schema-change renderer no longer matches the approved plan"
                            .into(),
                    },
                    _scope: Box::new(operation_scope),
                }));
            }
        } else if planned.kind == OperationKind::SchemaChange {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "schema-change operation is missing its structured payload".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if let Some(context) = &payload.table_change {
            if planned.kind != OperationKind::TableDataChange
                || planned.schema_fingerprint.as_deref()
                    != Some(context.catalog_fingerprint.as_str())
            {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error: AppError::Blocked {
                        reason: "stored table-change provenance is inconsistent".into(),
                    },
                    _scope: Box::new(operation_scope),
                }));
            }
            let snapshot = self
                .catalog
                .load_database_snapshot(planned.connection_id.into(), payload.database.clone())
                .await
                .map_err(DesktopScriptRunError::Application)?;
            if snapshot.fingerprint() != context.catalog_fingerprint {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error: AppError::Blocked {
                        reason:
                            "the target schema changed after table edits were staged; reload the table"
                                .into(),
                    },
                    _scope: Box::new(operation_scope),
                }));
            }
        } else if planned.kind == OperationKind::TableDataChange {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "table-data operation is missing its optimistic-lock payload".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        let engine = operation_pin.profile.engine;
        let history_origin = payload.history_origin.clone();
        let statements = crate::sql_script::split_statements(&payload.sql, engine);
        if statements.is_empty() {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Config("no executable statements in the script".into()),
                _scope: Box::new(operation_scope),
            }));
        }
        let kinds = match statements
            .iter()
            .map(|statement| safety::classify(statement, engine).map(|result| result.kind))
            .collect::<AppResult<Vec<_>>>()
        {
            Ok(kinds) => kinds,
            Err(error) => {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }))
            }
        };
        if let Some(index) = kinds
            .iter()
            .position(|kind| matches!(kind, QueryKind::Privilege))
        {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::SqlPolicyBlocked {
                    position: crate::sql_script::statement_position(
                        &payload.sql,
                        &statements,
                        index,
                    ),
                },
                _scope: Box::new(operation_scope),
            }));
        }

        let has_write = script_has_write(&kinds);
        let expected_kind = if payload.schema_change.is_some() {
            OperationKind::SchemaChange
        } else if payload.table_change.is_some() {
            OperationKind::TableDataChange
        } else if has_write {
            OperationKind::SqlScript
        } else {
            OperationKind::ReadQuery
        };
        if planned.kind != expected_kind {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "stored script classification no longer matches its proposal".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        let operation = self
            .operation
            .claim(operation_id)
            .await
            .map_err(DesktopScriptRunError::Application)?;
        let prepared = PreparedScriptRun {
            operation_scope,
            operation_pin,
            operation,
            payload,
            statements,
            kinds,
            settings,
            engine,
            history_origin,
        };
        if has_write {
            self.run_write(prepared).await
        } else {
            self.run_reads(prepared).await
        }
    }
}
