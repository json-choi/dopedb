//! Store repository integration tests against the current schema.

pub(super) use super::super::{schema, CacheWriteOutcome, Store};
pub(super) use crate::error::AppError;
pub(super) use crate::features::workspaces::{WorkspaceAuthUser, WorkspaceRole};
pub(super) use crate::kernel::access::CatalogCachePolicy;
pub(super) use crate::kernel::identity::AccountId;
pub(super) use crate::model::{ConnectionProfile, Engine, HistoryEntry, Provider, QueryKind};
pub(super) use chrono::{TimeZone, Utc};
pub(super) use dopedb_protocol::catalog::{CatalogContents, CatalogSnapshot, DatabaseEngine};
pub(super) use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
pub(super) use sqlx::SqlitePool;
pub(super) use std::collections::HashMap;
pub(super) use std::str::FromStr;
pub(super) use uuid::Uuid;

pub(super) async fn memory_pool() -> SqlitePool {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .unwrap()
}

pub(super) fn sqlite_profile(id: Uuid, name: &str) -> ConnectionProfile {
    ConnectionProfile {
        id,
        name: name.into(),
        engine: Engine::Sqlite,
        provider: Provider::Generic,
        driver_id: Some("sqlx-sqlite".into()),
        host: String::new(),
        port: 0,
        database: ":memory:".into(),
        username: String::new(),
        sslmode: "disable".into(),
        extra_params: HashMap::new(),
        readonly_default: true,
        allow_writes: false,
        secret_ref: None,
        env: None,
        schema_group: None,
        workspace_access: crate::model::WorkspaceConnectionAccess::Local,
        credential_mode: crate::model::WorkspaceCredentialMode::Local,
        provider_target: None,
    }
}

pub(super) fn workspace_user(id: &str, name: &str) -> WorkspaceAuthUser {
    WorkspaceAuthUser {
        id: AccountId::new(id).unwrap(),
        email: format!("{}@example.com", name.to_lowercase()),
        display_name: name.into(),
    }
}

pub(super) fn catalog_snapshot(
    connection_id: Uuid,
    database: &str,
    marker: char,
) -> CatalogSnapshot {
    CatalogSnapshot::capture(
        connection_id,
        DatabaseEngine::Sqlite,
        database,
        Utc.with_ymd_and_hms(2026, 7, 24, 0, 0, 0).single().unwrap(),
        CatalogContents {
            namespaces: vec![dopedb_protocol::catalog::Namespace {
                name: marker.to_string(),
                comment: None,
            }],
            ..CatalogContents::default()
        },
    )
    .unwrap()
}
