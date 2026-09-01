//! Immutable multi-statement proposal classification and persistence.

use super::*;

impl ScriptPlatformAdapter {
    /// Persist one exact multi-statement proposal after classifying every statement.
    /// All-read scripts become ready single-use plans; any mutation always waits for
    /// exact approval regardless of the legacy prompt preference.
    pub(crate) async fn propose_desktop(
        &self,
        request: DesktopScriptProposalRequest,
    ) -> Result<DesktopScriptProposalReceipt, DesktopScriptRunError> {
        let operation_scope = self.connections.begin_operation_scope().await;
        let pin = match operation_scope
            .pin_connection_for_view(request.connection_id)
            .await
        {
            Ok(pin) => pin,
            Err(error) => {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }))
            }
        };
        if pin.profile.engine.is_document() {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "SQL scripts are unavailable for document connections".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if pin.profile.engine == crate::model::Engine::Bigquery {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "BigQuery supports one read statement per operation in DopeDB".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        let database = request
            .database
            .as_deref()
            .unwrap_or(&pin.profile.database)
            .to_owned();
        if database.is_empty() || database.len() > 255 || database.chars().any(char::is_control) {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Config("target database name is empty or invalid".into()),
                _scope: Box::new(operation_scope),
            }));
        }
        let namespace = match crate::executor::namespace::resolve_sql_namespace(
            &pin.profile,
            Some(&database),
            request.namespace,
        ) {
            Ok(namespace) => namespace,
            Err(error) => {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error,
                    _scope: Box::new(operation_scope),
                }))
            }
        };
        let settings = self
            .store
            .get_safety(pin.connection_id)
            .await
            .map_err(DesktopScriptRunError::Application)?;
        let statements = crate::sql_script::split_statements(&request.sql, pin.profile.engine);
        if statements.is_empty() {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Config("no executable statements in the script".into()),
                _scope: Box::new(operation_scope),
            }));
        }
        let classifications = statements
            .iter()
            .map(|statement| safety::classify(statement, pin.profile.engine))
            .collect::<AppResult<Vec<_>>>()
            .map_err(DesktopScriptRunError::Application)?;
        let kinds = classifications
            .iter()
            .map(|classification| classification.kind)
            .collect::<Vec<_>>();
        if kinds
            .iter()
            .any(|kind| matches!(kind, QueryKind::Privilege))
        {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "arbitrary privilege SQL is blocked; use a supported, narrowly scoped administrative action"
                        .into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        let has_write = script_has_write(&kinds);
        let has_ddl = kinds.contains(&QueryKind::Ddl);
        let access_allowed = if has_ddl {
            pin.profile.workspace_access.can_manage()
        } else if has_write {
            pin.profile.workspace_access.can_write()
        } else {
            pin.profile.workspace_access.can_read()
        };
        if !access_allowed {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: if has_ddl {
                        "your workspace role does not permit schema changes".into()
                    } else {
                        "your workspace role no longer grants this script access".into()
                    },
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if has_write && !settings.allow_writes {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "writes are disabled for this connection".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if has_ddl && !settings.allow_schema_changes {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "schema changes are disabled for this connection; review the required permission shown with this result before proposing this DDL."
                        .into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        let policy = capture_policy(&pin, &settings).map_err(DesktopScriptRunError::Application)?;
        let history_origin = request.origin.unwrap_or_else(|| "manual".into());
        if request.schema_change.is_some() && request.table_change.is_some() {
            return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                error: AppError::Blocked {
                    reason: "a script cannot be both a schema and table-data change".into(),
                },
                _scope: Box::new(operation_scope),
            }));
        }
        if let Some(context) = &request.schema_change {
            if context.request.catalog_fingerprint != context.plan.catalog_fingerprint
                || request.sql != context.plan.sql()
                || context.plan.statements.is_empty()
            {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error: AppError::Blocked {
                        reason: "schema-change SQL does not match its exact rendered plan".into(),
                    },
                    _scope: Box::new(operation_scope),
                }));
            }
            if !has_write {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error: AppError::Blocked {
                        reason: "a schema-change proposal must contain target-mutating DDL".into(),
                    },
                    _scope: Box::new(operation_scope),
                }));
            }
        }
        if let Some(context) = &request.table_change {
            if context.expected_affected.len() != statements.len()
                || context
                    .expected_affected
                    .iter()
                    .any(|expected| *expected != 1)
                || context.catalog_fingerprint.len() != 64
                || !context
                    .catalog_fingerprint
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error: AppError::Blocked {
                        reason: "staged table changes have an invalid optimistic-lock contract"
                            .into(),
                    },
                    _scope: Box::new(operation_scope),
                }));
            }
            if classifications.iter().any(|classification| {
                classification.kind != QueryKind::Write || !classification.rollback_safe
            }) {
                return Err(DesktopScriptRunError::Scoped(DesktopScriptScopedFailure {
                    error: AppError::Blocked {
                        reason: "staged table changes may contain only INSERT, UPDATE, or DELETE"
                            .into(),
                    },
                    _scope: Box::new(operation_scope),
                }));
            }
        }
        let schema_fingerprint = request
            .schema_change
            .as_ref()
            .map(|context| context.request.catalog_fingerprint.clone())
            .or_else(|| {
                request
                    .table_change
                    .as_ref()
                    .map(|context| context.catalog_fingerprint.clone())
            });
        let operation_kind = if request.schema_change.is_some() {
            OperationKind::SchemaChange
        } else if request.table_change.is_some() {
            OperationKind::TableDataChange
        } else if has_write {
            OperationKind::SqlScript
        } else {
            OperationKind::ReadQuery
        };
        let schema_change = request.schema_change;
        let table_change = request.table_change;
        let payload = serde_json::to_value(StoredDesktopScriptPayload {
            sql: request.sql,
            history_origin: history_origin.clone(),
            database: database.clone(),
            namespace,
            schema_change: schema_change.clone(),
            table_change: table_change.clone(),
        })
        .map_err(AppError::from)
        .map_err(DesktopScriptRunError::Application)?;
        let operation_id = Uuid::new_v4();
        let expires_at = Utc::now()
            + if has_write {
                ChronoDuration::minutes(5)
            } else {
                ChronoDuration::from_std(QUERY_PLAN_TTL)
                    .expect("query plan TTL is representable by chrono")
            };
        let disposition = if has_write {
            OperationPlanDisposition::ApprovalRequired
        } else {
            OperationPlanDisposition::Ready
        };
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
                    actor: actor_for_pin(&pin, history_origin),
                    kind: operation_kind,
                    payload_schema_version: DESKTOP_SCRIPT_PAYLOAD_SCHEMA_VERSION,
                    payload,
                    schema_fingerprint,
                    risk_level: script_operation_risk(&classifications),
                    preview: serde_json::json!({
                        "database": database,
                        "classifications": classifications,
                        "ddlPlan": schema_change.map(|context| context.plan),
                        "expectedAffected": table_change.map(|context| context.expected_affected),
                        "statementCount": statements.len(),
                    }),
                    policy_snapshot: policy.snapshot,
                    policy_revision: policy.revision,
                    single_use: true,
                    idempotency_key: operation_id.to_string(),
                    expires_at: Some(expires_at),
                },
                disposition,
            )
            .await
            .map_err(DesktopScriptRunError::Application)?;
        let confirmation_phrase = required_confirmation(&operation).map(str::to_owned);
        Ok(DesktopScriptProposalReceipt {
            operation_id: operation.id,
            payload_hash: operation.payload_hash,
            state: operation.state,
            approval_required: has_write,
            confirmation_phrase,
            statement_count: statements.len(),
            expires_at,
        })
    }
}
