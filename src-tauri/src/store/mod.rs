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
mod migrations;
mod projections;
mod query_services;
mod repositories;
mod retired_chat_archive;
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
    engine_str, kind_str, parse_engine, parse_kind, parse_provider, parse_uuid, parse_uuid_opt,
    provider_str,
};

use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use dopedb_protocol::catalog::{CatalogSnapshot, DatabaseEngine, CATALOG_SCHEMA_VERSION};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{AssertSqlSafe, Executor, Row, Sqlite, SqlitePool, Transaction};
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
    /// Open (creating if needed) the app.db and run migrations.
    pub async fn open() -> AppResult<Store> {
        let dir = crate::app_paths::data_root()?;
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("app.db");

        let opts = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new().connect_with(opts).await?;
        migrate_local_store(&pool).await?;
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
    /// Cross-feature security tests use this instead of duplicating migration SQL.
    #[cfg(test)]
    pub(crate) async fn in_memory_for_test() -> AppResult<Store> {
        let opts = SqliteConnectOptions::from_str("sqlite::memory:")?
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await?;
        sqlx::raw_sql(migrations::SCHEMA).execute(&pool).await?;
        sqlx::raw_sql(migrations::KNOWLEDGE_SCHEMA)
            .execute(&pool)
            .await?;
        Ok(Self::from_pool_for_test(pool))
    }
}
