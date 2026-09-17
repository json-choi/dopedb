//! Manual transaction connection and session state machines.

use super::*;

pub(super) enum ManualConnection {
    Postgres(PoolConnection<Postgres>),
    Mysql(PoolConnection<MySql>),
    Sqlite(PoolConnection<Sqlite>),
}

impl ManualConnection {
    pub(super) async fn begin(pool: &DbPool) -> AppResult<Self> {
        match pool {
            DbPool::Postgres(pool) => {
                let mut connection = pool.acquire().await?;
                sqlx::query("BEGIN").execute(&mut *connection).await?;
                Ok(Self::Postgres(connection))
            }
            DbPool::Mysql(pool) => {
                let mut connection = pool.acquire().await?;
                sqlx::query("START TRANSACTION")
                    .execute(&mut *connection)
                    .await?;
                Ok(Self::Mysql(connection))
            }
            DbPool::Sqlite(pool) => {
                let mut connection = pool.acquire().await?;
                sqlx::query("BEGIN").execute(&mut *connection).await?;
                Ok(Self::Sqlite(connection))
            }
            DbPool::Bigquery(_) => Err(AppError::Blocked {
                reason: "BigQuery does not expose manual transactions in DopeDB".into(),
            }),
            DbPool::CloudflareD1(_) => Err(AppError::Blocked {
                reason: "Cloudflare D1 Wrangler connections do not expose manual transactions"
                    .into(),
            }),
        }
    }

    pub(super) async fn finish(mut self, commit: bool) -> AppResult<()> {
        let statement = if commit { "COMMIT" } else { "ROLLBACK" };
        let result = match &mut self {
            Self::Postgres(connection) => sqlx::query(statement)
                .execute(&mut **connection)
                .await
                .map(|_| ()),
            Self::Mysql(connection) => sqlx::query(statement)
                .execute(&mut **connection)
                .await
                .map(|_| ()),
            Self::Sqlite(connection) => sqlx::query(statement)
                .execute(&mut **connection)
                .await
                .map(|_| ()),
        };
        if let Err(error) = result {
            self.close().await;
            return Err(if commit {
                AppError::OutcomeUnknown(format!(
                    "manual transaction commit acknowledgement failed: {error}"
                ))
            } else {
                AppError::OutcomeUnknown(format!(
                    "manual transaction rollback acknowledgement failed: {error}"
                ))
            });
        }
        Ok(())
    }

    pub(super) async fn close(self) {
        match self {
            Self::Postgres(connection) => {
                let _ = connection.close().await;
            }
            Self::Mysql(connection) => {
                let _ = connection.close().await;
            }
            Self::Sqlite(connection) => {
                let _ = connection.close().await;
            }
        }
    }
}

pub(super) struct ManualSessionState {
    pub(super) phase: ManualTransactionPhase,
    pub(super) statement_count: u64,
    pub(super) connection: Option<ManualConnection>,
}

pub(super) struct ManualSession {
    pub(super) transaction_id: Uuid,
    pub(super) connection_id: Uuid,
    pub(super) database: String,
    pub(super) engine: Engine,
    pub(super) started_at: DateTime<Utc>,
    pub(super) expires_at: DateTime<Utc>,
    pub(super) state: Mutex<ManualSessionState>,
    pub(super) _lease: ConnectionLease,
}

impl ManualSession {
    pub(super) async fn status(&self) -> ManualTransactionStatus {
        let state = self.state.lock().await;
        ManualTransactionStatus {
            transaction_id: self.transaction_id,
            connection_id: self.connection_id,
            database: self.database.clone(),
            phase: state.phase,
            statement_count: state.statement_count,
            started_at: self.started_at,
            expires_at: self.expires_at,
        }
    }

    pub(super) async fn finish(&self, commit: bool) -> AppResult<ManualTransactionStatus> {
        let mut state = self.state.lock().await;
        let status = ManualTransactionStatus {
            transaction_id: self.transaction_id,
            connection_id: self.connection_id,
            database: self.database.clone(),
            phase: state.phase,
            statement_count: state.statement_count,
            started_at: self.started_at,
            expires_at: self.expires_at,
        };
        if commit && state.phase == ManualTransactionPhase::Failed {
            return Err(AppError::Blocked {
                reason: "the manual transaction is failed and can only be rolled back".into(),
            });
        }
        let connection = state.connection.take().ok_or_else(|| AppError::Blocked {
            reason: "the manual transaction is already closed".into(),
        })?;
        drop(state);
        connection.finish(commit).await?;
        Ok(status)
    }

    pub(super) async fn force_rollback(&self, reason: &'static str) {
        let connection = self.state.lock().await.connection.take();
        let Some(connection) = connection else {
            return;
        };
        if let Err(error) = connection.finish(false).await {
            tracing::warn!(
                connection_id = %self.connection_id,
                transaction_id = %self.transaction_id,
                %reason,
                %error,
                "manual transaction forced rollback was not acknowledged"
            );
        }
    }

    pub(super) async fn run_read(
        &self,
        sql: &str,
        namespace: Option<String>,
        max_rows: u64,
        cancellation: Option<&executor::cancel::CancelHandle>,
    ) -> AppResult<QueryResult> {
        let started = Instant::now();
        let mut state = self.state.lock().await;
        ensure_session_usable(&state, self.expires_at)?;
        let connection = state
            .connection
            .as_mut()
            .expect("usable manual transaction owns a connection");
        let execution = manual_read(connection, sql, namespace, max_rows);
        match executor::cancel::guard_registered(
            cancellation,
            executor::cancel::QUERY_TIMEOUT,
            execution,
        )
        .await
        {
            Ok(mut result) => {
                state.statement_count += 1;
                result.duration_ms = started.elapsed().as_millis() as u64;
                Ok(result)
            }
            Err(error) => {
                state.phase = ManualTransactionPhase::Failed;
                Err(error)
            }
        }
    }

    pub(super) async fn run_read_streamed<F, Fut>(
        &self,
        sql: &str,
        namespace: Option<String>,
        max_rows: u64,
        batch_rows: usize,
        cancellation: Option<&executor::cancel::CancelHandle>,
        on_batch: &mut F,
    ) -> AppResult<executor::read::StreamedRead>
    where
        F: FnMut(executor::read::ReadBatch) -> Fut + Send,
        Fut: Future<Output = AppResult<()>> + Send,
    {
        let mut state = self.state.lock().await;
        ensure_session_usable(&state, self.expires_at)?;
        let connection = state
            .connection
            .as_mut()
            .expect("usable manual transaction owns a connection");
        let execution =
            manual_read_streamed(connection, sql, namespace, max_rows, batch_rows, on_batch);
        match executor::cancel::guard_registered(
            cancellation,
            executor::cancel::QUERY_TIMEOUT,
            execution,
        )
        .await
        {
            Ok(result) => {
                state.statement_count += 1;
                Ok(result)
            }
            Err(error) => {
                state.phase = ManualTransactionPhase::Failed;
                Err(error)
            }
        }
    }

    pub(super) async fn run_write(
        &self,
        classification: &Classification,
        sql: &str,
        namespace: Option<String>,
        settings: &SafetySettings,
        grant: &ExecutionGrant,
        cancellation: &executor::cancel::CancelHandle,
    ) -> AppResult<ExecOutcome> {
        if cancellation.id() != grant.operation_id() {
            return Err(AppError::Blocked {
                reason:
                    "manual transaction cancellation scope does not match its approved operation"
                        .into(),
            });
        }
        if !settings.allow_writes {
            return Err(AppError::Blocked {
                reason: "writes are disabled for this connection (allow_writes = 0)".into(),
            });
        }
        if matches!(classification.kind, QueryKind::Ddl | QueryKind::Privilege) {
            return Err(AppError::Blocked {
                reason: "DDL and privilege statements are excluded from a manual rollback boundary"
                    .into(),
            });
        }
        let mut state = self.state.lock().await;
        ensure_session_usable(&state, self.expires_at)?;
        let connection = state
            .connection
            .as_mut()
            .expect("usable manual transaction owns a connection");
        let execution = manual_execute(connection, sql, namespace);
        match executor::cancel::guard_registered(
            Some(cancellation),
            executor::cancel::QUERY_TIMEOUT,
            execution,
        )
        .await
        {
            Ok(affected) => {
                state.statement_count += 1;
                Ok(ExecOutcome {
                    result: None,
                    affected: Some(affected),
                    committed: false,
                    manual_transaction: true,
                })
            }
            Err(error) => {
                state.phase = ManualTransactionPhase::Failed;
                Err(error)
            }
        }
    }

    pub(super) async fn run_script(
        &self,
        statements: &[String],
        kinds: &[QueryKind],
        namespace: Option<String>,
        expected_affected: Option<&[u64]>,
        max_rows: u64,
        cancellation: &executor::cancel::CancelHandle,
    ) -> AppResult<ManualScriptExecution> {
        let mut state = self.state.lock().await;
        ensure_session_usable(&state, self.expires_at)?;
        let connection = state
            .connection
            .as_mut()
            .expect("usable manual transaction owns a connection");
        let execution = manual_script(
            connection,
            statements,
            kinds,
            namespace,
            expected_affected,
            max_rows,
        );
        match executor::cancel::guard_registered(
            Some(cancellation),
            executor::cancel::QUERY_TIMEOUT,
            execution,
        )
        .await
        {
            Ok(execution) => {
                state.statement_count += execution.statements.len() as u64;
                Ok(execution)
            }
            Err(error) => {
                state.phase = ManualTransactionPhase::Failed;
                Err(error)
            }
        }
    }
}

fn ensure_session_usable(state: &ManualSessionState, expires_at: DateTime<Utc>) -> AppResult<()> {
    if state.connection.is_none() {
        return Err(AppError::Blocked {
            reason: "the manual transaction is closed".into(),
        });
    }
    if state.phase == ManualTransactionPhase::Failed {
        return Err(AppError::Blocked {
            reason: "the manual transaction is failed and can only be rolled back".into(),
        });
    }
    if expires_at <= Utc::now() {
        return Err(AppError::Blocked {
            reason: "the manual transaction expired and must be rolled back".into(),
        });
    }
    Ok(())
}
