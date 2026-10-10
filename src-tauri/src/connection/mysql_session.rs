//! MySQL session state for the pooled read connections: what the read pool runs
//! when it opens a connection and when it takes one back.
//!
//! Connect sets `SESSION transaction_read_only = 1` (MariaDB before 11.1 only
//! knows `tx_read_only`; a server with neither is refused), then the startup
//! script. A plain `SELECT` cannot assign a system variable, but a stored function
//! it calls can run `SET SESSION transaction_read_only = 0`, and the L2 Agent read
//! sets `SESSION max_execution_time`; either would follow the pooled connection to
//! its next read. Each release therefore sends one message:
//! `ROLLBACK` (a silent no-op outside a transaction), `max_execution_time` back to
//! the server default, the read-only re-assert, and the startup script again.
//! A server that refuses that message (MariaDB has no `max_execution_time`; a proxy
//! may refuse two statements in one message) closes that connection, and the pool
//! falls back to a shorter form on later releases. Connecting adds no round trip;
//! each release costs one, in SQLx's release task.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use sqlx::{AssertSqlSafe, Executor, MySqlConnection};

const READ_ONLY: &str = "SET SESSION transaction_read_only = 1";
const LEGACY_READ_ONLY: &str = "SET SESSION tx_read_only = 1";

/// How the read pool prepares and takes back its MySQL sessions.
pub(super) struct MySqlReadSession {
    /// Validated startup script: only allowlisted literal `SET`s.
    startup: Option<Arc<str>>,
    /// The server accepted only MariaDB's `tx_read_only`.
    legacy: AtomicBool,
    /// Which release form this server accepts (see [`Self::release_forms`]).
    form: AtomicUsize,
}

impl MySqlReadSession {
    pub(super) fn new(startup: Option<Arc<str>>) -> Self {
        Self {
            startup,
            legacy: AtomicBool::new(false),
            form: AtomicUsize::new(0),
        }
    }

    /// The read pool's `after_connect`. Fails CLOSED: a server that accepts
    /// neither read-only variable is refused rather than handed back writable.
    pub(super) async fn prepare(&self, conn: &mut MySqlConnection) -> Result<(), sqlx::Error> {
        if conn.execute(READ_ONLY).await.is_err() {
            if conn.execute(LEGACY_READ_ONLY).await.is_err() {
                return Err(sqlx::Error::Configuration(
                    "read-only pool: server accepts neither `transaction_read_only` \
                     nor `tx_read_only` — refusing a silently writable read pool"
                        .into(),
                ));
            }
            self.legacy.store(true, Ordering::Relaxed);
        }
        if let Some(script) = self.startup.as_deref() {
            sqlx::raw_sql(AssertSqlSafe(script.to_owned()))
                .execute(&mut *conn)
                .await?;
        }
        Ok(())
    }

    /// The read pool's `after_release`: `true` returns the connection to the pool,
    /// `false` closes it.
    pub(super) async fn release(&self, conn: &mut MySqlConnection) -> bool {
        let forms = self.release_forms();
        let index = self.form.load(Ordering::Relaxed).min(forms.len() - 1);
        match sqlx::raw_sql(AssertSqlSafe(forms[index].clone()))
            .execute(&mut *conn)
            .await
        {
            Ok(_) => true,
            Err(error) => {
                // Only a server refusal moves to a shorter form; a dropped
                // connection says nothing about what the server accepts.
                if matches!(error, sqlx::Error::Database(_)) && index + 1 < forms.len() {
                    let _ = self.form.compare_exchange(
                        index,
                        index + 1,
                        Ordering::Relaxed,
                        Ordering::Relaxed,
                    );
                }
                false
            }
        }
    }

    /// Release messages from most to least complete; each later one drops what a
    /// server may refuse.
    fn release_forms(&self) -> [String; 3] {
        let read_only = if self.legacy.load(Ordering::Relaxed) {
            LEGACY_READ_ONLY
        } else {
            READ_ONLY
        };
        let mut full = format!("ROLLBACK; SET SESSION max_execution_time = DEFAULT; {read_only}");
        if let Some(script) = self.startup.as_deref() {
            full.push_str(";\n");
            full.push_str(script);
        }
        [full, format!("ROLLBACK; {read_only}"), read_only.to_owned()]
    }
}
