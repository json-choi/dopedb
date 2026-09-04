//! L3 — dry-run / impact preview.
//!
//! - **Reads:** `EXPLAIN` only, never executed. Parse the row estimate + plan.
//! - **Writes:** `EXPLAIN` only. No target-mutating statement runs before the exact
//!   Operation proposal is approved and an execution grant is issued.
//! - **DDL / privilege:** no row-count preview.
//!
//! Never use `EXPLAIN ANALYZE` for a write because it executes the statement.

use std::time::Duration;

use sqlx::{AssertSqlSafe, Row};
use tokio::time::timeout;

use crate::error::AppResult;
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
            let (estimated_rows, plan) = explain(pool, sql, namespace).await;
            Ok(PreviewReport {
                mode: PreviewMode::Explain,
                estimated_rows,
                plan,
                note: None,
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
            let (estimated_rows, plan) = explain(pool, sql, namespace).await;
            let note = estimated_rows
                .filter(|rows| *rows > settings.exec_preview_row_limit)
                .map(|rows| {
                    format!(
                        "EXPLAIN estimates {rows} rows, above the configured {}-row review threshold; no statement was executed",
                        settings.exec_preview_row_limit
                    )
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

/// Best-effort EXPLAIN → (estimated_rows, plan text). Failures are non-fatal
/// (returns `(None, None)`): a missing preview must not block classification.
async fn explain(
    pool: PoolRef<'_>,
    sql: &str,
    namespace: Option<&str>,
) -> (Option<i64>, Option<String>) {
    let out = match pool {
        PoolRef::Postgres(p) => {
            let q = format!("EXPLAIN (FORMAT JSON) {sql}");
            timeout(PREVIEW_TIMEOUT, async {
                if let Some(namespace) = namespace {
                    let mut transaction = p.begin().await.ok()?;
                    let context =
                        crate::executor::namespace::postgres_search_path_statement(namespace);
                    sqlx::query(AssertSqlSafe(context))
                        .execute(&mut *transaction)
                        .await
                        .ok()?;
                    let row = sqlx::query(AssertSqlSafe(q))
                        .fetch_one(&mut *transaction)
                        .await
                        .ok();
                    let _ = transaction.rollback().await;
                    row
                } else {
                    sqlx::query(AssertSqlSafe(q)).fetch_one(p).await.ok()
                }
            })
            .await
            .ok()
            .flatten()
            .map(|row| {
                let v: serde_json::Value = row
                    .try_get::<serde_json::Value, _>(0)
                    .ok()
                    .or_else(|| {
                        row.try_get::<String, _>(0)
                            .ok()
                            .and_then(|s| serde_json::from_str(&s).ok())
                    })
                    .unwrap_or(serde_json::Value::Null);
                (find_number(&v, &["Plan Rows"]), Some(v.to_string()))
            })
        }
        PoolRef::Mysql(p) => {
            let q = format!("EXPLAIN FORMAT=JSON {sql}");
            timeout(PREVIEW_TIMEOUT, sqlx::query(AssertSqlSafe(q)).fetch_one(p))
                .await
                .ok()
                .and_then(|r| r.ok())
                .and_then(|row| row.try_get::<String, _>(0).ok())
                .map(|s| {
                    let v: serde_json::Value =
                        serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
                    let est = find_number(
                        &v,
                        &["rows_produced_per_join", "rows_examined_per_scan", "rows"],
                    );
                    (est, Some(s))
                })
        }
        PoolRef::Sqlite(p) => {
            let q = format!("EXPLAIN QUERY PLAN {sql}");
            timeout(PREVIEW_TIMEOUT, sqlx::query(AssertSqlSafe(q)).fetch_all(p))
                .await
                .ok()
                .and_then(|r| r.ok())
                .map(|rows| {
                    // Columns: id, parent, notused, detail. No row estimate available.
                    let plan = rows
                        .iter()
                        .filter_map(|r| r.try_get::<String, _>(3).ok())
                        .collect::<Vec<_>>()
                        .join("\n");
                    (None, Some(plan))
                })
        }
        PoolRef::Bigquery(connection) => timeout(PREVIEW_TIMEOUT, connection.dry_run_bytes(sql))
            .await
            .ok()
            .and_then(Result::ok)
            .map(|bytes| {
                let estimated_rows = None;
                let plan = bytes.map(|value| format!("BigQuery dry-run: {value} bytes processed"));
                (estimated_rows, plan)
            }),
    };
    out.unwrap_or((None, None))
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
