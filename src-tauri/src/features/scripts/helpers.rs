//! Script result projection, transaction execution, and audit/history recording.

use super::*;
use crate::error::db_error_text;
use crate::model::ScriptStatementError;

pub(super) fn statement_ok(sql: &str, affected: u64) -> ScriptStatement {
    ScriptStatement {
        sql: sql.to_string(),
        result: None,
        affected: Some(affected as i64),
        error: None,
    }
}

/// A statement without a result. `kind` is a closed script state or an
/// `AppError` kind, so the UI translates it instead of showing `message`.
pub(super) fn statement_error(
    sql: &str,
    kind: &str,
    message: String,
    position: Option<u32>,
) -> ScriptStatement {
    ScriptStatement {
        sql: sql.to_string(),
        result: None,
        affected: None,
        error: Some(ScriptStatementError {
            kind: kind.to_string(),
            message,
            position,
            sqlstate: None,
            detail: None,
            hint: None,
        }),
    }
}

/// A statement the database or executor rejected, in the same `{ kind, message,
/// position, sqlstate, detail, hint }` vocabulary a single run's `AppError` carries.
pub(super) fn statement_failed(sql: &str, error: &AppError) -> ScriptStatement {
    // The serialized error is where a driver position (original Postgres offsets
    // only) and a server error's diagnostics are resolved, so read them there
    // instead of re-deriving them.
    let wire = serde_json::to_value(error).unwrap_or_default();
    let text = |field: &str| wire.get(field)?.as_str().map(str::to_string);
    let position = wire
        .get("position")
        .and_then(serde_json::Value::as_u64)
        .and_then(|position| u32::try_from(position).ok());
    let mut statement = statement_error(sql, error.kind(), error.to_string(), position);
    if let Some(failure) = statement.error.as_mut() {
        failure.sqlstate = text("sqlstate");
        failure.detail = text("detail");
        failure.hint = text("hint");
    }
    statement
}

pub(super) fn statement_skipped(sql: &str) -> ScriptStatement {
    statement_error(
        sql,
        "skipped",
        "skipped — transaction rolled back".into(),
        None,
    )
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
/// The connection is closed instead of returned to the pool when a cancel or
/// timeout abandons the script, so the server stops it and rolls back.
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
            let begin_failed = |error: &dyn std::fmt::Display| {
                (
                    statements
                        .iter()
                        .map(|statement| {
                            statement_error(
                                statement,
                                "transactionBeginFailed",
                                format!("could not begin transaction: {error}"),
                                None,
                            )
                        })
                        .collect::<Vec<_>>(),
                    false,
                )
            };
            let mut connection =
                match crate::executor::cancel::AbandonClosingConnection::acquire($pool).await {
                    Ok(connection) => connection,
                    Err(error) => return Ok(begin_failed(&error)),
                };
            let outcome = async {
            let mut outcomes = Vec::with_capacity(statements.len());
            match sqlx::Connection::begin(&mut *connection).await {
                Ok(mut transaction) => {
                    if let Some(context) = $context {
                        if let Err(error) = sqlx::query(AssertSqlSafe(context))
                            .execute(&mut *transaction)
                            .await
                        {
                            transaction.rollback().await.map_err(|rollback| {
                                AppError::OutcomeUnknown(format!(
                                    "script namespace rollback acknowledgement failed: {}",
                                    db_error_text(&rollback)
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
                                            "optimisticConflict",
                                            format!(
                                                "optimistic concurrency conflict: expected {expected} affected row, got {affected}"
                                            ),
                                            None,
                                        ));
                                        succeeded = false;
                                        break;
                                    }
                                }
                                outcomes.push(statement_ok(statement, affected))
                            }
                            Err(error) => {
                                outcomes.push(statement_failed(
                                    statement,
                                    &AppError::from(error),
                                ));
                                succeeded = false;
                                break;
                            }
                        }
                    }
                    if !succeeded {
                        if let Err(error) = transaction.rollback().await {
                            return Err(AppError::OutcomeUnknown(format!(
                                "script rollback acknowledgement failed: {}",
                                db_error_text(&error)
                            )));
                        }
                        while outcomes.len() < statements.len() {
                            outcomes.push(statement_skipped(&statements[outcomes.len()]));
                        }
                        Ok((outcomes, false))
                    } else if let Err(error) = transaction.commit().await {
                        Err(AppError::OutcomeUnknown(format!(
                            "script commit acknowledgement failed: {}",
                            db_error_text(&error)
                        )))
                    } else {
                        Ok((outcomes, true))
                    }
                }
                Err(error) => Ok(begin_failed(&db_error_text(&error))),
            }
            }
            .await;
            // Completed (successfully or with SQL errors): reuse the connection.
            connection.release();
            outcome?
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
    /// The database and schema the console selected for the script, recorded so
    /// History reopens it there; empty means the connection's default.
    pub(super) database: &'a str,
    pub(super) namespace: Option<&'a str>,
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
                database: Some(record.database)
                    .filter(|database| !database.is_empty())
                    .map(str::to_string),
                namespace: record
                    .namespace
                    .filter(|namespace| !namespace.is_empty())
                    .map(str::to_string),
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
