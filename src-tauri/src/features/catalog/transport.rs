//! Tauri transport for catalog use cases.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, State};
use tokio::sync::broadcast::error::RecvError;

use crate::error::AppResult;
use crate::kernel::identity::ConnectionId;
use crate::state::AppState;

use super::{CatalogChanged, CatalogOverview, CatalogSnapshot, DatabaseSummary};

static CATALOG_CHANGES_FORWARDED: AtomicBool = AtomicBool::new(false);

/// Forwards retired catalogs (committed DDL, connection edits) to the renderer as
/// `catalog:changed`, so every open catalog view reloads once. A lagged receiver asks
/// the renderer to resynchronize all catalogs instead of silently dropping changes.
///
/// Every renderer catalog view starts with one of the catalog reads below, so the
/// first such read starts the single process-wide forwarder; before any view exists
/// there is nothing to reload.
fn forward_catalog_changes(app: &AppHandle, state: &AppState) {
    if CATALOG_CHANGES_FORWARDED.swap(true, Ordering::AcqRel) {
        return;
    }
    let mut changes = state.services.catalog.subscribe_changes();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let event = match changes.recv().await {
                Ok(event) => event,
                Err(RecvError::Lagged(_)) => CatalogChanged::RESYNC,
                Err(RecvError::Closed) => break,
            };
            if let Err(error) = handle.emit("catalog:changed", event) {
                tracing::warn!(%error, "failed to emit catalog change");
            }
        }
    });
}

/// The persisted snapshot of the configured database, when still current for the
/// active scope, for stale-while-revalidate display. It never connects or introspects;
/// the renderer replaces it with the concurrent live read.
#[tauri::command]
pub async fn get_catalog_snapshot(
    state: State<'_, AppState>,
    id: ConnectionId,
) -> AppResult<Option<CatalogSnapshot>> {
    state.services.catalog.load_persisted_snapshot(id).await
}

/// Load the bounded relation tree without reading or overwriting the full catalog cache.
#[tauri::command]
pub async fn get_catalog_overview(
    app: AppHandle,
    state: State<'_, AppState>,
    id: ConnectionId,
) -> AppResult<CatalogOverview> {
    forward_catalog_changes(&app, &state);
    state.services.catalog.load_overview(id).await
}

#[tauri::command]
pub async fn list_connection_databases(
    app: AppHandle,
    state: State<'_, AppState>,
    id: ConnectionId,
) -> AppResult<Vec<DatabaseSummary>> {
    forward_catalog_changes(&app, &state);
    state.services.catalog.list_databases(id).await
}

#[tauri::command]
pub async fn get_database_catalog_overview(
    app: AppHandle,
    state: State<'_, AppState>,
    id: ConnectionId,
    database: String,
) -> AppResult<CatalogOverview> {
    forward_catalog_changes(&app, &state);
    state
        .services
        .catalog
        .load_database_overview(id, database)
        .await
}

/// Desktop's single catalog read. It always introspects live; an omitted database
/// selects the configured one, whose result also replaces the persisted snapshot.
#[tauri::command]
pub async fn get_database_catalog_snapshot(
    app: AppHandle,
    state: State<'_, AppState>,
    id: ConnectionId,
    database: Option<String>,
) -> AppResult<CatalogSnapshot> {
    forward_catalog_changes(&app, &state);
    state
        .services
        .catalog
        .load_live_snapshot(id, database)
        .await
}

#[tauri::command]
pub async fn get_table_ddl(
    state: State<'_, AppState>,
    id: ConnectionId,
    schema: Option<String>,
    table: String,
) -> AppResult<String> {
    state
        .services
        .catalog
        .table_ddl(id, schema.as_deref(), &table)
        .await
}

#[tauri::command]
pub async fn get_database_table_ddl(
    state: State<'_, AppState>,
    id: ConnectionId,
    database: String,
    schema: Option<String>,
    table: String,
) -> AppResult<String> {
    state
        .services
        .catalog
        .database_table_ddl(id, database, schema.as_deref(), &table)
        .await
}
