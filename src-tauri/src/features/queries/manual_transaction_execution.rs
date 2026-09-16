//! Engine-specific manual transaction query and script execution.

use super::*;

pub(super) async fn set_namespace(
    connection: &mut ManualConnection,
    namespace: Option<&str>,
) -> AppResult<()> {
    let Some(namespace) = namespace else {
        return Ok(());
    };
    if let ManualConnection::Postgres(connection) = connection {
        let statement = executor::namespace::postgres_search_path_statement(namespace);
        sqlx::query(AssertSqlSafe(statement))
            .execute(&mut **connection)
            .await?;
    }
    Ok(())
}

pub(super) async fn manual_execute(
    connection: &mut ManualConnection,
    sql: &str,
    namespace: Option<String>,
) -> AppResult<u64> {
    set_namespace(connection, namespace.as_deref()).await?;
    let affected = match connection {
        ManualConnection::Postgres(connection) => sqlx::query(AssertSqlSafe(sql))
            .execute(&mut **connection)
            .await?
            .rows_affected(),
        ManualConnection::Mysql(connection) => sqlx::query(AssertSqlSafe(sql))
            .execute(&mut **connection)
            .await?
            .rows_affected(),
        ManualConnection::Sqlite(connection) => sqlx::query(AssertSqlSafe(sql))
            .execute(&mut **connection)
            .await?
            .rows_affected(),
    };
    Ok(affected)
}

pub(super) async fn manual_read(
    connection: &mut ManualConnection,
    sql: &str,
    namespace: Option<String>,
    max_rows: u64,
) -> AppResult<QueryResult> {
    set_namespace(connection, namespace.as_deref()).await?;
    let max_rows = max_rows as usize;
    let (columns, rows, decode_failures, truncated) = match connection {
        ManualConnection::Postgres(connection) => {
            let (columns, rows, decode_failures, truncated) = executor::read::stream_capped(
                sqlx::query(AssertSqlSafe(sql)).fetch(&mut **connection),
                max_rows,
                executor::read::pg_value,
            )
            .await?;
            let columns = if columns.is_empty() {
                (&mut **connection)
                    .describe(AssertSqlSafe(sql).into_sql_str())
                    .await
                    .ok()
                    .map(executor::read::describe_cols)
                    .unwrap_or_default()
            } else {
                columns
            };
            (columns, rows, decode_failures, truncated)
        }
        ManualConnection::Mysql(connection) => {
            let (columns, rows, decode_failures, truncated) = executor::read::stream_capped(
                sqlx::query(AssertSqlSafe(sql)).fetch(&mut **connection),
                max_rows,
                executor::read::mysql_value,
            )
            .await?;
            let columns = if columns.is_empty() {
                (&mut **connection)
                    .describe(AssertSqlSafe(sql).into_sql_str())
                    .await
                    .ok()
                    .map(executor::read::describe_cols)
                    .unwrap_or_default()
            } else {
                columns
            };
            (columns, rows, decode_failures, truncated)
        }
        ManualConnection::Sqlite(connection) => {
            let (columns, rows, decode_failures, truncated) = executor::read::stream_capped(
                sqlx::query(AssertSqlSafe(sql)).fetch(&mut **connection),
                max_rows,
                executor::read::sqlite_value,
            )
            .await?;
            let columns = if columns.is_empty() {
                (&mut **connection)
                    .describe(AssertSqlSafe(sql).into_sql_str())
                    .await
                    .ok()
                    .map(executor::read::describe_cols)
                    .unwrap_or_default()
            } else {
                columns
            };
            (columns, rows, decode_failures, truncated)
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
}

pub(super) async fn manual_read_streamed<F, Fut>(
    connection: &mut ManualConnection,
    sql: &str,
    namespace: Option<String>,
    max_rows: u64,
    batch_rows: usize,
    on_batch: &mut F,
) -> AppResult<executor::read::StreamedRead>
where
    F: FnMut(executor::read::ReadBatch) -> Fut + Send,
    Fut: Future<Output = AppResult<()>> + Send,
{
    let started = Instant::now();
    set_namespace(connection, namespace.as_deref()).await?;
    let (columns, row_count, truncated, first_row_ms) = match connection {
        ManualConnection::Postgres(connection) => {
            let (columns, row_count, truncated, first_row_ms) = executor::read::stream_batched(
                sqlx::query(AssertSqlSafe(sql)).fetch(&mut **connection),
                max_rows as usize,
                batch_rows,
                executor::read::pg_value,
                started,
                on_batch,
            )
            .await?;
            let columns = if columns.is_empty() {
                (&mut **connection)
                    .describe(AssertSqlSafe(sql).into_sql_str())
                    .await
                    .ok()
                    .map(executor::read::describe_cols)
                    .unwrap_or_default()
            } else {
                columns
            };
            (columns, row_count, truncated, first_row_ms)
        }
        ManualConnection::Mysql(connection) => {
            let (columns, row_count, truncated, first_row_ms) = executor::read::stream_batched(
                sqlx::query(AssertSqlSafe(sql)).fetch(&mut **connection),
                max_rows as usize,
                batch_rows,
                executor::read::mysql_value,
                started,
                on_batch,
            )
            .await?;
            let columns = if columns.is_empty() {
                (&mut **connection)
                    .describe(AssertSqlSafe(sql).into_sql_str())
                    .await
                    .ok()
                    .map(executor::read::describe_cols)
                    .unwrap_or_default()
            } else {
                columns
            };
            (columns, row_count, truncated, first_row_ms)
        }
        ManualConnection::Sqlite(connection) => {
            let (columns, row_count, truncated, first_row_ms) = executor::read::stream_batched(
                sqlx::query(AssertSqlSafe(sql)).fetch(&mut **connection),
                max_rows as usize,
                batch_rows,
                executor::read::sqlite_value,
                started,
                on_batch,
            )
            .await?;
            let columns = if columns.is_empty() {
                (&mut **connection)
                    .describe(AssertSqlSafe(sql).into_sql_str())
                    .await
                    .ok()
                    .map(executor::read::describe_cols)
                    .unwrap_or_default()
            } else {
                columns
            };
            (columns, row_count, truncated, first_row_ms)
        }
    };
    if row_count == 0 {
        on_batch(executor::read::ReadBatch {
            columns: columns.clone(),
            rows: Vec::new(),
            decode_failures: Vec::new(),
        })
        .await?;
    }
    Ok(executor::read::StreamedRead {
        columns,
        row_count,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
        first_row_ms,
    })
}

pub(super) async fn manual_script(
    connection: &mut ManualConnection,
    statements: &[String],
    kinds: &[QueryKind],
    namespace: Option<String>,
    expected_affected: Option<&[u64]>,
    max_rows: u64,
) -> AppResult<ManualScriptExecution> {
    set_namespace(connection, namespace.as_deref()).await?;
    let mut outcomes = Vec::with_capacity(statements.len());
    for (index, statement) in statements.iter().enumerate() {
        if kinds.get(index) == Some(&QueryKind::Read) {
            let result = manual_read(connection, statement, None, max_rows).await?;
            outcomes.push(ScriptStatement {
                sql: statement.clone(),
                result: Some(result),
                affected: None,
                error: None,
            });
            continue;
        }
        let affected = manual_execute(connection, statement, None).await?;
        if let Some(expected) = expected_affected.and_then(|values| values.get(index)) {
            if affected != *expected {
                return Err(AppError::Blocked {
                    reason: format!(
                        "optimistic concurrency conflict: expected {expected} affected row, got {affected}"
                    ),
                });
            }
        }
        outcomes.push(ScriptStatement {
            sql: statement.clone(),
            result: None,
            affected: Some(affected as i64),
            error: None,
        });
    }
    Ok(ManualScriptExecution {
        statements: outcomes,
    })
}
