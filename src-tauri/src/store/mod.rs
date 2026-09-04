//! The local application store: a WAL SQLite DB at
//! the application-owned data root's `app.db` holding connections, safety settings,
//! query history, the audit log, snippets, and the schema cache.
//!
//! Secrets are NEVER stored here — connections carry only a `secret_ref` that
//! points at an OS credential-store item. Row⇄model mapping is manual (`sqlx::query`,
//! runtime, not the compile-time `query!` macro) because this is a
//! runtime-arbitrary-SQL client.

mod agent_acp;
mod bootstrap;
mod projections;
mod query_services;
mod repositories;
mod schema;
mod workspace_codec;

#[cfg(test)]
mod tests;

pub(crate) use workspace_codec::{
    credential_mode_str, parse_credential_mode, parse_workspace_access, workspace_access_str,
};
use workspace_codec::{
    parse_workspace_kind, parse_workspace_role, row_to_workspace, workspace_kind_str,
    workspace_role_str,
};

use bootstrap::*;
use projections::*;
use repositories::*;

pub(crate) use projections::{
    engine_str, kind_str, parse_engine, parse_kind, parse_provider, parse_uuid, provider_str,
};

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use dopedb_protocol::catalog::{CatalogSnapshot, DatabaseEngine, CATALOG_SCHEMA_VERSION};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Executor, Row, Sqlite, SqlitePool, Transaction};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::workspaces::{
    Workspace, WorkspaceAccountMembership, WorkspaceAuthAccount, WorkspaceAuthUser, WorkspaceRole,
};
use crate::kernel::identity::{AccountId, WorkspaceId};
use crate::model::{
    ConnectionProfile, Engine, HistoryCursor, HistoryEntry, HistoryEntrySummary, HistoryPage,
    Provider, QueryKind, SafetySettings, WorkspaceConnectionAccess, WorkspaceCredentialMode,
};

/// Handle to the local app.db. Cheap to clone (the pool is an `Arc` internally).
#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
    /// Serializes audit-chain appends. The chain is read-tail-then-insert, which two
    /// concurrent `audit::record` calls on the pooled (multi-connection) SQLite store
    /// would otherwise interleave — both reading the same tail hash and forking the
    /// chain, making `verify_chain` report false tampering.
    // ponytail: one global async lock; audit writes are rare, contention is a non-issue.
    audit_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CacheWriteOutcome {
    Stored,
    Stale,
    NotPersisted,
}

impl Store {
    /// Open (creating if needed) the current app.db schema.
    pub async fn open() -> AppResult<Store> {
        let dir = crate::app_paths::data_root()?;
        std::fs::create_dir_all(&dir)?;
        Self::open_at(&dir.join("app.db")).await
    }

    async fn open_at(path: &Path) -> AppResult<Store> {
        let pool = open_local_store_pool(path).await?;
        let pool = match bootstrap_local_store(&pool).await? {
            LocalStoreBootstrap::Ready { .. } => pool,
            LocalStoreBootstrap::ResetRequired {
                version,
                application_id,
            } => {
                tracing::warn!(
                    version,
                    application_id,
                    "resetting unsupported pre-MVP local database"
                );
                pool.close().await;
                remove_local_store_files(path).await?;

                let fresh_pool = open_local_store_pool(path).await?;
                match bootstrap_local_store(&fresh_pool).await? {
                    LocalStoreBootstrap::Ready { .. } => fresh_pool,
                    LocalStoreBootstrap::ResetRequired { .. } => {
                        fresh_pool.close().await;
                        return Err(AppError::Config(
                            "local database reset did not create the MVP baseline".into(),
                        ));
                    }
                }
            }
        };

        repair_active_scope_on_open(&pool).await?;
        Ok(Store {
            pool,
            audit_lock: Arc::new(Mutex::new(())),
        })
    }

    /// Escape hatch for sibling modules (audit) that own their own SQL.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Lock guarding audit-chain appends (see the field doc). `audit::record` holds
    /// this across its read-tail + insert so the chain can't fork under concurrency.
    pub(crate) fn audit_lock(&self) -> &Mutex<()> {
        &self.audit_lock
    }

    /// Wrap an already-open pool as a `Store` (tests only — bypasses `open`'s data-dir).
    #[cfg(test)]
    pub(crate) fn from_pool_for_test(pool: SqlitePool) -> Store {
        Store {
            pool,
            audit_lock: Arc::new(Mutex::new(())),
        }
    }

    /// Open the production schema in an isolated, single-connection SQLite store.
    /// Cross-feature security tests use this instead of duplicating schema SQL.
    #[cfg(test)]
    pub(crate) async fn in_memory_for_test() -> AppResult<Store> {
        let opts = SqliteConnectOptions::from_str("sqlite::memory:")?
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await?;
        sqlx::raw_sql(schema::SCHEMA).execute(&pool).await?;
        sqlx::raw_sql(schema::KNOWLEDGE_SCHEMA)
            .execute(&pool)
            .await?;
        Ok(Self::from_pool_for_test(pool))
    }
}

async fn open_local_store_pool(path: &Path) -> AppResult<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);
    Ok(SqlitePoolOptions::new().connect_with(options).await?)
}

async fn remove_local_store_files(path: &Path) -> AppResult<()> {
    for candidate in local_store_files(path) {
        match tokio::fs::remove_file(candidate).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn local_store_files(path: &Path) -> [PathBuf; 4] {
    [
        sqlite_sidecar_path(path, "-wal"),
        sqlite_sidecar_path(path, "-shm"),
        sqlite_sidecar_path(path, "-journal"),
        path.to_path_buf(),
    ]
}

fn sqlite_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = path.as_os_str().to_os_string();
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}
