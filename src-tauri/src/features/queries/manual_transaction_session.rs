//! Manual transaction connection and session state machines.
//!
//! The physical connection carries transaction and savepoint state, so it is
//! closed (never returned to the pool) whenever it is dropped. Session facts the
//! UI polls live behind a short synchronous lock, separate from the connection,
//! so status reads never wait for a running statement.

use super::*;

pub(super) enum ManualConnection {
    Postgres(PoolConnection<Postgres>),
    Mysql(PoolConnection<MySql>),
    Sqlite(PoolConnection<Sqlite>),
}

impl ManualConnection {
    /// Open the session connection and BEGIN. The presentation facts normal reads
    /// use (MONEY scale, a fixed session offset) are probed first, outside the
    /// transaction, so a compatible server that rejects the probe cannot abort
    /// it; the per-pool cache skips the probe after the pool's first session.
    pub(super) async fn begin(pool: &DbPool) -> AppResult<ManualLink> {
        let (connection, facts) = match pool {
            DbPool::Postgres(pool) => {
                let mut connection = pool.acquire().await?;
                connection.close_on_drop();
                let facts = executor::read::pg_session_facts(pool, &mut connection).await;
                sqlx::query("BEGIN").execute(&mut *connection).await?;
                (Self::Postgres(connection), facts)
            }
            DbPool::Mysql(pool) => {
                let mut connection = pool.acquire().await?;
                connection.close_on_drop();
                let facts = executor::read::mysql_session_facts(pool, &mut connection).await;
                sqlx::query("START TRANSACTION")
                    .execute(&mut *connection)
                    .await?;
                (Self::Mysql(connection), facts)
            }
            DbPool::Sqlite(pool) => {
                let mut connection = pool.acquire().await?;
                connection.close_on_drop();
                sqlx::query("BEGIN").execute(&mut *connection).await?;
                (
                    Self::Sqlite(connection),
                    executor::read::SessionFacts::default(),
                )
            }
            DbPool::Bigquery(_) | DbPool::CloudflareD1(_) => {
                return Err(refused(ManualTransactionRefusal::Unsupported))
            }
        };
        Ok(ManualLink {
            connection,
            facts,
            statement_savepoint: false,
        })
    }

    /// Send COMMIT or ROLLBACK with a bounded wait, then close the connection.
    /// A failed or unacknowledged ROLLBACK still ends the transaction: the
    /// server rolls back when the connection closes. A failed COMMIT has an
    /// unknown outcome, reported as the returned detail.
    pub(super) async fn finish(mut self, commit: bool) -> Result<(), String> {
        let statement = if commit { "COMMIT" } else { "ROLLBACK" };
        let acknowledged = tokio::time::timeout(FINISH_TIMEOUT, async {
            match &mut self {
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
            }
        })
        .await;
        match acknowledged {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(crate::error::db_error_text(&error).to_string()),
            Err(_) => Err(format!(
                "{statement} was not acknowledged within {}s; the connection was closed",
                FINISH_TIMEOUT.as_secs()
            )),
        }
    }
}

/// The session connection, the presentation facts its reads decode with, and
/// whether the previous write's savepoint is still open (it is released lazily
/// in the next write's round trip).
pub(super) struct ManualLink {
    pub(super) connection: ManualConnection,
    pub(super) facts: executor::read::SessionFacts,
    pub(super) statement_savepoint: bool,
}

/// Why a statement did not complete normally.
pub(super) enum StatementError {
    /// The statement failed and was rolled back to its own savepoint; the
    /// transaction remains open.
    RolledBack(AppError),
    /// The savepoint could not be restored, so the transaction can only be
    /// rolled back.
    Poisoned(AppError),
}

/// How a statement failed at the session level.
pub(super) enum SessionFailure {
    /// The statement was refused or failed; the transaction stays as reported.
    Statement(AppError),
    /// The statement was cancelled or timed out. Its connection was closed, so
    /// the server stops it and rolls the whole transaction back.
    Abandoned {
        error: AppError,
        reason: ManualTransactionEndReason,
    },
}

/// Session facts read without waiting for the connection.
#[derive(Default)]
pub(super) struct ManualSessionInfo {
    pub(super) failed: bool,
    pub(super) statement_count: u64,
    pub(super) rolled_back_statement_count: u64,
    /// Cancellation identity of the statement currently holding the connection.
    pub(super) running: Option<Uuid>,
}

pub(super) struct ManualSession {
    pub(super) transaction_id: Uuid,
    pub(super) connection_id: Uuid,
    pub(super) database: String,
    pub(super) engine: Engine,
    pub(super) started_at: DateTime<Utc>,
    pub(super) expires_at: DateTime<Utc>,
    /// The exact authority that opened the session, re-checked at COMMIT.
    pub(super) pin: PinnedConnection,
    pub(super) info: StdMutex<ManualSessionInfo>,
    /// `None` once the transaction ended or its connection was closed.
    pub(super) link: Mutex<Option<ManualLink>>,
    pub(super) _retention: Box<dyn std::any::Any + Send + Sync>,
}

impl ManualSession {
    pub(super) fn status(&self) -> ManualTransactionStatus {
        let info = lock_unpoisoned(&self.info);
        ManualTransactionStatus {
            transaction_id: self.transaction_id,
            connection_id: self.connection_id,
            database: self.database.clone(),
            phase: if info.failed {
                ManualTransactionPhase::Failed
            } else {
                ManualTransactionPhase::Active
            },
            statement_count: info.statement_count,
            rolled_back_statement_count: info.rolled_back_statement_count,
            started_at: self.started_at,
            expires_at: self.expires_at,
        }
    }

    /// Take the connection for COMMIT without waiting behind a statement.
    pub(super) fn take_for_commit(&self) -> AppResult<ManualLink> {
        let mut link = self
            .link
            .try_lock()
            .map_err(|_| refused(ManualTransactionRefusal::StatementRunning))?;
        if lock_unpoisoned(&self.info).failed {
            return Err(refused(ManualTransactionRefusal::Failed));
        }
        link.take()
            .ok_or_else(|| refused(ManualTransactionRefusal::Ended))
    }

    /// Roll the transaction back. A running statement is cancelled first so the
    /// rollback never waits for it; if the connection is still unavailable after
    /// a short wait, it closes when that statement finishes, which rolls back.
    /// Returns a detail for the audit record when ROLLBACK was not acknowledged.
    pub(super) async fn roll_back(&self) -> Option<String> {
        let running = lock_unpoisoned(&self.info).running;
        if let Some(running) = running {
            executor::cancel::cancel(running);
        }
        let link = match tokio::time::timeout(STATEMENT_RELEASE_TIMEOUT, self.link.lock()).await {
            Ok(mut link) => link.take(),
            Err(_) => {
                return Some(
                    "a running statement did not release the connection; it closes when the statement stops"
                        .into(),
                )
            }
        };
        match link {
            Some(link) => link.connection.finish(false).await.err(),
            None => None,
        }
    }

    /// Run one statement (or script) on the session connection.
    ///
    /// The connection is awaited under the statement's own cancellation, so a
    /// queued statement can be cancelled without touching the transaction. A
    /// statement abandoned mid-flight closes the connection instead of draining
    /// it: the server stops the statement and rolls the transaction back.
    pub(super) async fn execute<T>(
        &self,
        cancellation: Option<&executor::cancel::CancelHandle>,
        statements: u64,
        work: impl AsyncFnOnce(&mut ManualLink) -> Result<T, StatementError>,
    ) -> Result<T, SessionFailure> {
        let fallback;
        let cancellation = match cancellation {
            Some(cancellation) => cancellation,
            None => {
                fallback = executor::cancel::register(Uuid::new_v4());
                &fallback
            }
        };
        let wall = executor::cancel::QUERY_TIMEOUT;
        let mut link = match executor::cancel::run_or_abandon(
            Some(cancellation),
            wall,
            self.link.lock(),
        )
        .await
        {
            Ok(link) => link,
            Err(abandoned) => return Err(SessionFailure::Statement(abandoned.into_error(wall))),
        };
        if link.is_none() {
            return Err(SessionFailure::Statement(refused(
                ManualTransactionRefusal::Ended,
            )));
        }
        if lock_unpoisoned(&self.info).failed {
            return Err(SessionFailure::Statement(refused(
                ManualTransactionRefusal::Failed,
            )));
        }
        if self.expires_at <= Utc::now() {
            return Err(SessionFailure::Statement(refused(
                ManualTransactionRefusal::Expired,
            )));
        }
        lock_unpoisoned(&self.info).running = Some(cancellation.id());
        let outcome = {
            let active = link.as_mut().expect("checked open manual transaction link");
            executor::cancel::run_or_abandon(Some(cancellation), wall, work(active)).await
        };
        let mut info = lock_unpoisoned(&self.info);
        info.running = None;
        match outcome {
            Ok(Ok(value)) => {
                info.statement_count += statements;
                Ok(value)
            }
            Ok(Err(StatementError::RolledBack(error))) => {
                info.rolled_back_statement_count += 1;
                Err(SessionFailure::Statement(error))
            }
            Ok(Err(StatementError::Poisoned(error))) => {
                info.failed = true;
                Err(SessionFailure::Statement(error))
            }
            Err(abandoned) => {
                drop(info);
                // Dropping the link closes the connection (close-on-drop).
                drop(link.take());
                Err(SessionFailure::Abandoned {
                    error: abandoned.into_error(wall),
                    reason: match abandoned {
                        executor::cancel::Abandoned::Cancelled => {
                            ManualTransactionEndReason::StatementCancelled
                        }
                        executor::cancel::Abandoned::TimedOut => {
                            ManualTransactionEndReason::StatementTimedOut
                        }
                    },
                })
            }
        }
    }
}
