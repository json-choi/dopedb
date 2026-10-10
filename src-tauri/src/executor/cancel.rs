//! Process-wide query cancellation + a wall-clock guard.
//!
//! The desktop read/write paths hold a pooled DB connection for the life of the
//! query. Without a guard a slow statement pins that connection and hangs the tab
//! forever. [`guard`] wraps the query future in a `tokio::select!` between the
//! query, a wall-clock timeout, and an on-demand cancel signal keyed by the
//! frontend's `query_id`. On cancel/timeout the query future is dropped
//! mid-flight. A plain pooled connection dropped there would be returned to the
//! pool only after sqlx drained the abandoned statement — the server kept running
//! it and the next query waited behind it — so executors hold their connection in
//! [`AbandonClosingConnection`], which closes it instead. PostgreSQL 14+ sessions
//! set `client_connection_check_interval`, so the server aborts the statement once
//! the socket closes; other engines stop when they next write to the closed socket.

use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use tokio::sync::watch;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::sync::lock_unpoisoned;

/// Default wall-clock ceiling for a desktop read/write.
pub const QUERY_TIMEOUT: Duration = Duration::from_secs(300);

/// A pooled connection that is closed, never reused, if the future owning it is
/// dropped before [`release`](Self::release). Callers await their whole statement
/// sequence, then release on both success and ordinary SQL errors; only an
/// abandoned (cancelled or timed-out) future reaches `Drop` while still holding it.
pub(crate) struct AbandonClosingConnection<DB: sqlx::Database> {
    connection: Option<sqlx::pool::PoolConnection<DB>>,
}

impl<DB: sqlx::Database> AbandonClosingConnection<DB> {
    pub(crate) async fn acquire(pool: &sqlx::Pool<DB>) -> Result<Self, sqlx::Error> {
        Ok(Self {
            connection: Some(pool.acquire().await?),
        })
    }

    /// The statement sequence finished (successfully or with a database error);
    /// return the connection to the pool for reuse.
    pub(crate) fn release(mut self) {
        drop(self.connection.take());
    }
}

impl<DB: sqlx::Database> std::ops::Deref for AbandonClosingConnection<DB> {
    type Target = DB::Connection;

    fn deref(&self) -> &Self::Target {
        self.connection
            .as_deref()
            .expect("the connection is held until release")
    }
}

impl<DB: sqlx::Database> std::ops::DerefMut for AbandonClosingConnection<DB> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.connection
            .as_deref_mut()
            .expect("the connection is held until release")
    }
}

impl<DB: sqlx::Database> Drop for AbandonClosingConnection<DB> {
    fn drop(&mut self) {
        if let Some(connection) = self.connection.as_mut() {
            connection.close_on_drop();
        }
    }
}

// ponytail: one global lock over a small map keyed by unique v4 UUIDs. Contention
// is a non-issue at desktop scale; shard only if that ever changes.
struct CancelSlot {
    sender: watch::Sender<bool>,
    handles: usize,
}

static REGISTRY: LazyLock<Mutex<HashMap<Uuid, CancelSlot>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// A live cancellation slot. Unregisters itself on drop (query finished/aborted).
pub struct CancelHandle {
    id: Uuid,
    rx: watch::Receiver<bool>,
}

impl CancelHandle {
    /// Exact operation/query identity that owns this cancellation slot.
    pub const fn id(&self) -> Uuid {
        self.id
    }

    /// Return the currently stored signal without waiting.
    pub fn is_cancelled(&self) -> bool {
        *self.rx.borrow()
    }

    /// Resolves once the query is cancelled. `watch` stores the flag, so a cancel
    /// that races ahead of this await is never lost.
    pub async fn cancelled(&self) {
        let mut rx = self.rx.clone();
        let _ = rx.wait_for(|v| *v).await;
    }
}

impl Drop for CancelHandle {
    fn drop(&mut self) {
        let mut registry = lock_unpoisoned(&REGISTRY);
        let Entry::Occupied(mut entry) = registry.entry(self.id) else {
            return;
        };
        if entry.get().handles > 1 {
            entry.get_mut().handles -= 1;
        } else {
            entry.remove();
        }
    }
}

/// Register or join the cancellation slot for `id`. Concurrent claim attempts for
/// one immutable operation share the same signal, and the slot remains registered
/// until every handle has dropped.
pub fn register(id: Uuid) -> CancelHandle {
    let mut registry = lock_unpoisoned(&REGISTRY);
    let rx = match registry.entry(id) {
        Entry::Occupied(mut entry) => {
            entry.get_mut().handles += 1;
            entry.get().sender.subscribe()
        }
        Entry::Vacant(entry) => {
            let (sender, receiver) = watch::channel(false);
            entry.insert(CancelSlot { sender, handles: 1 });
            receiver
        }
    };
    CancelHandle { id, rx }
}

/// Signal cancellation for `id`. Returns `true` iff a query was registered under it.
pub fn cancel(id: Uuid) -> bool {
    match lock_unpoisoned(&REGISTRY).get(&id) {
        Some(slot) => {
            let _ = slot.sender.send(true);
            true
        }
        None => false,
    }
}

/// Run `fut` under a cancellation slot (if `query_id` is set) and a wall-clock
/// timeout. Cancel or timeout drops `fut` (and its in-flight connection) and
/// returns a clear error. The slot auto-unregisters when this returns.
pub async fn guard<T, F>(query_id: Option<Uuid>, wall: Duration, fut: F) -> AppResult<T>
where
    F: std::future::Future<Output = AppResult<T>>,
{
    let handle = query_id.map(register); // dropped at fn end → unregister
    guard_registered(handle.as_ref(), wall, fut).await
}

/// Run under a cancellation slot that was registered before an async preparation
/// boundary. This keeps a cancel signal sent immediately after an operation claim
/// from being lost before target execution begins.
pub async fn guard_registered<T, F>(
    handle: Option<&CancelHandle>,
    wall: Duration,
    fut: F,
) -> AppResult<T>
where
    F: std::future::Future<Output = AppResult<T>>,
{
    match run_or_abandon(handle, wall, fut).await {
        Ok(result) => result,
        Err(abandoned) => Err(abandoned.into_error(wall)),
    }
}

/// Why a guarded future was dropped before it completed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Abandoned {
    Cancelled,
    TimedOut,
}

impl Abandoned {
    /// The error [`guard_registered`] reports for this outcome.
    pub(crate) fn into_error(self, wall: Duration) -> AppError {
        match self {
            Self::Cancelled => AppError::Safety("query cancelled".into()),
            Self::TimedOut => AppError::Safety(format!(
                "query timed out after {}s and was aborted",
                wall.as_secs()
            )),
        }
    }
}

/// Race `fut` against the cancellation slot and a wall-clock limit, reporting
/// whether it completed or was abandoned. Owners of a stateful connection use
/// this to close that connection when a statement is abandoned mid-flight.
pub(crate) async fn run_or_abandon<T, F>(
    handle: Option<&CancelHandle>,
    wall: Duration,
    fut: F,
) -> Result<T, Abandoned>
where
    F: std::future::Future<Output = T>,
{
    tokio::select! {
        biased;
        _ = async {
            match handle {
                Some(h) => h.cancelled().await,
                None => std::future::pending::<()>().await,
            }
        } => Err(Abandoned::Cancelled),
        r = tokio::time::timeout(wall, fut) => r.map_err(|_| Abandoned::TimedOut),
    }
}

/// Cancel an in-flight query by its id. `false` if nothing was running under it.
#[tauri::command]
pub async fn cancel_query(query_id: uuid::Uuid) -> bool {
    cancel(query_id)
}
