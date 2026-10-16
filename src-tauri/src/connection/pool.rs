//! Live connection pools. A write-capable [`LiveConnection`] holds a mutation pool
//! and a separate read-only pool. A read acquisition holds only the read-only pool.
//! The read-only pool is the first line of L2 enforcement at the connection level — but
//! the authoritative boundary remains the per-request read-only transaction the executor opens:
//!   - Postgres: `after_connect` sets `default_transaction_read_only = on`.
//!   - MySQL:    `after_connect` sets `SESSION transaction_read_only = 1`.
//!   - SQLite:   a second handle opened `read_only(true)` (file-level, unforgeable).
//!
//! A user-defined function called by a statement classified as a read can change
//! that session default (PostgreSQL `set_config` inside the function, a MySQL
//! stored function running `SET SESSION transaction_read_only = 0`), and the
//! change would follow the pooled connection to its next read. L1 rejects direct
//! `set_config` calls and `SET`; as defense in depth, `after_release` refuses a
//! connection a read left inside a transaction and re-asserts the read-only
//! default on every PostgreSQL and MySQL read connection returned to the pool,
//! closing a connection that cannot take it instead of reusing it. The session
//! and release plans live in `pg_session` (including transaction-mode poolers,
//! [`LiveConnection::transaction_pooler`]) and `mysql_session`. Connecting adds no
//! round trip; each release costs one, in SQLx's release task (off the caller's
//! path).

use std::sync::Arc;
use std::time::Duration;

use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlSslMode};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::{AssertSqlSafe, Connection};

use crate::error::{AppError, AppResult};
use crate::model::{ConnectionProfile, Engine, WorkspaceCredentialMode};

use super::mysql_session::MySqlReadSession;
use super::pg_session::PgSessionPlan;
use super::providers;

const MAX_CONNS: u32 = 5;
// Managed write profiles create one read and one write pool. Two connections per pool
// keep their combined maximum aligned with Neon's lease-role CONNECTION LIMIT 4; a
// managed read profile opens only its read pool.
const MANAGED_MAX_CONNS_PER_POOL: u32 = 2;
// sqlx pings every connection when it returns to the pool (that ping also flushes a
// pending rollback). Pinging again on every acquire added one more network round trip
// to each remote query, so only a connection idle long enough for a server, proxy, or
// NAT to have dropped it is probed before reuse.
const ACQUIRE_PROBE_IDLE: Duration = Duration::from_secs(15);

fn probe_idle_on_acquire<DB: sqlx::Database>(
    options: sqlx::pool::PoolOptions<DB>,
) -> sqlx::pool::PoolOptions<DB> {
    options
        .test_before_acquire(false)
        .before_acquire(|conn, meta| {
            Box::pin(async move {
                if meta.idle_for >= ACQUIRE_PROBE_IDLE {
                    conn.ping().await?;
                }
                Ok(true)
            })
        })
}

fn pool_connection_limit(mode: WorkspaceCredentialMode) -> u32 {
    if mode == WorkspaceCredentialMode::Managed {
        MANAGED_MAX_CONNS_PER_POOL
    } else {
        MAX_CONNS
    }
}

/// A live sqlx pool for one of the three supported engines. Cheap to clone — each
/// inner sqlx pool is an `Arc` handle.
#[derive(Clone)]
pub enum DbPool {
    Postgres(PgPool),
    Mysql(MySqlPool),
    Sqlite(SqlitePool),
    Bigquery(crate::bigquery::BigQueryConnection),
    CloudflareD1(crate::cloudflare_d1::D1Connection),
}

impl DbPool {
    /// `SELECT 1` liveness probe.
    pub async fn ping(&self) -> AppResult<()> {
        match self {
            DbPool::Postgres(p) => {
                sqlx::query("SELECT 1").execute(p).await?;
            }
            DbPool::Mysql(p) => {
                sqlx::query("SELECT 1").execute(p).await?;
            }
            DbPool::Sqlite(p) => {
                sqlx::query("SELECT 1").execute(p).await?;
            }
            DbPool::Bigquery(connection) => connection.ping().await?,
            DbPool::CloudflareD1(connection) => connection.ping().await?,
        }
        Ok(())
    }

    /// Close the shared SQLx pool and wake tasks waiting to acquire a connection.
    pub async fn close(&self) {
        match self {
            DbPool::Postgres(pool) => pool.close().await,
            DbPool::Mysql(pool) => pool.close().await,
            DbPool::Sqlite(pool) => pool.close().await,
            DbPool::Bigquery(_) => {}
            DbPool::CloudflareD1(_) => {}
        }
    }

    fn is_closed(&self) -> bool {
        match self {
            DbPool::Postgres(pool) => pool.is_closed(),
            DbPool::Mysql(pool) => pool.is_closed(),
            DbPool::Sqlite(pool) => pool.is_closed(),
            DbPool::Bigquery(_) => false,
            DbPool::CloudflareD1(_) => false,
        }
    }
}

/// An open connection. Write acquisitions contain separate mutation and read-only
/// pools; read acquisitions contain only the L2-enforced read-only pool. Each `DbPool`
/// variant is self-describing and cheaply cloned through its inner `Arc`.
#[derive(Clone)]
pub struct LiveConnection {
    /// L2-enforced read-only pool. Reads and read previews route through this.
    pub read_pool: DbPool,
    /// Separately opened write-capable target pool for mutation acquisitions.
    mutation_pool: Option<DbPool>,
    /// True for PlanetScale/Vitess — introspection must skip FK metadata.
    pub skip_fk_metadata: bool,
    /// True when a PostgreSQL profile goes through a transaction-mode pooler
    /// ([`providers::pg_transaction_pooler`]). Its sessions carry no DopeDB
    /// session settings — not even the read-only default — so every read must
    /// open its own `BEGIN READ ONLY … ROLLBACK`.
    pub transaction_pooler: bool,
}

impl LiveConnection {
    pub(crate) fn bigquery(connection: crate::bigquery::BigQueryConnection) -> Self {
        let read_pool = DbPool::Bigquery(connection);
        Self {
            read_pool,
            mutation_pool: None,
            skip_fk_metadata: false,
            transaction_pooler: false,
        }
    }

    pub(crate) fn cloudflare_d1(
        connection: crate::cloudflare_d1::D1Connection,
        writable: bool,
    ) -> Self {
        let read_pool = DbPool::CloudflareD1(connection.clone());
        Self {
            read_pool,
            mutation_pool: writable.then_some(DbPool::CloudflareD1(connection)),
            skip_fk_metadata: false,
            transaction_pooler: false,
        }
    }

    /// The read-only pool. Reads and all read previews route through this.
    pub fn ro(&self) -> &DbPool {
        &self.read_pool
    }

    pub(crate) fn rw(&self) -> AppResult<&DbPool> {
        self.mutation_pool
            .as_ref()
            .ok_or_else(|| AppError::Blocked {
                reason: "this connection was opened without mutation authority".into(),
            })
    }

    /// `SELECT 1` against the live server.
    pub async fn test(&self) -> AppResult<()> {
        self.read_pool.ping().await
    }

    /// Close both underlying pools for a lease or connection that is no longer valid.
    pub async fn close(&self) {
        if let Some(mutation_pool) = self.mutation_pool.as_ref() {
            tokio::join!(self.read_pool.close(), mutation_pool.close());
            return;
        }
        self.read_pool.close().await;
    }

    fn start_keep_alive(&self, interval: Option<Duration>) {
        let Some(interval) = interval else {
            return;
        };
        let read_pool = self.read_pool.clone();
        let mutation_pool = self.mutation_pool.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            // The pools were just opened and verified. Wait one complete
            // interval before issuing the first keep-alive query.
            ticker.tick().await;
            loop {
                ticker.tick().await;
                if read_pool.is_closed() {
                    break;
                }
                let _ = read_pool.ping().await;
                if let Some(mutation_pool) = mutation_pool.as_ref() {
                    if mutation_pool.is_closed() {
                        break;
                    }
                    let _ = mutation_pool.ping().await;
                }
            }
        });
    }
}

/// Finish opening a writable pool after its read-only companion is live.  If the
/// second connection fails, the already-open read pool must not outlive a failed
/// acquisition (notably because SQLite then keeps a file handle on Windows).
async fn writable_pool_or_close_read<T>(
    read_pool: &DbPool,
    writable_pool: Result<T, sqlx::Error>,
) -> AppResult<T> {
    match writable_pool {
        Ok(pool) => Ok(pool),
        Err(error) => {
            read_pool.close().await;
            Err(error.into())
        }
    }
}

/// SQLx adapter entrypoint. Driver selection and compatibility validation live in
/// `crate::driver`; this module only builds the concrete SQLx pools.
pub(crate) async fn connect_sqlx(
    adapter_engine: Engine,
    profile: &ConnectionProfile,
    secret: &str,
    writable: bool,
) -> AppResult<LiveConnection> {
    if adapter_engine != profile.engine {
        return Err(AppError::Config(format!(
            "SQLx {:?} adapter cannot open a {:?} profile",
            adapter_engine, profile.engine
        )));
    }
    let skip_fk_metadata = providers::skip_fk_metadata(profile);
    let transaction_pooler =
        adapter_engine == Engine::Postgres && providers::pg_transaction_pooler(profile);
    let acquire = providers::connect_timeout(profile);
    let max_connections = pool_connection_limit(profile.credential_mode);
    let runtime = providers::connection_runtime_options(profile)?;

    let (mutation_pool, read_pool) = match adapter_engine {
        Engine::Postgres => {
            let base = PgConnectOptions::new()
                .host(&profile.host)
                .port(profile.port)
                .database(&profile.database)
                .username(&profile.username)
                .password(secret)
                .ssl_mode(pg_ssl_mode(&profile.sslmode)?);
            let base = providers::apply_pg_tuning(profile, base);

            let schema_owner = profile.extra_params.get("dopedb.schemaOwner").cloned();
            if let Some(owner) = &schema_owner {
                // Pool after_connect retries hide policy errors behind PoolTimedOut.
                // Surface the first exact diagnostic before starting either pool;
                // every pooled physical connection still repeats the same check.
                let mut probe =
                    tokio::time::timeout(acquire, sqlx::PgConnection::connect_with(&base))
                        .await
                        .map_err(|_| sqlx::Error::PoolTimedOut)??;
                let verified = super::gcp_schema_policy::prepare(&mut probe, owner).await;
                let _ = probe.close().await;
                verified?;
            }
            // Built after the owner passed `prepare`'s validation above. See
            // `pg_session` for what connect and release run on each pool.
            let read_session = Arc::new(PgSessionPlan::new(
                schema_owner.clone(),
                runtime.startup_script.clone(),
                transaction_pooler,
            ));
            let connect_session = Arc::clone(&read_session);
            let ro = probe_idle_on_acquire(PgPoolOptions::new())
                .max_connections(max_connections)
                .acquire_timeout(acquire)
                .idle_timeout(runtime.auto_disconnect_timeout)
                .after_connect(move |conn, _meta| {
                    let session = Arc::clone(&connect_session);
                    Box::pin(async move { session.prepare_read(conn).await })
                })
                .after_release(move |conn, _meta| {
                    let session = Arc::clone(&read_session);
                    Box::pin(async move { Ok(session.release(conn).await) })
                })
                .connect_with(base)
                .await?;
            let ro = DbPool::Postgres(ro);
            if writable {
                let write_session = Arc::new(PgSessionPlan::new(
                    schema_owner,
                    runtime.startup_script.clone(),
                    transaction_pooler,
                ));
                let rw = writable_pool_or_close_read(
                    &ro,
                    probe_idle_on_acquire(PgPoolOptions::new())
                        .max_connections(max_connections)
                        .acquire_timeout(acquire)
                        .idle_timeout(runtime.auto_disconnect_timeout)
                        .after_connect(move |conn, _meta| {
                            let session = Arc::clone(&write_session);
                            Box::pin(async move { session.prepare_write(conn).await })
                        })
                        .connect_with(providers::apply_pg_tuning(
                            profile,
                            PgConnectOptions::new()
                                .host(&profile.host)
                                .port(profile.port)
                                .database(&profile.database)
                                .username(&profile.username)
                                .password(secret)
                                .ssl_mode(pg_ssl_mode(&profile.sslmode)?),
                        ))
                        .await,
                )
                .await?;
                (Some(DbPool::Postgres(rw)), ro)
            } else {
                (None, ro)
            }
        }
        Engine::Mysql => {
            let base = MySqlConnectOptions::new()
                .host(&profile.host)
                .port(profile.port)
                .database(&profile.database)
                .username(&profile.username)
                .password(secret)
                .ssl_mode(mysql_ssl_mode(&profile.sslmode)?);
            let base = providers::apply_mysql_tuning(profile, base);

            // See `mysql_session` for what connect and release run.
            let read_session = Arc::new(MySqlReadSession::new(runtime.startup_script.clone()));
            let connect_session = Arc::clone(&read_session);
            let ro = probe_idle_on_acquire(MySqlPoolOptions::new())
                .max_connections(max_connections)
                .acquire_timeout(acquire)
                .idle_timeout(runtime.auto_disconnect_timeout)
                .after_connect(move |conn, _meta| {
                    let session = Arc::clone(&connect_session);
                    Box::pin(async move { session.prepare(conn).await })
                })
                .after_release(move |conn, _meta| {
                    let session = Arc::clone(&read_session);
                    Box::pin(async move { Ok(session.release(conn).await) })
                })
                .connect_with(base)
                .await?;
            let ro = DbPool::Mysql(ro);
            if writable {
                let write_startup = runtime.startup_script.clone();
                let rw = writable_pool_or_close_read(
                    &ro,
                    probe_idle_on_acquire(MySqlPoolOptions::new())
                        .max_connections(max_connections)
                        .acquire_timeout(acquire)
                        .idle_timeout(runtime.auto_disconnect_timeout)
                        .after_connect(move |conn, _meta| {
                            let startup = write_startup.clone();
                            Box::pin(async move {
                                if let Some(script) = startup {
                                    sqlx::raw_sql(AssertSqlSafe(script))
                                        .execute(&mut *conn)
                                        .await?;
                                }
                                Ok(())
                            })
                        })
                        .connect_with(providers::apply_mysql_tuning(
                            profile,
                            MySqlConnectOptions::new()
                                .host(&profile.host)
                                .port(profile.port)
                                .database(&profile.database)
                                .username(&profile.username)
                                .password(secret)
                                .ssl_mode(mysql_ssl_mode(&profile.sslmode)?),
                        ))
                        .await,
                )
                .await?;
                (Some(DbPool::Mysql(rw)), ro)
            } else {
                (None, ro)
            }
        }
        Engine::Sqlite => {
            // For SQLite the file path lives in `database`; host/port/user unused.
            let path = &profile.database;
            // Unforgeable file-level read-only handle.
            let ro_opts = SqliteConnectOptions::new().filename(path).read_only(true);
            let ro = SqlitePoolOptions::new()
                .max_connections(max_connections)
                .idle_timeout(runtime.auto_disconnect_timeout)
                .connect_with(ro_opts)
                .await?;
            let ro = DbPool::Sqlite(ro);
            if writable {
                let rw_opts = SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(false);
                let rw = writable_pool_or_close_read(
                    &ro,
                    SqlitePoolOptions::new()
                        .max_connections(max_connections)
                        .idle_timeout(runtime.auto_disconnect_timeout)
                        .connect_with(rw_opts)
                        .await,
                )
                .await?;
                (Some(DbPool::Sqlite(rw)), ro)
            } else {
                (None, ro)
            }
        }
        Engine::Mongodb => {
            return Err(AppError::Config(
                "MongoDB must be opened through its document database adapter".into(),
            ))
        }
        Engine::Bigquery => {
            return Err(AppError::Config(
                "BigQuery must be opened through the official bq CLI adapter".into(),
            ))
        }
    };

    let live = LiveConnection {
        read_pool,
        mutation_pool,
        skip_fk_metadata,
        transaction_pooler,
    };
    live.start_keep_alive(runtime.keep_alive_interval);
    Ok(live)
}

// Fail CLOSED on unknown sslmode: a typo like "verrify-full" must NOT silently
// downgrade to a non-verifying mode. Trim + lowercase; empty means "unspecified"
// and keeps the platform default; anything else unknown is a config error.
fn pg_ssl_mode(mode: &str) -> AppResult<PgSslMode> {
    Ok(match mode.trim().to_ascii_lowercase().as_str() {
        "" => PgSslMode::Prefer, // ponytail: empty = unspecified, not a typo
        "disable" => PgSslMode::Disable,
        "allow" => PgSslMode::Allow,
        "prefer" => PgSslMode::Prefer,
        "require" => PgSslMode::Require,
        "verify-ca" | "verify_ca" => PgSslMode::VerifyCa,
        "verify-full" | "verify_full" => PgSslMode::VerifyFull,
        other => {
            return Err(AppError::Config(format!(
                "unknown Postgres sslmode {other:?} — use disable/allow/prefer/require/verify-ca/verify-full"
            )))
        }
    })
}

fn mysql_ssl_mode(mode: &str) -> AppResult<MySqlSslMode> {
    Ok(match mode.trim().to_ascii_lowercase().as_str() {
        "" => MySqlSslMode::Preferred, // ponytail: empty = unspecified, not a typo
        "disable" | "disabled" => MySqlSslMode::Disabled,
        "prefer" | "preferred" => MySqlSslMode::Preferred,
        "require" | "required" => MySqlSslMode::Required,
        "verify-ca" | "verify_ca" => MySqlSslMode::VerifyCa,
        "verify-identity" | "verify_identity" | "verify-full" => MySqlSslMode::VerifyIdentity,
        other => {
            return Err(AppError::Config(format!(
                "unknown MySQL sslmode {other:?} — use disabled/preferred/required/verify-ca/verify-identity"
            )))
        }
    })
}
