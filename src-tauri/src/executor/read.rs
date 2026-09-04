//! Read path (L2 read-only pool). Executes a `SELECT` against the connection's
//! read-only, L2-enforced pool and maps rows dynamically to JSON.
//!
//! sqlx has no single dynamic-row API across engines (PgRow/MySqlRow/SqliteRow
//! carry different `Column`/`TypeInfo` types), so the per-engine mappers below
//! are unavoidable duplication rather than a missing abstraction. The mappers and
//! [`stream_capped`] are `pub(crate)` and reused by `safety::l2_enforce` so all
//! read paths decode a cell identically.

use std::future::Future;
use std::time::Instant;

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures::TryStreamExt;
use serde_json::Value;
use sqlx::mysql::types::{MySqlTime, MySqlTimeSign};
use sqlx::mysql::MySqlRow;
use sqlx::postgres::types::{Oid, PgInterval, PgMoney, PgRange, PgTimeTz};
use sqlx::postgres::{PgRow, PgTypeKind};
use sqlx::sqlite::SqliteRow;
use sqlx::types::Decimal;
use sqlx::{AssertSqlSafe, Column, Executor, Row, SqlSafeStr, TypeInfo, ValueRef};
use uuid::Uuid;

// PG-only decoders enabled via confirmed, TLS-agnostic sqlx features (see Cargo.toml).
use sqlx::types::ipnetwork::IpNetwork;
use sqlx::types::mac_address::MacAddress;
use sqlx::types::BitVec;

use crate::connection::{LiveConnection, Pool};
use crate::error::{AppError, AppResult};
use crate::executor::cancel;
use crate::model::{Engine, QueryResult};

#[path = "read_values.rs"]
mod values;

pub(crate) use values::{int_json, mysql_value, pg_value, sqlite_value, uint_json};

/// A row-bearing desktop page must remain small enough for a direct IPC callback.
/// This is intentionally below Tauri's 8KiB fetch-queue threshold only for the
/// notification path; row pages are pulled separately by the feature adapter.
pub(crate) const DESKTOP_STREAM_BATCH_MAX_BYTES: usize = 512 * 1024;
// Reserve envelope/column/identity JSON space before the adapter validates the
// exact serialized `DesktopSqlStreamBatch`; pathological metadata still fails
// closed at that boundary instead of retaining an oversized page.
const DESKTOP_STREAM_ROW_BUDGET_BYTES: usize = DESKTOP_STREAM_BATCH_MAX_BYTES - 4 * 1024;

/// A bounded decoded page emitted by the desktop-only streaming query path.
/// The producer never retains prior pages; a receiver that rejects a page aborts
/// the cursor through the normal cancellation/timeout guard.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReadBatch {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

/// Summary retained after a streamed read. Result rows intentionally never enter
/// operation/history/audit state or the final IPC receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StreamedRead {
    pub columns: Vec<String>,
    pub row_count: usize,
    pub truncated: bool,
    pub duration_ms: u64,
    pub first_row_ms: Option<u64>,
}

pub(crate) struct StreamedReadRequest<'a> {
    pub(crate) live: &'a LiveConnection,
    pub(crate) engine: Engine,
    pub(crate) sql: &'a str,
    pub(crate) namespace: Option<String>,
    pub(crate) max_rows: u64,
    pub(crate) batch_rows: usize,
    pub(crate) cancellation: Option<&'a cancel::CancelHandle>,
}

/// Desktop streaming read with an application-owned bounded batch size. This is
/// deliberately separate from [`run_read_registered`], whose bounded execution
/// contract returns a materialized `QueryResult`.
pub(crate) async fn run_read_streamed_registered<F, Fut>(
    request: StreamedReadRequest<'_>,
    mut on_batch: F,
) -> AppResult<StreamedRead>
where
    F: FnMut(ReadBatch) -> Fut + Send,
    Fut: Future<Output = AppResult<()>> + Send,
{
    let StreamedReadRequest {
        live,
        engine: _engine,
        sql,
        namespace,
        max_rows,
        batch_rows,
        cancellation,
    } = request;
    let started = Instant::now();
    // The adapter contract is an absolute producer guarantee, not a caller
    // preference: no caller can request an oversized page.
    let batch_rows = batch_rows.clamp(1, 256);
    let max = max_rows as usize;
    if let Pool::Bigquery(connection) = &live.read_pool {
        let result = connection.query(sql, max_rows, cancellation).await?;
        let columns = result.columns.clone();
        let row_count = result.rows.len();
        let first_row_ms = (!result.rows.is_empty()).then(|| started.elapsed().as_millis() as u64);
        let mut batch = Vec::with_capacity(batch_rows);
        let mut batch_bytes = 0usize;
        for row in result.rows {
            let row_bytes = serde_json::to_vec(&row)?.len();
            if row_bytes > DESKTOP_STREAM_ROW_BUDGET_BYTES {
                return Err(AppError::Blocked {
                    reason: "one streamed result row exceeds the 512 KiB batch safety limit".into(),
                });
            }
            if !batch.is_empty()
                && batch_bytes.saturating_add(row_bytes) > DESKTOP_STREAM_ROW_BUDGET_BYTES
            {
                on_batch(ReadBatch {
                    columns: columns.clone(),
                    rows: std::mem::take(&mut batch),
                })
                .await?;
                batch = Vec::with_capacity(batch_rows);
                batch_bytes = 0;
            }
            batch_bytes += row_bytes;
            batch.push(row);
            if batch.len() == batch_rows {
                on_batch(ReadBatch {
                    columns: columns.clone(),
                    rows: std::mem::take(&mut batch),
                })
                .await?;
                batch = Vec::with_capacity(batch_rows);
                batch_bytes = 0;
            }
        }
        if !batch.is_empty() || row_count == 0 {
            on_batch(ReadBatch {
                columns: columns.clone(),
                rows: batch,
            })
            .await?;
        }
        return Ok(StreamedRead {
            columns,
            row_count,
            truncated: result.truncated,
            duration_ms: started.elapsed().as_millis() as u64,
            first_row_ms,
        });
    }
    let inner = async {
        let (columns, row_count, truncated, first_row_ms) = match &live.read_pool {
            Pool::Postgres(pool) => {
                if let Some(namespace) = namespace.as_deref() {
                    let mut transaction = pool.begin().await?;
                    let context =
                        crate::executor::namespace::postgres_search_path_statement(namespace);
                    sqlx::query(AssertSqlSafe(context))
                        .execute(&mut *transaction)
                        .await?;
                    let (columns, row_count, truncated, first_row_ms) = stream_batched(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *transaction),
                        max,
                        batch_rows,
                        pg_value,
                        started,
                        &mut on_batch,
                    )
                    .await?;
                    let columns = if columns.is_empty() {
                        (&mut *transaction)
                            .describe(AssertSqlSafe(sql).into_sql_str())
                            .await
                            .ok()
                            .map(describe_cols)
                            .unwrap_or_default()
                    } else {
                        columns
                    };
                    transaction.rollback().await?;
                    (columns, row_count, truncated, first_row_ms)
                } else {
                    let (columns, row_count, truncated, first_row_ms) = stream_batched(
                        sqlx::query(AssertSqlSafe(sql)).fetch(pool),
                        max,
                        batch_rows,
                        pg_value,
                        started,
                        &mut on_batch,
                    )
                    .await?;
                    (
                        with_headers(columns, pool, sql).await,
                        row_count,
                        truncated,
                        first_row_ms,
                    )
                }
            }
            Pool::Mysql(pool) => {
                let (columns, row_count, truncated, first_row_ms) = stream_batched(
                    sqlx::query(AssertSqlSafe(sql)).fetch(pool),
                    max,
                    batch_rows,
                    mysql_value,
                    started,
                    &mut on_batch,
                )
                .await?;
                (
                    with_headers(columns, pool, sql).await,
                    row_count,
                    truncated,
                    first_row_ms,
                )
            }
            Pool::Sqlite(pool) => {
                let (columns, row_count, truncated, first_row_ms) = stream_batched(
                    sqlx::query(AssertSqlSafe(sql)).fetch(pool),
                    max,
                    batch_rows,
                    sqlite_value,
                    started,
                    &mut on_batch,
                )
                .await?;
                (
                    with_headers(columns, pool, sql).await,
                    row_count,
                    truncated,
                    first_row_ms,
                )
            }
            Pool::Bigquery(_) => unreachable!("BigQuery is handled before the SQLx stream"),
        };
        // Keep zero-row metadata inside the same cancellation/timeout envelope as
        // cursor iteration. It must also become a page so renderers can build an
        // empty grid with the real column names.
        if row_count == 0 {
            on_batch(ReadBatch {
                columns: columns.clone(),
                rows: Vec::new(),
            })
            .await?;
        }
        Ok::<_, AppError>((columns, row_count, truncated, first_row_ms))
    };
    let (columns, row_count, truncated, first_row_ms) =
        cancel::guard_registered(cancellation, cancel::QUERY_TIMEOUT, inner).await?;
    Ok(StreamedRead {
        columns,
        row_count,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
        first_row_ms,
    })
}

/// Run a read (`SELECT`/`EXPLAIN`) against the read-only pool (L2). Streams rows,
/// caps at `max_rows` (setting `truncated` when more exist), maps values by type.
/// `query_id` (if set) makes the read cancellable via [`cancel::cancel_query`]; the
/// whole read is also bounded by a wall-clock timeout.
pub async fn run_read(
    live: &LiveConnection,
    _engine: Engine, // pool enum is self-describing; kept to honor the executor contract
    sql: &str,
    namespace: Option<String>,
    max_rows: u64,
    query_id: Option<Uuid>,
) -> AppResult<QueryResult> {
    let cancellation = query_id.map(cancel::register);
    run_read_registered(
        live,
        _engine,
        sql,
        namespace,
        max_rows,
        cancellation.as_ref(),
    )
    .await
}

/// Job-engine read path: retain no more than `max_bytes` of decoded rows per
/// batch while preserving the same typed cell decoding and read-only session.
pub(crate) async fn run_read_byte_capped(
    live: &LiveConnection,
    _engine: Engine,
    sql: &str,
    max_rows: u64,
    max_bytes: usize,
    query_id: Option<Uuid>,
) -> AppResult<QueryResult> {
    let started = Instant::now();
    let cancellation = query_id.map(cancel::register);
    if let Pool::Bigquery(connection) = &live.read_pool {
        return connection
            .query_byte_capped(sql, max_rows, max_bytes, cancellation.as_ref())
            .await;
    }
    let max = max_rows as usize;
    let inner = async {
        let (columns, rows, truncated) = match &live.read_pool {
            Pool::Postgres(pool) => {
                let (columns, rows, truncated) = stream_byte_capped(
                    sqlx::query(AssertSqlSafe(sql)).fetch(pool),
                    max,
                    max_bytes,
                    pg_value,
                )
                .await?;
                (with_headers(columns, pool, sql).await, rows, truncated)
            }
            Pool::Mysql(pool) => {
                let (columns, rows, truncated) = stream_byte_capped(
                    sqlx::query(AssertSqlSafe(sql)).fetch(pool),
                    max,
                    max_bytes,
                    mysql_value,
                )
                .await?;
                (with_headers(columns, pool, sql).await, rows, truncated)
            }
            Pool::Sqlite(pool) => {
                let (columns, rows, truncated) = stream_byte_capped(
                    sqlx::query(AssertSqlSafe(sql)).fetch(pool),
                    max,
                    max_bytes,
                    sqlite_value,
                )
                .await?;
                (with_headers(columns, pool, sql).await, rows, truncated)
            }
            Pool::Bigquery(_) => unreachable!("BigQuery is handled before the SQLx stream"),
        };
        Ok(QueryResult {
            row_count: rows.len(),
            columns,
            rows,
            truncated,
            duration_ms: 0,
        })
    };
    let mut result =
        cancel::guard_registered(cancellation.as_ref(), cancel::QUERY_TIMEOUT, inner).await?;
    result.duration_ms = started.elapsed().as_millis() as u64;
    Ok(result)
}

/// Execute through a cancellation slot registered before the caller's durable
/// operation claim, so an immediate cancel cannot be replaced by a second slot.
pub(crate) async fn run_read_registered(
    live: &LiveConnection,
    _engine: Engine,
    sql: &str,
    namespace: Option<String>,
    max_rows: u64,
    cancellation: Option<&cancel::CancelHandle>,
) -> AppResult<QueryResult> {
    let started = Instant::now();
    let max = max_rows as usize;

    if let Pool::Bigquery(connection) = &live.read_pool {
        return connection.query(sql, max_rows, cancellation).await;
    }

    // ponytail: read_pool is the L2-enforced pool; reads never touch mutation authority.
    let inner = async {
        let (columns, rows, truncated) = match &live.read_pool {
            Pool::Postgres(pool) => {
                if let Some(namespace) = namespace.as_deref() {
                    let mut transaction = pool.begin().await?;
                    let context =
                        crate::executor::namespace::postgres_search_path_statement(namespace);
                    sqlx::query(AssertSqlSafe(context))
                        .execute(&mut *transaction)
                        .await?;
                    let (columns, rows, truncated) = stream_capped(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *transaction),
                        max,
                        pg_value,
                    )
                    .await?;
                    let columns = if columns.is_empty() {
                        (&mut *transaction)
                            .describe(AssertSqlSafe(sql).into_sql_str())
                            .await
                            .ok()
                            .map(describe_cols)
                            .unwrap_or_default()
                    } else {
                        columns
                    };
                    transaction.rollback().await?;
                    (columns, rows, truncated)
                } else {
                    let (c, r, t) =
                        stream_capped(sqlx::query(AssertSqlSafe(sql)).fetch(pool), max, pg_value)
                            .await?;
                    (with_headers(c, pool, sql).await, r, t)
                }
            }
            Pool::Mysql(pool) => {
                let (c, r, t) = stream_capped(
                    sqlx::query(AssertSqlSafe(sql)).fetch(pool),
                    max,
                    mysql_value,
                )
                .await?;
                (with_headers(c, pool, sql).await, r, t)
            }
            Pool::Sqlite(pool) => {
                let (c, r, t) = stream_capped(
                    sqlx::query(AssertSqlSafe(sql)).fetch(pool),
                    max,
                    sqlite_value,
                )
                .await?;
                (with_headers(c, pool, sql).await, r, t)
            }
            Pool::Bigquery(_) => unreachable!("BigQuery is handled before the SQLx stream"),
        };
        Ok::<_, AppError>(QueryResult {
            row_count: rows.len(),
            columns,
            rows,
            truncated,
            duration_ms: 0,
        })
    };

    let mut result = cancel::guard_registered(cancellation, cancel::QUERY_TIMEOUT, inner).await?;
    result.duration_ms = started.elapsed().as_millis() as u64;
    Ok(result)
}

/// Columns from the first row are empty when zero rows come back; fall back to the
/// prepared-statement metadata (`describe`) so an empty result still has headers.
async fn with_headers<'e, E>(cols: Vec<String>, ex: E, sql: &str) -> Vec<String>
where
    E: Executor<'e>,
{
    if cols.is_empty() {
        ex.describe(AssertSqlSafe(sql).into_sql_str())
            .await
            .ok()
            .map(describe_cols)
            .unwrap_or_default()
    } else {
        cols
    }
}

/// Column names from statement metadata (used for zero-row headers).
pub(crate) fn describe_cols<DB: sqlx::Database>(d: sqlx::Describe<DB>) -> Vec<String> {
    d.columns().iter().map(|c| c.name().to_string()).collect()
}

/// Stream rows to JSON, capping at `max` (fetch stops one past the cap → `truncated`),
/// so memory is bounded regardless of result size. Column names come from the first
/// row; a zero-row stream returns empty columns (caller fills from `describe`).
pub(crate) async fn stream_capped<S, R>(
    mut stream: S,
    max: usize,
    f: impl Fn(&R, usize) -> Value,
) -> Result<(Vec<String>, Vec<Vec<Value>>, bool), sqlx::Error>
where
    S: futures::Stream<Item = Result<R, sqlx::Error>> + Unpin,
    R: Row,
{
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut truncated = false;
    while let Some(row) = stream.try_next().await? {
        if columns.is_empty() {
            columns = row.columns().iter().map(|c| c.name().to_string()).collect();
        }
        if rows.len() >= max {
            truncated = true; // one row past the cap exists → more rows remain
            break;
        }
        let n = row.columns().len();
        rows.push((0..n).map(|i| f(&row, i)).collect());
    }
    Ok((columns, rows, truncated))
}

pub(crate) async fn stream_batched<S, R, F, Fut>(
    mut stream: S,
    max_rows: usize,
    batch_rows: usize,
    decode: impl Fn(&R, usize) -> Value,
    started: Instant,
    on_batch: &mut F,
) -> AppResult<(Vec<String>, usize, bool, Option<u64>)>
where
    S: futures::Stream<Item = Result<R, sqlx::Error>> + Unpin,
    R: Row,
    F: FnMut(ReadBatch) -> Fut + Send,
    Fut: Future<Output = AppResult<()>> + Send,
{
    // `stream_batched` also backs the benchmark and direct executor tests, so
    // keep the same cap at the primitive rather than relying on its caller.
    let batch_rows = batch_rows.clamp(1, 256);
    let mut columns = Vec::new();
    let mut batch = Vec::with_capacity(batch_rows);
    let mut batch_bytes = 0_usize;
    let mut row_count = 0_usize;
    let mut truncated = false;
    let mut first_row_ms = None;
    while let Some(row) = stream.try_next().await? {
        first_row_ms.get_or_insert_with(|| started.elapsed().as_millis() as u64);
        if columns.is_empty() {
            columns = row
                .columns()
                .iter()
                .map(|column| column.name().to_owned())
                .collect();
        }
        if row_count >= max_rows {
            truncated = true;
            break;
        }
        let decoded = (0..row.columns().len())
            .map(|index| decode(&row, index))
            .collect::<Vec<_>>();
        let row_bytes = serde_json::to_vec(&decoded)?.len();
        if row_bytes > DESKTOP_STREAM_ROW_BUDGET_BYTES {
            return Err(AppError::Blocked {
                reason: "one streamed result row exceeds the 512 KiB batch safety limit".into(),
            });
        }
        if !batch.is_empty()
            && batch_bytes.saturating_add(row_bytes) > DESKTOP_STREAM_ROW_BUDGET_BYTES
        {
            on_batch(ReadBatch {
                columns: columns.clone(),
                rows: std::mem::take(&mut batch),
            })
            .await?;
            batch = Vec::with_capacity(batch_rows);
            batch_bytes = 0;
        }
        batch_bytes += row_bytes;
        batch.push(decoded);
        row_count += 1;
        if batch.len() == batch_rows {
            on_batch(ReadBatch {
                columns: columns.clone(),
                rows: std::mem::take(&mut batch),
            })
            .await?;
            batch = Vec::with_capacity(batch_rows);
            batch_bytes = 0;
        }
    }
    if !batch.is_empty() {
        on_batch(ReadBatch {
            columns: columns.clone(),
            rows: batch,
        })
        .await?;
    }
    Ok((columns, row_count, truncated, first_row_ms))
}

pub(crate) async fn stream_byte_capped<S, R>(
    mut stream: S,
    max_rows: usize,
    max_bytes: usize,
    decode: impl Fn(&R, usize) -> Value,
) -> AppResult<(Vec<String>, Vec<Vec<Value>>, bool)>
where
    S: futures::Stream<Item = Result<R, sqlx::Error>> + Unpin,
    R: Row,
{
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut retained_bytes = 0_usize;
    let mut truncated = false;
    while let Some(row) = stream.try_next().await? {
        if columns.is_empty() {
            columns = row
                .columns()
                .iter()
                .map(|column| column.name().to_owned())
                .collect();
        }
        if rows.len() >= max_rows {
            truncated = true;
            break;
        }
        let decoded = (0..row.columns().len())
            .map(|index| decode(&row, index))
            .collect::<Vec<_>>();
        let row_bytes = serde_json::to_vec(&decoded)?.len();
        if row_bytes > max_bytes {
            return Err(AppError::Blocked {
                reason: format!(
                    "one export row exceeds the {} MiB batch safety limit",
                    max_bytes / 1024 / 1024
                ),
            });
        }
        if retained_bytes.saturating_add(row_bytes) > max_bytes {
            truncated = true;
            break;
        }
        retained_bytes += row_bytes;
        rows.push(decoded);
    }
    Ok((columns, rows, truncated))
}
