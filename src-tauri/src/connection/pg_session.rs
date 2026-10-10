//! PostgreSQL session state for pooled connections: what each pool runs when it
//! opens a connection and when it takes one back.
//!
//! On connect the read pool sets `default_transaction_read_only = on`, both pools
//! apply best-effort defaults, the managed schema owner policy runs, and the
//! startup script runs last.
//!
//! A user-defined function called by a statement classified as a read can change
//! session state (`set_config` inside the function), and that change would follow
//! the pooled connection to its next read. L1 rejects direct `set_config` calls
//! and `SET`; as defense in depth the read pool's release batch refuses a
//! connection still inside a transaction, re-asserts the read-only default,
//! releases every session advisory lock (a `pg_advisory_lock` taken by a read, the
//! Agent's L2 read included, must not outlive it and block an application),
//! restores the connect-time role and `search_path`, and re-applies the startup
//! script. It is one simple-protocol message, so any failure fails all of it and
//! SQLx closes the connection instead of reusing it.
//!
//! The batch is all-or-nothing, so a step a PostgreSQL-compatible server lacks
//! would close every connection. A pool tries the full batch on its first release;
//! if that fails, the connection is closed and the next release probes each
//! optional step alone, and the pool keeps the batch that works. A server whose
//! `now()` differs from `statement_timestamp()` even in a fresh transaction cannot
//! use the transaction guard, so its batch starts with `ROLLBACK` instead (a
//! "no transaction in progress" warning in that server's log). Connecting adds
//! no round trip; each release costs one, in SQLx's release task (off the
//! caller's path), so a burst of back-to-back reads may wait about one round trip
//! longer for that connection or open another one up to the pool limit.
//!
//! Through a transaction-mode pooler ([`super::providers::pg_transaction_pooler`])
//! consecutive transactions may run on server sessions other clients share, so a
//! session-level `SET` would neither stick nor stay private. Those pools run no
//! DopeDB session statement at all — no read-only default, best-effort defaults,
//! startup script, or restore steps; only the transaction guard on release — and
//! every read opens its own `BEGIN READ ONLY … ROLLBACK`.

use std::sync::{Arc, Mutex};

use sqlx::{AssertSqlSafe, Executor, PgConnection};

use crate::kernel::sync::lock_unpoisoned;

/// Fails only when the connection is still inside a transaction an earlier
/// message opened: within one message `now()` (the transaction's start) equals
/// `statement_timestamp()` (this message's receipt) unless a transaction began
/// before it. Unlike a bare `ROLLBACK`, it is silent in the normal case — no
/// "no transaction in progress" WARNING in the client or the server log — and in
/// the anomalous case the error closes the connection, so the server rolls back.
/// The ELSE branch is not constant, so the planner cannot fold it into an error.
const RELEASE_GUARD: &str = "SELECT CASE WHEN now() = statement_timestamp() THEN 1 \
     ELSE (statement_timestamp()::text || ' dopedb: connection released inside a transaction')::int END";
const RELEASE_GUARD_MARKER: &str = "dopedb: connection released inside a transaction";
/// The guard's fallback: ends any open transaction, which also reverts the `SET`.
/// Outside one, PostgreSQL warns before the implicit transaction aborts, so the
/// warning is raised while `client_min_messages` hides it from the client, and the
/// abort reverts the `SET`. In an aborted transaction the `SET` fails, and the
/// connection is closed like any failed release.
const RELEASE_ROLLBACK: &str = "SET client_min_messages = error; ROLLBACK";
/// The one release step that is never optional.
const RELEASE_READ_ONLY: &str = "SET default_transaction_read_only = on";
const RELEASE_ADVISORY_UNLOCK: &str = "SELECT pg_advisory_unlock_all()";

/// How one pool prepares and takes back its PostgreSQL sessions.
pub(super) struct PgSessionPlan {
    /// Managed schema owner whose policy `prepare` enforces and whose role it sets.
    owner: Option<String>,
    /// Validated startup script: only allowlisted literal `SET`s.
    startup: Option<Arc<str>>,
    transaction_pooler: bool,
    release: Mutex<ReleasePlan>,
}

/// What the read pool runs on release; settled lazily by its first releases.
enum ReleasePlan {
    /// Not tried yet: run every step.
    Optimistic,
    /// The full batch failed: probe each optional step on the next release.
    Probe,
    /// The batch this server accepts.
    Settled(String),
}

/// Optional release steps this server accepts.
#[derive(Debug, Clone, Copy)]
struct ReleaseSupport {
    guard: bool,
    advisory_unlock: bool,
    role: bool,
    search_path: bool,
}

impl ReleaseSupport {
    const ALL: Self = Self {
        guard: true,
        advisory_unlock: true,
        role: true,
        search_path: true,
    };
}

async fn run(conn: &mut PgConnection, sql: &str) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(AssertSqlSafe(sql.to_owned()))
        .execute(conn)
        .await
        .map(|_| ())
}

impl PgSessionPlan {
    pub(super) fn new(
        owner: Option<String>,
        startup: Option<Arc<str>>,
        transaction_pooler: bool,
    ) -> Self {
        Self {
            owner,
            startup,
            transaction_pooler,
            release: Mutex::new(ReleasePlan::Optimistic),
        }
    }

    /// The read pool's `after_connect`. A fresh connection is already clean, so it
    /// runs no release step.
    pub(super) async fn prepare_read(&self, conn: &mut PgConnection) -> Result<(), sqlx::Error> {
        self.prepare_common(conn, true).await.map(|_| ())
    }

    /// The write pool's `after_connect`.
    pub(super) async fn prepare_write(&self, conn: &mut PgConnection) -> Result<(), sqlx::Error> {
        self.prepare_common(conn, false).await.map(|_| ())
    }

    /// The read pool's `after_release`: `true` returns the connection to the pool,
    /// `false` closes it.
    pub(super) async fn release(&self, conn: &mut PgConnection) -> bool {
        if self.transaction_pooler {
            return run(conn, RELEASE_GUARD).await.is_ok();
        }
        // Decide under the lock, act without it.
        let (settled, probe) = match &*lock_unpoisoned(&self.release) {
            ReleasePlan::Settled(batch) => (Some(batch.clone()), false),
            ReleasePlan::Optimistic => (None, false),
            ReleasePlan::Probe => (None, true),
        };
        if probe {
            return self.probe_and_settle(conn).await;
        }
        if let Some(batch) = settled {
            return run(conn, &batch).await.is_ok();
        }
        let batch = self.release_batch(ReleaseSupport::ALL);
        let ok = run(conn, &batch).await.is_ok();
        let mut plan = lock_unpoisoned(&self.release);
        if matches!(*plan, ReleasePlan::Optimistic) {
            *plan = if ok {
                ReleasePlan::Settled(batch)
            } else {
                ReleasePlan::Probe
            };
        }
        ok
    }

    /// Probes each optional step alone, then runs and keeps the batch that works.
    /// A connection the guard finds inside a transaction is rolled back and asked
    /// again, so a guard this server cannot evaluate is told apart from one.
    async fn probe_and_settle(&self, conn: &mut PgConnection) -> bool {
        let guard = match run(conn, RELEASE_GUARD).await {
            Ok(()) => true,
            // Either an earlier message left a transaction open (the guard's error
            // aborted it), or this server's clock reads differ even in a fresh
            // transaction. A bare `ROLLBACK` ends even an aborted transaction; ask
            // again, since a guard that still fails would close every connection.
            Err(error) if error.to_string().contains(RELEASE_GUARD_MARKER) => {
                if run(conn, "ROLLBACK").await.is_err() {
                    return false;
                }
                run(conn, RELEASE_GUARD).await.is_ok()
            }
            Err(_) => false,
        };
        let support = ReleaseSupport {
            guard,
            advisory_unlock: run(conn, RELEASE_ADVISORY_UNLOCK).await.is_ok(),
            role: run(conn, &self.role_restore()).await.is_ok(),
            search_path: run(conn, self.search_path_restore()).await.is_ok(),
        };
        // The probe touched session state; the batch restores it.
        let batch = self.release_batch(support);
        if run(conn, &batch).await.is_err() {
            return false;
        }
        let mut plan = lock_unpoisoned(&self.release);
        if matches!(*plan, ReleasePlan::Probe) {
            *plan = ReleasePlan::Settled(batch);
        }
        true
    }

    /// Runs the connect-time session setup; `false` when a transaction-mode pooler
    /// means no session statement may run.
    async fn prepare_common(
        &self,
        conn: &mut PgConnection,
        read_only: bool,
    ) -> Result<bool, sqlx::Error> {
        if let Some(owner) = self.owner.as_deref() {
            super::gcp_schema_policy::prepare(conn, owner).await?;
        }
        if self.transaction_pooler {
            return Ok(false);
        }
        if read_only {
            conn.execute("SET default_transaction_read_only = on")
                .await?;
        }
        apply_session_defaults(conn, read_only).await;
        if let Some(script) = self.startup.as_deref() {
            sqlx::raw_sql(AssertSqlSafe(script.to_owned()))
                .execute(&mut *conn)
                .await?;
        }
        Ok(true)
    }

    /// The role to restore: the managed schema owner `prepare` set (its name was
    /// validated there), otherwise the login role (a startup script cannot set one).
    fn role_restore(&self) -> String {
        match self.owner.as_deref() {
            Some(owner) if !owner.is_empty() => format!("SET ROLE \"{owner}\""),
            _ => "RESET ROLE".to_owned(),
        }
    }

    /// `public` is what the managed schema policy requires; otherwise the
    /// connection-start value.
    fn search_path_restore(&self) -> &'static str {
        if self.owner.is_some() {
            "SET search_path = public"
        } else {
            "RESET search_path"
        }
    }

    /// The release batch (see the module doc). Steps the server lacks are left out.
    fn release_batch(&self, support: ReleaseSupport) -> String {
        let mut steps = Vec::with_capacity(5);
        steps.push(if support.guard {
            RELEASE_GUARD.to_owned()
        } else {
            RELEASE_ROLLBACK.to_owned()
        });
        steps.push(RELEASE_READ_ONLY.to_owned());
        if support.advisory_unlock {
            steps.push(RELEASE_ADVISORY_UNLOCK.to_owned());
        }
        if support.role {
            steps.push(self.role_restore());
        }
        if support.search_path {
            steps.push(self.search_path_restore().to_owned());
        }
        let mut batch = steps.join("; ");
        if let Some(script) = self.startup.as_deref() {
            batch.push_str(";\n");
            batch.push_str(script);
        }
        batch
    }
}

/// Best-effort PostgreSQL session settings shared by both pools. Unknown settings on a
/// PostgreSQL-compatible server must not fail the connection, so each is optional.
///   - `client_connection_check_interval` (14+) lets the server abort a statement
///     whose client connection was closed by a cancel or timeout instead of running
///     it to completion.
async fn apply_session_defaults(conn: &mut PgConnection, read_only: bool) {
    let mut statements: Vec<&'static str> = Vec::with_capacity(2);
    if conn
        .server_version_num()
        .is_some_and(|version| version >= 140_000)
    {
        statements.push("SET client_connection_check_interval = '2s'");
    }
    if read_only {
        // A synchronized sequential scan starts wherever a concurrent scan is, so the
        // same LIMIT/OFFSET page could return different rows on every request.
        statements.push("SET synchronize_seqscans = off");
    }
    if statements.is_empty() {
        return;
    }
    // One simple-protocol round trip for every new connection. A compatible
    // server that rejects one setting rolls back the whole implicit block, so
    // fall back to applying each best-effort setting on its own.
    let batch = statements.join("; ");
    if sqlx::raw_sql(AssertSqlSafe(batch))
        .execute(&mut *conn)
        .await
        .is_err()
        && statements.len() > 1
    {
        for statement in statements {
            let _ = conn.execute(statement).await;
        }
    }
}
