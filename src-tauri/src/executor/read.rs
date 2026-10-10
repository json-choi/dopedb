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

use chrono::FixedOffset;
use futures::TryStreamExt;
use serde_json::Value;
use sqlx::mysql::types::{MySqlTime, MySqlTimeSign};
use sqlx::mysql::MySqlRow;
use sqlx::postgres::types::PgInterval;
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
use crate::model::{CellDecodeFailure, Engine, QueryResult};

#[path = "read_page_budget.rs"]
mod page_budget;
#[path = "read_session.rs"]
mod session;
#[path = "read_values.rs"]
mod values;

pub(crate) use page_budget::TRUNCATED_CELL_TYPE_PREFIX;
use page_budget::{fit_row_to_page, json_size, page_row_budget};
pub(crate) use session::{mysql_session_facts, pg_session_facts};

pub(crate) use values::{
    int_json, mysql_value_in, pg_value_in, sqlite_value, uint_json, SessionFacts,
};

/// Read-path invariants: the PostgreSQL wire decoders (see `read_pg_wire`), and
/// which reads open their own read-only transaction.
#[cfg(test)]
pub(crate) fn assert_decoder_contract() {
    values::assert_decoder_contract();
    // A plain read keeps the no-extra-round-trip path; a namespace or a transaction
    // pooler reads inside `BEGIN READ ONLY … ROLLBACK`, never under a session `SET`.
    assert_eq!(pg_read_scope(None, false), None);
    assert_eq!(
        pg_read_scope(None, true).as_deref(),
        Some("BEGIN READ ONLY")
    );
    for pooler in [false, true] {
        assert_eq!(
            pg_read_scope(Some("app"), pooler).as_deref(),
            Some("BEGIN READ ONLY; SET LOCAL search_path TO \"app\"")
        );
    }
}

/// Columns from the first row are empty when zero rows come back; fall back to the
/// prepared-statement metadata (`describe`) on the same connection so an empty result
/// still has headers. The executor stays a concrete `&mut` connection: a generic
/// `Executor<'e>` helper here defeats the `Send` proof of the desktop command futures.
macro_rules! with_headers {
    ($cols:expr, $connection:expr, $sql:expr) => {{
        let cols: Vec<String> = $cols;
        if cols.is_empty() {
            ($connection)
                .describe(AssertSqlSafe($sql).into_sql_str())
                .await
                .ok()
                .map(describe_cols)
                .unwrap_or_default()
        } else {
            cols
        }
    }};
}

/// The one simple-protocol message that opens a PostgreSQL read's own read-only
/// transaction, when it needs one: a namespace is scoped with `SET LOCAL`, and a
/// transaction-mode pooler carries no session default (a session `SET` would leak
/// to its other clients), so its reads always run inside `BEGIN READ ONLY`. Any
/// other read runs on the L2 session directly, with no extra round trip.
fn pg_read_scope(namespace: Option<&str>, transaction_pooler: bool) -> Option<String> {
    match namespace {
        Some(namespace) => Some(format!(
            "BEGIN READ ONLY; {}",
            crate::executor::namespace::postgres_search_path_statement(namespace)
        )),
        None => transaction_pooler.then(|| "BEGIN READ ONLY".to_string()),
    }
}

/// Ends a scoped read's transaction with `ROLLBACK` when its session can be reused:
/// after a complete result, or after a server error, which already ended the
/// statement (the session then waits only for this `ROLLBACK`). A capped read or
/// any other failure may have stopped mid-result, so its transaction is left for
/// [`finish_read`] to close with the connection. Returns whether it is still open.
async fn end_pg_read_scope<T>(
    connection: &mut sqlx::PgConnection,
    outcome: &mut AppResult<T>,
    truncated: impl FnOnce(&T) -> bool,
) -> bool {
    let reusable = match &*outcome {
        Ok(read) => !truncated(read),
        Err(AppError::Db(sqlx::Error::Database(_))) => true,
        Err(_) => false,
    };
    if !reusable {
        return true;
    }
    match sqlx::raw_sql("ROLLBACK").execute(connection).await {
        Ok(_) => false,
        Err(error) => {
            // A server error keeps its own diagnostic; a finished read reports
            // that its transaction could not be closed.
            if outcome.is_ok() {
                *outcome = Err(error.into());
            }
            true
        }
    }
}

/// Returns a finished read's connection to the pool only when its session is idle.
/// A capped read stops with unread rows (and, when scoped, an open read-only
/// transaction): draining them would transfer the rest of the result, so the
/// connection is closed instead (dropping it closes it). Any failure that may have
/// stopped mid-result, or one that left a transaction open, closes it too; a
/// server error with no transaction left open leaves the session ready for reuse.
fn finish_read<DB: sqlx::Database, T>(
    connection: cancel::AbandonClosingConnection<DB>,
    outcome: &AppResult<T>,
    truncated: impl FnOnce(&T) -> bool,
    in_transaction: bool,
) {
    let idle = match outcome {
        Ok(read) => !truncated(read),
        Err(AppError::Db(sqlx::Error::Database(_))) => !in_transaction,
        Err(_) => false,
    };
    if idle {
        connection.release();
    }
}

/// A row-bearing desktop page must remain small enough for a direct IPC callback.
/// This is intentionally below Tauri's 8KiB fetch-queue threshold only for the
/// notification path; row pages are pulled separately by the feature adapter.
pub(crate) const DESKTOP_STREAM_BATCH_MAX_BYTES: usize = 512 * 1024;

/// A bounded decoded page emitted by the desktop-only streaming query path.
/// The producer never retains prior pages; a receiver that rejects a page aborts
/// the cursor through the normal cancellation/timeout guard.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReadBatch {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub decode_failures: Vec<CellDecodeFailure>,
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
    let materialized = match &live.read_pool {
        Pool::Bigquery(connection) => Some(connection.query(sql, max_rows, cancellation).await?),
        Pool::CloudflareD1(connection) => Some(connection.query(sql, max_rows).await?),
        _ => None,
    };
    if let Some(result) = materialized {
        return page_budget::stream_materialized(result, batch_rows, started, &mut on_batch).await;
    }
    let inner = async {
        let (columns, row_count, truncated, first_row_ms) = match &live.read_pool {
            Pool::Postgres(pool) => {
                let mut connection = cancel::AbandonClosingConnection::acquire(pool).await?;
                let scope = pg_read_scope(namespace.as_deref(), live.transaction_pooler);
                let mut outcome = async {
                    let facts = pg_session_facts(pool, &mut connection).await;
                    let decode =
                        |row: &PgRow, index: usize| values::pg_value_in(row, index, &facts);
                    if let Some(scope) = scope.as_deref() {
                        sqlx::raw_sql(AssertSqlSafe(scope))
                            .execute(&mut *connection)
                            .await?;
                    }
                    let (columns, row_count, truncated, first_row_ms) = stream_batched(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *connection),
                        max,
                        batch_rows,
                        decode,
                        started,
                        &mut on_batch,
                    )
                    .await?;
                    let columns = with_headers!(columns, &mut *connection, sql);
                    Ok::<_, AppError>((columns, row_count, truncated, first_row_ms))
                }
                .await;
                let open = scope.is_some()
                    && end_pg_read_scope(&mut connection, &mut outcome, |read| read.2).await;
                finish_read(connection, &outcome, |read| read.2, open);
                outcome?
            }
            Pool::Mysql(pool) => {
                let mut connection = cancel::AbandonClosingConnection::acquire(pool).await?;
                let outcome = async {
                    let facts = mysql_session_facts(pool, &mut connection).await;
                    let (columns, row_count, truncated, first_row_ms) = stream_batched(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *connection),
                        max,
                        batch_rows,
                        |row: &MySqlRow, index: usize| values::mysql_value_in(row, index, &facts),
                        started,
                        &mut on_batch,
                    )
                    .await?;
                    Ok::<_, AppError>((
                        with_headers!(columns, &mut *connection, sql),
                        row_count,
                        truncated,
                        first_row_ms,
                    ))
                }
                .await;
                finish_read(connection, &outcome, |read| read.2, false);
                outcome?
            }
            Pool::Sqlite(pool) => {
                let mut connection = cancel::AbandonClosingConnection::acquire(pool).await?;
                let outcome = async {
                    let (columns, row_count, truncated, first_row_ms) = stream_batched(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *connection),
                        max,
                        batch_rows,
                        sqlite_value,
                        started,
                        &mut on_batch,
                    )
                    .await?;
                    Ok::<_, AppError>((
                        with_headers!(columns, &mut *connection, sql),
                        row_count,
                        truncated,
                        first_row_ms,
                    ))
                }
                .await;
                connection.release();
                outcome?
            }
            Pool::Bigquery(_) | Pool::CloudflareD1(_) => {
                unreachable!("remote CLI engines are handled before the SQLx stream")
            }
        };
        // Keep zero-row metadata inside the same cancellation/timeout envelope as
        // cursor iteration. It must also become a page so renderers can build an
        // empty grid with the real column names.
        if row_count == 0 {
            on_batch(ReadBatch {
                columns: columns.clone(),
                rows: Vec::new(),
                decode_failures: Vec::new(),
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
    match &live.read_pool {
        Pool::Bigquery(connection) => {
            return connection
                .query_byte_capped(sql, max_rows, max_bytes, cancellation.as_ref())
                .await;
        }
        Pool::CloudflareD1(connection) => {
            let mut result = connection.query(sql, max_rows).await?;
            let mut retained_bytes = 0_usize;
            let mut rows = Vec::with_capacity(result.rows.len());
            for row in result.rows {
                let row_bytes = serde_json::to_vec(&row)?.len();
                if row_bytes > max_bytes {
                    return Err(AppError::Blocked {
                        reason: format!(
                            "one export row exceeds the {} MiB batch safety limit",
                            max_bytes / 1024 / 1024
                        ),
                    });
                }
                if retained_bytes.saturating_add(row_bytes) > max_bytes {
                    result.truncated = true;
                    break;
                }
                retained_bytes += row_bytes;
                rows.push(row);
            }
            result.row_count = rows.len();
            result.rows = rows;
            result.duration_ms = started.elapsed().as_millis() as u64;
            return Ok(result);
        }
        _ => {}
    }
    let max = max_rows as usize;
    let inner = async {
        let (columns, rows, decode_failures, truncated) = match &live.read_pool {
            Pool::Postgres(pool) => {
                let mut connection = cancel::AbandonClosingConnection::acquire(pool).await?;
                // A job read has no namespace; a transaction pooler still needs its
                // own read-only transaction.
                let scope = pg_read_scope(None, live.transaction_pooler);
                let mut outcome = async {
                    let facts = pg_session_facts(pool, &mut connection).await;
                    if let Some(scope) = scope.as_deref() {
                        sqlx::raw_sql(AssertSqlSafe(scope))
                            .execute(&mut *connection)
                            .await?;
                    }
                    let (columns, rows, decode_failures, truncated) = stream_byte_capped(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *connection),
                        max,
                        max_bytes,
                        |row: &PgRow, index: usize| values::pg_value_in(row, index, &facts),
                    )
                    .await?;
                    Ok::<_, AppError>((
                        with_headers!(columns, &mut *connection, sql),
                        rows,
                        decode_failures,
                        truncated,
                    ))
                }
                .await;
                let open = scope.is_some()
                    && end_pg_read_scope(&mut connection, &mut outcome, |read| read.3).await;
                finish_read(connection, &outcome, |read| read.3, open);
                outcome?
            }
            Pool::Mysql(pool) => {
                let mut connection = cancel::AbandonClosingConnection::acquire(pool).await?;
                let outcome = async {
                    let facts = mysql_session_facts(pool, &mut connection).await;
                    let (columns, rows, decode_failures, truncated) = stream_byte_capped(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *connection),
                        max,
                        max_bytes,
                        |row: &MySqlRow, index: usize| values::mysql_value_in(row, index, &facts),
                    )
                    .await?;
                    Ok::<_, AppError>((
                        with_headers!(columns, &mut *connection, sql),
                        rows,
                        decode_failures,
                        truncated,
                    ))
                }
                .await;
                finish_read(connection, &outcome, |read| read.3, false);
                outcome?
            }
            Pool::Sqlite(pool) => {
                let mut connection = cancel::AbandonClosingConnection::acquire(pool).await?;
                let outcome = async {
                    let (columns, rows, decode_failures, truncated) = stream_byte_capped(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *connection),
                        max,
                        max_bytes,
                        sqlite_value,
                    )
                    .await?;
                    Ok::<_, AppError>((
                        with_headers!(columns, &mut *connection, sql),
                        rows,
                        decode_failures,
                        truncated,
                    ))
                }
                .await;
                connection.release();
                outcome?
            }
            Pool::Bigquery(_) | Pool::CloudflareD1(_) => {
                unreachable!("remote CLI engines are handled before the SQLx stream")
            }
        };
        Ok(QueryResult {
            row_count: rows.len(),
            columns,
            rows,
            decode_failures,
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

    match &live.read_pool {
        Pool::Bigquery(connection) => return connection.query(sql, max_rows, cancellation).await,
        Pool::CloudflareD1(connection) => return connection.query(sql, max_rows).await,
        _ => {}
    }

    // ponytail: read_pool is the L2-enforced pool; reads never touch mutation authority.
    let inner = async {
        let (columns, rows, decode_failures, truncated) = match &live.read_pool {
            Pool::Postgres(pool) => {
                let mut connection = cancel::AbandonClosingConnection::acquire(pool).await?;
                let scope = pg_read_scope(namespace.as_deref(), live.transaction_pooler);
                let mut outcome = async {
                    let facts = pg_session_facts(pool, &mut connection).await;
                    let decode =
                        |row: &PgRow, index: usize| values::pg_value_in(row, index, &facts);
                    if let Some(scope) = scope.as_deref() {
                        sqlx::raw_sql(AssertSqlSafe(scope))
                            .execute(&mut *connection)
                            .await?;
                    }
                    let (c, r, f, t) = stream_capped(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *connection),
                        max,
                        decode,
                    )
                    .await?;
                    Ok::<_, AppError>((with_headers!(c, &mut *connection, sql), r, f, t))
                }
                .await;
                let open = scope.is_some()
                    && end_pg_read_scope(&mut connection, &mut outcome, |read| read.3).await;
                finish_read(connection, &outcome, |read| read.3, open);
                outcome?
            }
            Pool::Mysql(pool) => {
                let mut connection = cancel::AbandonClosingConnection::acquire(pool).await?;
                let outcome = async {
                    let facts = mysql_session_facts(pool, &mut connection).await;
                    let (c, r, f, t) = stream_capped(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *connection),
                        max,
                        |row: &MySqlRow, index: usize| values::mysql_value_in(row, index, &facts),
                    )
                    .await?;
                    Ok::<_, AppError>((with_headers!(c, &mut *connection, sql), r, f, t))
                }
                .await;
                finish_read(connection, &outcome, |read| read.3, false);
                outcome?
            }
            Pool::Sqlite(pool) => {
                let mut connection = cancel::AbandonClosingConnection::acquire(pool).await?;
                let outcome = async {
                    let (c, r, f, t) = stream_capped(
                        sqlx::query(AssertSqlSafe(sql)).fetch(&mut *connection),
                        max,
                        sqlite_value,
                    )
                    .await?;
                    Ok::<_, AppError>((with_headers!(c, &mut *connection, sql), r, f, t))
                }
                .await;
                connection.release();
                outcome?
            }
            Pool::Bigquery(_) | Pool::CloudflareD1(_) => {
                unreachable!("remote CLI engines are handled before the SQLx stream")
            }
        };
        Ok::<_, AppError>(QueryResult {
            row_count: rows.len(),
            columns,
            rows,
            decode_failures,
            truncated,
            duration_ms: 0,
        })
    };

    let mut result = cancel::guard_registered(cancellation, cancel::QUERY_TIMEOUT, inner).await?;
    result.duration_ms = started.elapsed().as_millis() as u64;
    Ok(result)
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
    f: impl Fn(&R, usize) -> values::DecodedCell,
) -> Result<(Vec<String>, Vec<Vec<Value>>, Vec<CellDecodeFailure>, bool), sqlx::Error>
where
    S: futures::Stream<Item = Result<R, sqlx::Error>> + Unpin,
    R: Row,
{
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut decode_failures = Vec::new();
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
        let (decoded, failures) = decode_row(&row, rows.len(), n, &f);
        rows.push(decoded);
        decode_failures.extend(failures);
    }
    Ok((columns, rows, decode_failures, truncated))
}

pub(crate) async fn stream_batched<S, R, F, Fut>(
    mut stream: S,
    max_rows: usize,
    batch_rows: usize,
    decode: impl Fn(&R, usize) -> values::DecodedCell,
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
    let mut batch_failures = Vec::new();
    let mut batch_bytes = 0_usize;
    let mut row_count = 0_usize;
    let mut truncated = false;
    let mut first_row_ms = None;
    // Room for rows once the page envelope and column names are counted.
    let mut page_budget = 0_usize;
    while let Some(row) = stream.try_next().await? {
        first_row_ms.get_or_insert_with(|| started.elapsed().as_millis() as u64);
        if columns.is_empty() {
            columns = row
                .columns()
                .iter()
                .map(|column| column.name().to_owned())
                .collect();
            page_budget = page_row_budget(&columns)?;
        }
        if row_count >= max_rows {
            truncated = true;
            break;
        }
        let (mut decoded, mut failures) = decode_row(&row, row_count, row.columns().len(), &decode);
        let row_bytes = fit_row_to_page(&mut decoded, &mut failures, row_count, page_budget)?;
        if !batch.is_empty() && batch_bytes.saturating_add(row_bytes) > page_budget {
            on_batch(ReadBatch {
                columns: columns.clone(),
                rows: std::mem::take(&mut batch),
                decode_failures: std::mem::take(&mut batch_failures),
            })
            .await?;
            batch = Vec::with_capacity(batch_rows);
            batch_bytes = 0;
        }
        batch_bytes += row_bytes;
        batch.push(decoded);
        batch_failures.extend(failures);
        row_count += 1;
        if batch.len() == batch_rows {
            on_batch(ReadBatch {
                columns: columns.clone(),
                rows: std::mem::take(&mut batch),
                decode_failures: std::mem::take(&mut batch_failures),
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
            decode_failures: batch_failures,
        })
        .await?;
    }
    Ok((columns, row_count, truncated, first_row_ms))
}

pub(crate) async fn stream_byte_capped<S, R>(
    mut stream: S,
    max_rows: usize,
    max_bytes: usize,
    decode: impl Fn(&R, usize) -> values::DecodedCell,
) -> AppResult<(Vec<String>, Vec<Vec<Value>>, Vec<CellDecodeFailure>, bool)>
where
    S: futures::Stream<Item = Result<R, sqlx::Error>> + Unpin,
    R: Row,
{
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut decode_failures = Vec::new();
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
        let (decoded, failures) = decode_row(&row, rows.len(), row.columns().len(), &decode);
        let row_bytes = json_size(&decoded)?;
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
        decode_failures.extend(failures);
    }
    Ok((columns, rows, decode_failures, truncated))
}

fn decode_row<R: Row>(
    row: &R,
    row_index: usize,
    column_count: usize,
    decode: &impl Fn(&R, usize) -> values::DecodedCell,
) -> (Vec<Value>, Vec<CellDecodeFailure>) {
    let mut values = Vec::with_capacity(column_count);
    let mut failures = Vec::new();
    for column_index in 0..column_count {
        // A driver decoder panic is contained to the one cell it was decoding:
        // the cell becomes failure metadata and the command still answers.
        let decoded =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| decode(row, column_index)))
                .unwrap_or_else(|_| values::DecodedCell {
                    value: Value::Null,
                    failure_type: Some(row.columns().get(column_index).map_or_else(
                        || "unknown".into(),
                        |column| column.type_info().name().to_ascii_lowercase(),
                    )),
                });
        if let Some(database_type) = decoded.failure_type {
            failures.push(CellDecodeFailure {
                row_index,
                column_index,
                database_type,
            });
        }
        values.push(decoded.value);
    }
    (values, failures)
}
