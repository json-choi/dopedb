//! Connection-scoped manual SQL transactions.
//!
//! A session owns one physical SQLx connection plus a retention of the exact pool
//! that authorized it. Desktop SQL, table edits, and the Agent's single write
//! target can therefore share one rollback boundary without exposing database
//! credentials or transaction handles to the renderer or CLI.
//!
//! Lifecycle guarantees:
//! - Each write runs inside a statement savepoint, so a failed statement is rolled
//!   back alone and the transaction stays open; reads run inside a read-only scope
//!   (PostgreSQL `SET LOCAL transaction_read_only`, SQLite `query_only`, a
//!   rolled-back savepoint on MySQL) so a misclassified read cannot write.
//! - A cancelled or timed-out statement closes the session connection. The server
//!   then stops the statement and rolls the whole transaction back; the session
//!   ends with that reason instead of waiting for the abandoned statement.
//! - COMMIT re-checks the current authority and device Safety gate, and both
//!   COMMIT and ROLLBACK are bounded; an unacknowledged COMMIT is audited as an
//!   unknown outcome.
//! - Every end publishes a reason (`manual-transaction:changed`), so the UI can
//!   explain expiry, cancellation, and authority-change rollbacks.
//!
//! This module owns the session map, BEGIN, and statement routing. COMMIT and
//! per-statement authority re-verification live in `manual_transaction_authority`,
//! every other end (ROLLBACK, expiry, revocation, shutdown) in
//! `manual_transaction_lifecycle`, the connection and statement savepoints in
//! `manual_transaction_session`, and engine SQL in `manual_transaction_execution`.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::Serialize;
use sqlx::mysql::MySql;
use sqlx::pool::PoolConnection;
use sqlx::postgres::Postgres;
use sqlx::sqlite::Sqlite;
use sqlx::{AssertSqlSafe, Executor, SqlSafeStr};
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

use crate::connection::{
    ConnectionAccess, ConnectionManager, ConnectionSessionRevocationPort, DbPool,
};
use crate::error::{AppError, AppResult, ManualTransactionRefusal};
use crate::executor;
use crate::kernel::access::PinnedConnection;
use crate::kernel::sync::lock_unpoisoned;
use crate::model::{
    Classification, Engine, ExecOutcome, QueryKind, QueryResult, SafetySettings, ScriptStatement,
};
use crate::operations::ExecutionGrant;
use crate::store::Store;

#[path = "manual_transaction_authority.rs"]
mod authority;
#[path = "manual_transaction_execution.rs"]
mod execution;
#[path = "manual_transaction_lifecycle.rs"]
mod lifecycle;
#[path = "manual_transaction_session.rs"]
mod session;

use execution::*;
use lifecycle::ExitPrompt;
pub(crate) use lifecycle::{ExitDecision, ExitIntent};
use session::*;

const MANUAL_TRANSACTION_TTL: ChronoDuration = ChronoDuration::minutes(30);
/// Bound on a COMMIT/ROLLBACK acknowledgement. Past it the connection is closed:
/// the server then rolls the transaction back, and a commit outcome is unknown.
const FINISH_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a rollback waits for a cancelled statement to release its connection.
const STATEMENT_RELEASE_TIMEOUT: Duration = Duration::from_secs(5);

fn refused(refusal: ManualTransactionRefusal) -> AppError {
    AppError::ManualTransaction(refusal)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ManualTransactionPhase {
    Active,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualTransactionStatus {
    pub(crate) transaction_id: Uuid,
    pub(crate) connection_id: Uuid,
    pub(crate) database: String,
    pub(crate) phase: ManualTransactionPhase,
    pub(crate) statement_count: u64,
    /// Statements that failed and were rolled back to their own savepoint
    /// without ending the transaction.
    pub(crate) rolled_back_statement_count: u64,
    pub(crate) started_at: DateTime<Utc>,
    pub(crate) expires_at: DateTime<Utc>,
}

/// Why a manual transaction ended. The UI explains every reason other than an
/// explicit commit or rollback, because those happen without a user action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ManualTransactionEndReason {
    Committed,
    RolledBack,
    CommitOutcomeUnknown,
    Expired,
    StatementCancelled,
    StatementTimedOut,
    AuthorityChanged,
    ConnectionChanged,
    WorkspaceChanged,
    ApplicationExit,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualTransactionEnded {
    pub(crate) transaction_id: Uuid,
    pub(crate) database: String,
    pub(crate) reason: ManualTransactionEndReason,
    pub(crate) statement_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualTransactionChanged {
    pub(crate) connection_id: Uuid,
    pub(crate) status: Option<ManualTransactionStatus>,
    pub(crate) ended: Option<ManualTransactionEnded>,
}

pub(crate) struct ManualScriptExecution {
    pub(crate) statements: Vec<ScriptStatement>,
}

pub(crate) struct ManualExecutionTarget<'a> {
    pub(crate) connection_id: Uuid,
    pub(crate) database: &'a str,
    pub(crate) namespace: Option<String>,
}

pub(crate) struct ManualScriptRequest<'a> {
    pub(crate) target: ManualExecutionTarget<'a>,
    pub(crate) statements: &'a [String],
    pub(crate) kinds: &'a [QueryKind],
    pub(crate) expected_affected: Option<&'a [u64]>,
    pub(crate) max_rows: u64,
    pub(crate) cancellation: &'a executor::cancel::CancelHandle,
    pub(crate) grant: &'a ExecutionGrant,
    pub(crate) contains_unsupported_kind: bool,
}

#[derive(Clone)]
pub(crate) struct ManualTransactionRuntime {
    store: Store,
    connections: ConnectionManager,
    sessions: Arc<Mutex<HashMap<Uuid, Arc<ManualSession>>>>,
    events: broadcast::Sender<ManualTransactionChanged>,
    exit: Arc<StdMutex<ExitPrompt>>,
}

impl ManualTransactionRuntime {
    pub(crate) fn new(store: Store, connections: ConnectionManager) -> Self {
        let (events, _) = broadcast::channel(64);
        Self {
            store,
            connections,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            events,
            exit: Arc::default(),
        }
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<ManualTransactionChanged> {
        self.events.subscribe()
    }

    /// Status reads never wait for a running statement: session facts live behind
    /// a short synchronous lock, separate from the connection.
    pub(crate) async fn snapshot(&self) -> Vec<ManualTransactionStatus> {
        let sessions = self
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let now = Utc::now();
        let mut statuses = Vec::with_capacity(sessions.len());
        for session in sessions {
            if session.expires_at <= now {
                self.spawn_expired_end(session);
            } else {
                statuses.push(session.status());
            }
        }
        statuses.sort_by_key(|status| status.connection_id);
        statuses
    }

    pub(crate) async fn begin(
        &self,
        connection_id: Uuid,
        database: Option<String>,
    ) -> AppResult<ManualTransactionStatus> {
        // The global map lock is never held across an await on a statement or a
        // network round trip; a concurrent begin is reconciled at insertion.
        if let Some(existing) = self.mapped(connection_id).await {
            return self.existing_status(&existing, database.as_deref());
        }
        let admission = self.connections.begin_session_admission().await;
        let pin = admission.pin_connection(connection_id).await?;
        if matches!(pin.profile.engine, Engine::Mongodb | Engine::Bigquery)
            || pin.profile.provider == crate::model::Provider::CloudflareD1
        {
            return Err(refused(ManualTransactionRefusal::Unsupported));
        }
        if !pin.profile.workspace_access.can_write() {
            return Err(refused(ManualTransactionRefusal::ReadOnlyRole));
        }
        let settings = self.store.get_safety(pin.connection_id).await?;
        if !settings.allow_writes {
            return Err(refused(ManualTransactionRefusal::WritesDisabled));
        }
        let engine = pin.profile.engine;
        let requested_database = database.clone();
        let start = admission
            .connect_to_database(pin, ConnectionAccess::Write, database)
            .await?;
        let database = start.target_database().to_owned();
        let link = ManualConnection::begin(start.live().sql()?.rw()?).await?;
        let start = start.into_unscoped_session();
        let started_at = Utc::now();
        let session = Arc::new(ManualSession {
            transaction_id: Uuid::new_v4(),
            connection_id,
            database,
            engine,
            started_at,
            expires_at: started_at + MANUAL_TRANSACTION_TTL,
            pin: start.pin,
            info: StdMutex::new(ManualSessionInfo::default()),
            link: Mutex::new(Some(link)),
            _retention: start.retention,
        });
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(existing) = sessions.get(&connection_id).cloned() {
                drop(sessions);
                // Dropping the new session closes its connection; the server
                // discards the empty transaction.
                drop(session);
                return self.existing_status(&existing, requested_database.as_deref());
            }
            sessions.insert(connection_id, Arc::clone(&session));
        }
        // Published in the revocation registry: release the admission fence.
        drop(start.admission);
        self.schedule_expiry(&session);
        let status = session.status();
        self.publish(connection_id, Some(status.clone()), None);
        Ok(status)
    }

    fn existing_status(
        &self,
        existing: &Arc<ManualSession>,
        database: Option<&str>,
    ) -> AppResult<ManualTransactionStatus> {
        if database.is_some_and(|database| database != existing.database) {
            return Err(refused(ManualTransactionRefusal::OtherDatabase));
        }
        let status = existing.status();
        self.publish(existing.connection_id, Some(status.clone()), None);
        Ok(status)
    }

    pub(crate) async fn status(&self, connection_id: Uuid) -> Option<ManualTransactionStatus> {
        let session = self.mapped(connection_id).await?;
        if session.expires_at <= Utc::now() {
            self.spawn_expired_end(session);
            return None;
        }
        Some(session.status())
    }

    /// Run a read inside the open transaction's read-only scope, or `None` when
    /// the connection has no open manual transaction.
    pub(crate) async fn run_read(
        &self,
        target: ManualExecutionTarget<'_>,
        sql: &str,
        max_rows: u64,
        cancellation: Option<&executor::cancel::CancelHandle>,
    ) -> Option<AppResult<QueryResult>> {
        let session = match self
            .statement_session(target.connection_id, target.database)
            .await?
        {
            Ok(session) => session,
            Err(error) => return Some(Err(error)),
        };
        let started = Instant::now();
        let engine = session.engine;
        let namespace = target.namespace;
        let result = session
            .execute(cancellation, 1, async |link: &mut ManualLink| {
                read_statement(link, engine, sql, namespace.as_deref(), max_rows).await
            })
            .await
            .map(|mut result| {
                result.duration_ms = started.elapsed().as_millis() as u64;
                result
            });
        Some(self.settle(target.connection_id, &session, result).await)
    }

    pub(crate) async fn run_write(
        &self,
        target: ManualExecutionTarget<'_>,
        classification: &Classification,
        sql: &str,
        settings: &SafetySettings,
        grant: &ExecutionGrant,
        cancellation: &executor::cancel::CancelHandle,
    ) -> Option<AppResult<ExecOutcome>> {
        let session = match self
            .statement_session(target.connection_id, target.database)
            .await?
        {
            Ok(session) => session,
            Err(error) => return Some(Err(error)),
        };
        if cancellation.id() != grant.operation_id() {
            return Some(Err(AppError::Blocked {
                reason:
                    "manual transaction cancellation scope does not match its approved operation"
                        .into(),
            }));
        }
        if !settings.allow_writes {
            return Some(Err(AppError::Blocked {
                reason: "writes are disabled for this connection (allow_writes = 0)".into(),
            }));
        }
        if matches!(classification.kind, QueryKind::Ddl | QueryKind::Privilege) {
            return Some(Err(refused(ManualTransactionRefusal::UnsupportedStatement)));
        }
        let namespace = target.namespace;
        let result = session
            .execute(Some(cancellation), 1, async |link: &mut ManualLink| {
                write_statement(link, sql, namespace.as_deref()).await
            })
            .await
            .map(|affected| ExecOutcome {
                result: None,
                affected: Some(affected),
                committed: false,
                manual_transaction: true,
            });
        Some(self.settle(target.connection_id, &session, result).await)
    }

    pub(crate) async fn run_read_streamed<F, Fut>(
        &self,
        target: ManualExecutionTarget<'_>,
        sql: &str,
        max_rows: u64,
        batch_rows: usize,
        cancellation: Option<&executor::cancel::CancelHandle>,
        on_batch: &mut F,
    ) -> Option<AppResult<executor::read::StreamedRead>>
    where
        F: FnMut(executor::read::ReadBatch) -> Fut + Send,
        Fut: Future<Output = AppResult<()>> + Send,
    {
        let session = match self
            .statement_session(target.connection_id, target.database)
            .await?
        {
            Ok(session) => session,
            Err(error) => return Some(Err(error)),
        };
        let engine = session.engine;
        let namespace = target.namespace;
        let result = session
            .execute(cancellation, 1, async |link: &mut ManualLink| {
                read_streamed_statement(
                    link,
                    engine,
                    sql,
                    namespace.as_deref(),
                    max_rows,
                    batch_rows,
                    on_batch,
                )
                .await
            })
            .await;
        Some(self.settle(target.connection_id, &session, result).await)
    }

    pub(crate) async fn run_script(
        &self,
        request: ManualScriptRequest<'_>,
    ) -> Option<AppResult<ManualScriptExecution>> {
        let session = match self
            .statement_session(request.target.connection_id, request.target.database)
            .await?
        {
            Ok(session) => session,
            Err(error) => return Some(Err(error)),
        };
        if request.cancellation.id() != request.grant.operation_id() {
            return Some(Err(AppError::Blocked {
                reason: "manual script transaction scope does not match its approved operation"
                    .into(),
            }));
        }
        let _exact_payload = (
            request.grant.payload_sha256(),
            request.grant.connection_id(),
        );
        if request.contains_unsupported_kind {
            return Some(Err(refused(ManualTransactionRefusal::UnsupportedStatement)));
        }
        let engine = session.engine;
        let namespace = request.target.namespace;
        let script = ManualScript {
            statements: request.statements,
            kinds: request.kinds,
            expected_affected: request.expected_affected,
            max_rows: request.max_rows,
        };
        let result = session
            .execute(
                Some(request.cancellation),
                request.statements.len() as u64,
                async |link: &mut ManualLink| {
                    script_statements(link, engine, namespace.as_deref(), script).await
                },
            )
            .await;
        Some(
            self.settle(request.target.connection_id, &session, result)
                .await,
        )
    }

    async fn mapped(&self, connection_id: Uuid) -> Option<Arc<ManualSession>> {
        self.sessions.lock().await.get(&connection_id).cloned()
    }

    /// The open session with this exact identity, still mapped.
    async fn exact(
        &self,
        connection_id: Uuid,
        transaction_id: Uuid,
    ) -> AppResult<Arc<ManualSession>> {
        match self.mapped(connection_id).await {
            Some(session) if session.transaction_id == transaction_id => Ok(session),
            Some(_) => Err(refused(ManualTransactionRefusal::Stale)),
            None => Err(refused(ManualTransactionRefusal::Ended)),
        }
    }

    /// Remove the session from the map only if it is still the mapped one.
    async fn unmap(&self, connection_id: Uuid, expected: &Arc<ManualSession>) -> bool {
        let mut sessions = self.sessions.lock().await;
        if sessions
            .get(&connection_id)
            .is_some_and(|current| Arc::ptr_eq(current, expected))
        {
            sessions.remove(&connection_id);
            true
        } else {
            false
        }
    }

    /// Publish a statement outcome, ending the session when the statement was
    /// abandoned (its connection is already closed and the server rolls back).
    async fn settle<T>(
        &self,
        connection_id: Uuid,
        session: &Arc<ManualSession>,
        result: Result<T, SessionFailure>,
    ) -> AppResult<T> {
        match result {
            Ok(value) => {
                self.publish_current_if_mapped(connection_id, session).await;
                Ok(value)
            }
            Err(SessionFailure::Statement(error)) => {
                self.publish_current_if_mapped(connection_id, session).await;
                Err(error)
            }
            Err(SessionFailure::Abandoned { error, reason }) => {
                self.end_session(
                    connection_id,
                    Some(Arc::clone(session)),
                    reason,
                    "statement cancelled or timed out; connection closed",
                )
                .await;
                Err(error)
            }
        }
    }

    fn publish(
        &self,
        connection_id: Uuid,
        status: Option<ManualTransactionStatus>,
        ended: Option<ManualTransactionEnded>,
    ) {
        let _ = self.events.send(ManualTransactionChanged {
            connection_id,
            status,
            ended,
        });
    }

    async fn publish_current_if_mapped(&self, connection_id: Uuid, expected: &Arc<ManualSession>) {
        let mapped = self
            .sessions
            .lock()
            .await
            .get(&connection_id)
            .is_some_and(|current| Arc::ptr_eq(current, expected));
        if mapped {
            self.publish(connection_id, Some(expected.status()), None);
        }
    }
}
