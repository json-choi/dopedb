//! Engine-specific manual transaction query and script execution.
//!
//! Every write runs inside the `dopedb_statement` savepoint, so an SQL error
//! rolls back only that statement. Every read runs inside a read-only scope:
//! PostgreSQL `SAVEPOINT` + `SET LOCAL transaction_read_only`, SQLite
//! `PRAGMA query_only`, and a savepoint that is always rolled back on MySQL
//! (which cannot switch a running transaction to read-only), so a read that L1
//! misclassified cannot change data inside the shared transaction. A script runs
//! inside one `dopedb_script` savepoint and is undone as a unit when it fails.

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

/// Run fixed transaction-control SQL. PostgreSQL and SQLite accept several
/// statements in one round trip; MySQL receives them one at a time.
async fn control(connection: &mut ManualConnection, statements: &[&'static str]) -> AppResult<()> {
    match connection {
        ManualConnection::Postgres(connection) => {
            sqlx::raw_sql(AssertSqlSafe(statements.join("; ")))
                .execute(&mut **connection)
                .await?;
        }
        ManualConnection::Sqlite(connection) => {
            sqlx::raw_sql(AssertSqlSafe(statements.join("; ")))
                .execute(&mut **connection)
                .await?;
        }
        ManualConnection::Mysql(connection) => {
            for statement in statements {
                sqlx::raw_sql(*statement).execute(&mut **connection).await?;
            }
        }
    }
    Ok(())
}

/// Open this write's savepoint, releasing the previous write's savepoint in the
/// same round trip.
async fn open_statement_savepoint(link: &mut ManualLink) -> AppResult<()> {
    if link.statement_savepoint {
        control(
            &mut link.connection,
            &[
                "RELEASE SAVEPOINT dopedb_statement",
                "SAVEPOINT dopedb_statement",
            ],
        )
        .await?;
    } else {
        control(&mut link.connection, &["SAVEPOINT dopedb_statement"]).await?;
        link.statement_savepoint = true;
    }
    Ok(())
}

/// Classify a statement failure: rolled back alone when the savepoint restores,
/// otherwise the transaction can only be rolled back.
async fn restore(
    connection: &mut ManualConnection,
    rollback: &[&'static str],
    error: AppError,
) -> StatementError {
    match control(connection, rollback).await {
        Ok(()) => StatementError::RolledBack(error),
        Err(_) => StatementError::Poisoned(error),
    }
}

/// Run one write inside its own savepoint.
pub(super) async fn write_statement(
    link: &mut ManualLink,
    sql: &str,
    namespace: Option<&str>,
) -> Result<u64, StatementError> {
    open_statement_savepoint(link)
        .await
        .map_err(StatementError::Poisoned)?;
    let outcome = async {
        set_namespace(&mut link.connection, namespace).await?;
        execute_on(&mut link.connection, sql).await
    }
    .await;
    match outcome {
        Ok(affected) => Ok(affected),
        Err(error) => Err(restore(
            &mut link.connection,
            &["ROLLBACK TO SAVEPOINT dopedb_statement"],
            error,
        )
        .await),
    }
}

const READ_SCOPE_ENTER_POSTGRES: &[&str] = &[
    "SAVEPOINT dopedb_read",
    "SET LOCAL transaction_read_only = on",
];
const READ_SCOPE_EXIT_SAVEPOINT: &[&str] = &[
    "ROLLBACK TO SAVEPOINT dopedb_read",
    "RELEASE SAVEPOINT dopedb_read",
];

async fn enter_read_scope(connection: &mut ManualConnection) -> AppResult<()> {
    match connection {
        ManualConnection::Postgres(_) => control(connection, READ_SCOPE_ENTER_POSTGRES).await,
        ManualConnection::Mysql(_) => control(connection, &["SAVEPOINT dopedb_read"]).await,
        ManualConnection::Sqlite(_) => control(connection, &["PRAGMA query_only = ON"]).await,
    }
}

async fn exit_read_scope(connection: &mut ManualConnection) -> AppResult<()> {
    match connection {
        ManualConnection::Postgres(_) | ManualConnection::Mysql(_) => {
            control(connection, READ_SCOPE_EXIT_SAVEPOINT).await
        }
        ManualConnection::Sqlite(_) => control(connection, &["PRAGMA query_only = OFF"]).await,
    }
}

/// Finish a read scope and classify the read's outcome. The scope is always
/// left; failing to leave it means the transaction can no longer be trusted.
async fn leave_read_scope<T>(
    connection: &mut ManualConnection,
    engine: Engine,
    outcome: AppResult<T>,
) -> Result<T, StatementError> {
    let left = exit_read_scope(connection).await;
    match (outcome, left) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(StatementError::RolledBack(read_only_error(engine, error))),
        (Ok(_), Err(error)) => Err(StatementError::Poisoned(error)),
        (Err(error), Err(_)) => Err(StatementError::Poisoned(read_only_error(engine, error))),
    }
}

/// A write attempted inside the read-only scope is reported as the same typed
/// block as an ordinary read-only session.
fn read_only_error(engine: Engine, error: AppError) -> AppError {
    match error {
        AppError::Db(error) => crate::safety::l2_enforce::map_readonly(engine, error),
        error => error,
    }
}

/// Run one read inside the read-only scope.
pub(super) async fn read_statement(
    link: &mut ManualLink,
    engine: Engine,
    sql: &str,
    namespace: Option<&str>,
    max_rows: u64,
) -> Result<QueryResult, StatementError> {
    enter_read_scope(&mut link.connection)
        .await
        .map_err(StatementError::Poisoned)?;
    let outcome = async {
        set_namespace(&mut link.connection, namespace).await?;
        read_on(&mut link.connection, link.facts, sql, max_rows).await
    }
    .await;
    leave_read_scope(&mut link.connection, engine, outcome).await
}

/// Stream one read inside the read-only scope.
pub(super) async fn read_streamed_statement<F, Fut>(
    link: &mut ManualLink,
    engine: Engine,
    sql: &str,
    namespace: Option<&str>,
    max_rows: u64,
    batch_rows: usize,
    on_batch: &mut F,
) -> Result<executor::read::StreamedRead, StatementError>
where
    F: FnMut(executor::read::ReadBatch) -> Fut + Send,
    Fut: Future<Output = AppResult<()>> + Send,
{
    enter_read_scope(&mut link.connection)
        .await
        .map_err(StatementError::Poisoned)?;
    let outcome = async {
        set_namespace(&mut link.connection, namespace).await?;
        read_streamed_on(
            &mut link.connection,
            link.facts,
            sql,
            max_rows,
            batch_rows,
            on_batch,
        )
        .await
    }
    .await;
    leave_read_scope(&mut link.connection, engine, outcome).await
}

/// The exact statements of one approved script.
pub(super) struct ManualScript<'a> {
    pub(super) statements: &'a [String],
    pub(super) kinds: &'a [QueryKind],
    pub(super) expected_affected: Option<&'a [u64]>,
    pub(super) max_rows: u64,
}

/// Run a script inside one savepoint so a failure undoes the whole script while
/// earlier work in the transaction stays.
pub(super) async fn script_statements(
    link: &mut ManualLink,
    engine: Engine,
    namespace: Option<&str>,
    script: ManualScript<'_>,
) -> Result<ManualScriptExecution, StatementError> {
    control(&mut link.connection, &["SAVEPOINT dopedb_script"])
        .await
        .map_err(StatementError::Poisoned)?;
    let outcome = async {
        set_namespace(&mut link.connection, namespace).await?;
        let mut outcomes = Vec::with_capacity(script.statements.len());
        for (index, statement) in script.statements.iter().enumerate() {
            if script.kinds.get(index) == Some(&QueryKind::Read) {
                enter_read_scope(&mut link.connection).await?;
                let read =
                    read_on(&mut link.connection, link.facts, statement, script.max_rows).await;
                exit_read_scope(&mut link.connection).await?;
                let result = read.map_err(|error| read_only_error(engine, error))?;
                outcomes.push(ScriptStatement {
                    sql: statement.clone(),
                    result: Some(result),
                    affected: None,
                    error: None,
                });
                continue;
            }
            let affected = execute_on(&mut link.connection, statement).await?;
            if let Some(expected) = script.expected_affected.and_then(|values| values.get(index)) {
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
        Ok::<_, AppError>(outcomes)
    }
    .await;
    match outcome {
        Ok(statements) => {
            match control(&mut link.connection, &["RELEASE SAVEPOINT dopedb_script"]).await {
                Ok(()) => Ok(ManualScriptExecution { statements }),
                Err(error) => Err(StatementError::Poisoned(error)),
            }
        }
        Err(error) => Err(restore(
            &mut link.connection,
            &[
                "ROLLBACK TO SAVEPOINT dopedb_script",
                "RELEASE SAVEPOINT dopedb_script",
            ],
            error,
        )
        .await),
    }
}

async fn execute_on(connection: &mut ManualConnection, sql: &str) -> AppResult<u64> {
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

/// A plain PostgreSQL query (`SELECT`, `WITH`, `VALUES`, `TABLE`) is read through
/// a cursor declared inside the read scope, so the server sends at most
/// `max_rows + 1` rows: a truncated read leaves nothing for `ROLLBACK TO
/// SAVEPOINT` to drain, and that rollback also closes the cursor. Other reads
/// (`EXPLAIN`, `SHOW`, …) run directly. Both forms use the extended protocol,
/// which runs exactly one statement. Returns the statement whose rows to stream,
/// which callers run unprepared: a cached `FETCH` would keep the first cursor's
/// columns. The cursor costs one extra round trip.
async fn pg_bounded_read(
    connection: &mut sqlx::PgConnection,
    sql: &str,
    max_rows: usize,
) -> AppResult<String> {
    if !pg_cursor_query(sql) {
        return Ok(sql.to_owned());
    }
    sqlx::query(AssertSqlSafe(format!(
        "DECLARE dopedb_read NO SCROLL CURSOR FOR {sql}"
    )))
    .persistent(false)
    .execute(&mut *connection)
    .await?;
    Ok(format!(
        "FETCH {} FROM dopedb_read",
        max_rows.saturating_add(1)
    ))
}

fn pg_cursor_query(sql: &str) -> bool {
    use sqlparser::dialect::PostgreSqlDialect;
    use sqlparser::keywords::Keyword;
    use sqlparser::tokenizer::{Token, Tokenizer};

    Tokenizer::new(&PostgreSqlDialect {}, sql)
        .tokenize()
        .ok()
        .and_then(|tokens| {
            tokens
                .into_iter()
                .find(|token| !matches!(token, Token::Whitespace(_)))
        })
        .is_some_and(|token| {
            matches!(
                token,
                Token::Word(word) if word.quote_style.is_none()
                    && matches!(
                        word.keyword,
                        Keyword::SELECT | Keyword::WITH | Keyword::VALUES | Keyword::TABLE
                    )
            )
        })
}

/// Decode with the session's presentation facts, exactly like a normal read, so
/// MONEY scale and instant offsets match outside and inside the transaction.
async fn read_on(
    connection: &mut ManualConnection,
    facts: executor::read::SessionFacts,
    sql: &str,
    max_rows: u64,
) -> AppResult<QueryResult> {
    let max_rows = max_rows as usize;
    let (columns, rows, decode_failures, truncated) = match connection {
        ManualConnection::Postgres(connection) => {
            let statement = pg_bounded_read(connection, sql, max_rows).await?;
            let (columns, rows, decode_failures, truncated) = executor::read::stream_capped(
                sqlx::query(AssertSqlSafe(statement))
                    .persistent(false)
                    .fetch(&mut **connection),
                max_rows,
                |row: &sqlx::postgres::PgRow, index: usize| {
                    executor::read::pg_value_in(row, index, &facts)
                },
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
                |row: &sqlx::mysql::MySqlRow, index: usize| {
                    executor::read::mysql_value_in(row, index, &facts)
                },
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

async fn read_streamed_on<F, Fut>(
    connection: &mut ManualConnection,
    facts: executor::read::SessionFacts,
    sql: &str,
    max_rows: u64,
    batch_rows: usize,
    on_batch: &mut F,
) -> AppResult<executor::read::StreamedRead>
where
    F: FnMut(executor::read::ReadBatch) -> Fut + Send,
    Fut: Future<Output = AppResult<()>> + Send,
{
    let started = Instant::now();
    let (columns, row_count, truncated, first_row_ms) = match connection {
        ManualConnection::Postgres(connection) => {
            let statement = pg_bounded_read(connection, sql, max_rows as usize).await?;
            let (columns, row_count, truncated, first_row_ms) = executor::read::stream_batched(
                sqlx::query(AssertSqlSafe(statement))
                    .persistent(false)
                    .fetch(&mut **connection),
                max_rows as usize,
                batch_rows,
                |row: &sqlx::postgres::PgRow, index: usize| {
                    executor::read::pg_value_in(row, index, &facts)
                },
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
                |row: &sqlx::mysql::MySqlRow, index: usize| {
                    executor::read::mysql_value_in(row, index, &facts)
                },
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
