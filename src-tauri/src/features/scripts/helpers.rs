//! Script result projection, transaction execution, and audit/history recording.

use super::*;

pub(super) fn statement_ok(sql: &str, affected: u64) -> ScriptStatement {
    ScriptStatement {
        sql: sql.to_string(),
        result: None,
        affected: Some(affected as i64),
        error: None,
    }
}

pub(super) fn statement_error(sql: &str, message: String) -> ScriptStatement {
    ScriptStatement {
        sql: sql.to_string(),
        result: None,
        affected: None,
        error: Some(message),
    }
}

pub(super) fn statement_skipped(sql: &str) -> ScriptStatement {
    statement_error(sql, "skipped — transaction rolled back".into())
}

pub(super) fn script_has_write(kinds: &[QueryKind]) -> bool {
    kinds.iter().any(|kind| !matches!(kind, QueryKind::Read))
}

pub(super) fn script_operation_risk(
    classifications: &[crate::model::Classification],
) -> OperationRiskLevel {
    if classifications.iter().any(|classification| {
        classification.no_where && !matches!(classification.kind, QueryKind::Read)
    }) {
        return OperationRiskLevel::Critical;
    }
    classifications
        .iter()
        .fold(OperationRiskLevel::Low, |risk, classification| {
            match (risk, classification.risk) {
                (OperationRiskLevel::High, _) | (_, crate::model::RiskLevel::High) => {
                    OperationRiskLevel::High
                }
                (OperationRiskLevel::Medium, _) | (_, crate::model::RiskLevel::Medium) => {
                    OperationRiskLevel::Medium
                }
                _ => OperationRiskLevel::Low,
            }
        })
}

/// Execute every statement in one write-pool transaction. MySQL may implicitly
/// commit DDL, so mixed MySQL DDL scripts retain the existing best-effort caveat.
pub(super) async fn execute_script_transaction(
    pool: &DbPool,
    statements: &[String],
    namespace: Option<String>,
    expected_affected: Option<&[u64]>,
    grant: &ExecutionGrant,
    operation_id: Uuid,
) -> AppResult<(Vec<ScriptStatement>, bool)> {
    if grant.operation_id() != operation_id {
        return Err(AppError::Blocked {
            reason: "script transaction scope does not match its approved operation".into(),
        });
    }
    let _exact_payload = (grant.payload_sha256(), grant.connection_id());
    macro_rules! run_transaction {
        ($pool:expr, $context:expr) => {{
            let mut outcomes = Vec::with_capacity(statements.len());
            match $pool.begin().await {
                Ok(mut transaction) => {
                    if let Some(context) = $context {
                        if let Err(error) = sqlx::query(AssertSqlSafe(context))
                            .execute(&mut *transaction)
                            .await
                        {
                            transaction.rollback().await.map_err(|rollback| {
                                AppError::OutcomeUnknown(format!(
                                    "script namespace rollback acknowledgement failed: {rollback}"
                                ))
                            })?;
                            return Err(AppError::from(error));
                        }
                    }
                    let mut succeeded = true;
                    for (index, statement) in statements.iter().enumerate() {
                        match sqlx::query(AssertSqlSafe(statement.as_str()))
                            .execute(&mut *transaction)
                            .await
                        {
                            Ok(result) => {
                                let affected = result.rows_affected();
                                if let Some(expected) =
                                    expected_affected.and_then(|values| values.get(index))
                                {
                                    if affected != *expected {
                                        outcomes.push(statement_error(
                                            statement,
                                            format!(
                                                "optimistic concurrency conflict: expected {expected} affected row, got {affected}"
                                            ),
                                        ));
                                        succeeded = false;
                                        break;
                                    }
                                }
                                outcomes.push(statement_ok(statement, affected))
                            }
                            Err(error) => {
                                outcomes.push(statement_error(statement, error.to_string()));
                                succeeded = false;
                                break;
                            }
                        }
                    }
                    if !succeeded {
                        if let Err(error) = transaction.rollback().await {
                            return Err(AppError::OutcomeUnknown(format!(
                                "script rollback acknowledgement failed: {error}"
                            )));
                        }
                        while outcomes.len() < statements.len() {
                            outcomes.push(statement_skipped(&statements[outcomes.len()]));
                        }
                        (outcomes, false)
                    } else if let Err(error) = transaction.commit().await {
                        return Err(AppError::OutcomeUnknown(format!(
                            "script commit acknowledgement failed: {error}"
                        )));
                    } else {
                        (outcomes, true)
                    }
                }
                Err(error) => (
                    statements
                        .iter()
                        .map(|statement| {
                            statement_error(
                                statement,
                                format!("could not begin transaction: {error}"),
                            )
                        })
                        .collect(),
                    false,
                ),
            }
        }};
    }
    let postgres_context = namespace
        .as_deref()
        .map(crate::executor::namespace::postgres_search_path_statement);
    Ok(match pool {
        DbPool::Postgres(pool) => run_transaction!(pool, postgres_context.as_deref()),
        DbPool::Mysql(pool) => run_transaction!(pool, None::<&str>),
        DbPool::Sqlite(pool) => run_transaction!(pool, None::<&str>),
        DbPool::Bigquery(_) => {
            return Err(AppError::Blocked {
                reason:
                    "BigQuery scripts are unavailable through the single-statement read adapter"
                        .into(),
            })
        }
        DbPool::CloudflareD1(_) => {
            return Err(AppError::Blocked {
                reason: "Cloudflare D1 scripts require the dedicated remote batch workflow".into(),
            })
        }
    })
}

pub(super) struct ScriptRunRecord<'a> {
    pub(super) sql: &'a str,
    pub(super) kind: QueryKind,
    pub(super) action: &'a str,
    pub(super) status: &'a str,
    pub(super) row_count: Option<i64>,
    pub(super) error: Option<String>,
    pub(super) origin: &'a str,
}

pub(super) async fn record_script_run(
    store: &Store,
    pin: &PinnedConnection,
    record: ScriptRunRecord<'_>,
) {
    if let Err(error) = audit::record(
        store,
        RecordArgs {
            connection_id: pin.connection_id,
            engine: pin.profile.engine,
            agent_prompt: None,
            sql: record.sql.to_string(),
            kind: record.kind,
            action: record.action.to_string(),
            approved_by: None,
            affected_estimate: record.row_count,
            error: record.error.clone(),
        },
    )
    .await
    {
        tracing::error!(
            connection_id = %pin.connection_id,
            action = record.action,
            %error,
            "script audit record failed"
        );
    }
    if let Err(error) = store
        .insert_history_if_current(
            pin,
            &HistoryEntry {
                id: Uuid::new_v4(),
                connection_id: pin.connection_id,
                sql: record.sql.to_string(),
                kind: record.kind,
                status: record.status.to_string(),
                row_count: record.row_count,
                duration_ms: None,
                error: record.error,
                executed_at: Utc::now(),
                origin: record.origin.to_string(),
            },
        )
        .await
    {
        tracing::error!(
            connection_id = %pin.connection_id,
            %error,
            "script history insert failed"
        );
    }
}
