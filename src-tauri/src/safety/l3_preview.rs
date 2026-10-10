//! L3 — dry-run / impact preview.
//!
//! - **Reads:** `EXPLAIN` only, never executed. Parse the row estimate + plan.
//! - **Writes:** `EXPLAIN` only. No target-mutating statement runs before the exact
//!   Operation proposal is approved and an execution grant is issued.
//! - **DDL / privilege:** no row-count preview.
//!
//! Never use `EXPLAIN ANALYZE` for a write because it executes the statement.
//!
//! A failed EXPLAIN never blocks classification; its database diagnostic is
//! carried in the report note (`EXPLAIN failed: …`) instead of looking like an
//! empty plan. PostgreSQL's JSON plan is pretty-printed for reading.

use std::time::Duration;

use sqlx::{AssertSqlSafe, Row};
use tokio::time::timeout;

use crate::error::{AppError, AppResult};
use crate::model::{Classification, PreviewMode, PreviewReport, QueryKind, SafetySettings};

use super::{PoolRef, STATEMENT_TIMEOUT_MS};

const PREVIEW_TIMEOUT: Duration = Duration::from_millis(STATEMENT_TIMEOUT_MS + 2_000);

/// Produce an impact preview for `sql`. Writes are always plan-only until a future
/// separately approved execute-preview policy is introduced.
pub async fn preview(
    pool: PoolRef<'_>,
    sql: &str,
    namespace: Option<&str>,
    classification: &Classification,
    settings: &SafetySettings,
) -> AppResult<PreviewReport> {
    if !settings.explain_preview
        && matches!(classification.kind, QueryKind::Read | QueryKind::Write)
    {
        return Ok(PreviewReport {
            mode: PreviewMode::Skipped,
            estimated_rows: None,
            plan: None,
            note: Some(
                "EXPLAIN preview is disabled in Safety settings; no database plan was requested."
                    .into(),
            ),
        });
    }

    match classification.kind {
        QueryKind::Read => {
            let (estimated_rows, plan, failure) = explain(pool, sql, namespace).await;
            Ok(PreviewReport {
                mode: PreviewMode::Explain,
                estimated_rows,
                plan,
                note: failure.map(explain_failure_note),
            })
        }

        QueryKind::Ddl | QueryKind::Privilege => Ok(PreviewReport {
            mode: PreviewMode::Skipped,
            estimated_rows: None,
            plan: None,
            note: Some(
                "DDL / privilege change — no row-count preview; review the statement directly."
                    .into(),
            ),
        }),

        QueryKind::Write => {
            // EXPLAIN (no ANALYZE) plans a write without executing it.
            let (estimated_rows, plan, failure) = explain(pool, sql, namespace).await;
            let note = failure
                .map(explain_failure_note)
                .or_else(|| {
                    estimated_rows
                        .filter(|rows| *rows > settings.exec_preview_row_limit)
                        .map(|rows| {
                            format!(
                                "EXPLAIN estimates {rows} rows, above the configured {}-row review threshold; no statement was executed",
                                settings.exec_preview_row_limit
                            )
                        })
                })
                .or_else(|| {
                    Some(
                        "EXPLAIN-only preview; no target-mutating statement was executed before approval"
                            .into(),
                    )
                });
            Ok(PreviewReport {
                mode: PreviewMode::Explain,
                estimated_rows,
                plan,
                note,
            })
        }
    }
}

/// Stable prefix the desktop recognizes to frame the database's own diagnostic.
const EXPLAIN_FAILED_NOTE: &str = "EXPLAIN failed: ";

fn explain_failure_note(failure: String) -> String {
    format!("{EXPLAIN_FAILED_NOTE}{failure}")
}

/// The database's diagnostic without driver framing.
fn sqlx_failure(error: &sqlx::Error) -> String {
    match error {
        sqlx::Error::Database(database) => database.message().to_string(),
        other => other.to_string(),
    }
}

fn app_failure(error: &AppError) -> String {
    match error {
        AppError::Db(error) => sqlx_failure(error),
        other => other.to_string(),
    }
}

const EXPLAIN_TIMED_OUT: &str = "the plan request timed out";

/// Best-effort EXPLAIN → (estimated_rows, plan text, failure). A failure is
/// non-fatal: a missing preview must not block classification, but its reason
/// is reported instead of being mistaken for an empty plan.
async fn explain(
    pool: PoolRef<'_>,
    sql: &str,
    namespace: Option<&str>,
) -> (Option<i64>, Option<String>, Option<String>) {
    match pool {
        PoolRef::Postgres(p) => {
            let q = format!("EXPLAIN (FORMAT JSON) {sql}");
            let fetched = timeout(PREVIEW_TIMEOUT, async {
                if let Some(namespace) = namespace {
                    let mut transaction = p.begin().await?;
                    let context =
                        crate::executor::namespace::postgres_search_path_statement(namespace);
                    sqlx::query(AssertSqlSafe(context))
                        .execute(&mut *transaction)
                        .await?;
                    let row = sqlx::query(AssertSqlSafe(q))
                        .fetch_one(&mut *transaction)
                        .await;
                    let _ = transaction.rollback().await;
                    row
                } else {
                    sqlx::query(AssertSqlSafe(q)).fetch_one(p).await
                }
            })
            .await;
            match fetched {
                Err(_) => (None, None, Some(EXPLAIN_TIMED_OUT.into())),
                Ok(Err(error)) => (None, None, Some(sqlx_failure(&error))),
                Ok(Ok(row)) => {
                    let v: serde_json::Value = row
                        .try_get::<serde_json::Value, _>(0)
                        .ok()
                        .or_else(|| {
                            row.try_get::<String, _>(0)
                                .ok()
                                .and_then(|s| serde_json::from_str(&s).ok())
                        })
                        .unwrap_or(serde_json::Value::Null);
                    let plan = serde_json::to_string_pretty(&v).unwrap_or_else(|_| v.to_string());
                    (find_number(&v, &["Plan Rows"]), Some(plan), None)
                }
            }
        }
        PoolRef::Mysql(p) => {
            let q = format!("EXPLAIN FORMAT=JSON {sql}");
            match timeout(PREVIEW_TIMEOUT, sqlx::query(AssertSqlSafe(q)).fetch_one(p)).await {
                Err(_) => (None, None, Some(EXPLAIN_TIMED_OUT.into())),
                Ok(Err(error)) => (None, None, Some(sqlx_failure(&error))),
                Ok(Ok(row)) => match row.try_get::<String, _>(0) {
                    Ok(s) => {
                        let v: serde_json::Value =
                            serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
                        let est = find_number(
                            &v,
                            &["rows_produced_per_join", "rows_examined_per_scan", "rows"],
                        );
                        (est, Some(s), None)
                    }
                    Err(error) => (None, None, Some(sqlx_failure(&error))),
                },
            }
        }
        PoolRef::Sqlite(p) => {
            let q = format!("EXPLAIN QUERY PLAN {sql}");
            match timeout(PREVIEW_TIMEOUT, sqlx::query(AssertSqlSafe(q)).fetch_all(p)).await {
                Err(_) => (None, None, Some(EXPLAIN_TIMED_OUT.into())),
                Ok(Err(error)) => (None, None, Some(sqlx_failure(&error))),
                Ok(Ok(rows)) => {
                    // Columns: id, parent, notused, detail. No row estimate available.
                    let plan = rows
                        .iter()
                        .filter_map(|r| r.try_get::<String, _>(3).ok())
                        .collect::<Vec<_>>()
                        .join("\n");
                    (None, Some(plan), None)
                }
            }
        }
        PoolRef::Bigquery(connection) => {
            match timeout(PREVIEW_TIMEOUT, connection.dry_run_bytes(sql)).await {
                Err(_) => (None, None, Some(EXPLAIN_TIMED_OUT.into())),
                Ok(Err(error)) => (None, None, Some(app_failure(&error))),
                Ok(Ok(bytes)) => (
                    None,
                    bytes.map(|value| format!("BigQuery dry-run: {value} bytes processed")),
                    None,
                ),
            }
        }
        PoolRef::CloudflareD1(connection) => {
            match timeout(
                PREVIEW_TIMEOUT,
                connection.query(&format!("EXPLAIN QUERY PLAN {sql}"), 1_000),
            )
            .await
            {
                Err(_) => (None, None, Some(EXPLAIN_TIMED_OUT.into())),
                Ok(Err(error)) => (None, None, Some(app_failure(&error))),
                Ok(Ok(result)) => {
                    let plan = result
                        .rows
                        .into_iter()
                        .filter_map(|row| row.get(3).cloned())
                        .map(|value| match value {
                            serde_json::Value::String(value) => value,
                            other => other.to_string(),
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    (None, Some(plan), None)
                }
            }
        }
    }
}

/// Recursively find the first value for any of `keys`, coercing to i64.
fn find_number(v: &serde_json::Value, keys: &[&str]) -> Option<i64> {
    match v {
        serde_json::Value::Object(m) => {
            for k in keys {
                if let Some(n) = m.get(*k).and_then(as_i64) {
                    return Some(n);
                }
            }
            m.values().find_map(|vv| find_number(vv, keys))
        }
        serde_json::Value::Array(a) => a.iter().find_map(|vv| find_number(vv, keys)),
        _ => None,
    }
}

fn as_i64(v: &serde_json::Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_f64().map(|f| f as i64))
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}
