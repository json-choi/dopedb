//! Tauri transport adapter for connection use cases.

use tauri::State;
use zeroize::Zeroizing;

use crate::error::AppResult;
use crate::features::catalog::DatabaseSummary;
use crate::kernel::identity::ConnectionId;
use crate::model::ConnectionProfile;
use crate::state::AppState;

use super::{ConnectionProfileTestRequest, ConnectionUpsertRequest, DriverDescriptor};

#[tauri::command]
pub fn list_drivers(state: State<'_, AppState>) -> Vec<DriverDescriptor> {
    state.services.connections.list_drivers()
}

#[tauri::command]
pub async fn install_driver(state: State<'_, AppState>, id: String) -> AppResult<DriverDescriptor> {
    if id == "google-bq-cli" && !crate::bigquery::is_cli_available() {
        crate::bigquery::install_managed_cli().await?;
    }
    state.services.connections.install_driver(&id)
}

#[tauri::command]
pub async fn create_demo_sqlite(app: tauri::AppHandle) -> AppResult<String> {
    super::demo::create(&app).await
}

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> AppResult<Vec<ConnectionProfile>> {
    state.services.connections.list_profiles().await
}

#[tauri::command]
pub async fn upsert_connection(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    profile: ConnectionProfile,
    password: Option<String>,
) -> AppResult<ConnectionProfile> {
    let saved = state
        .services
        .connections
        .upsert(ConnectionUpsertRequest {
            profile,
            password: password.map(Zeroizing::new),
        })
        .await?;
    if saved.engine == crate::model::Engine::Bigquery
        && !crate::bigquery::uses_service_account_auth(&saved)?
    {
        let auth_scope = state.connections.bigquery_auth_scope(&saved).await?;
        if let Err(error) = crate::bigquery::cleanup_service_account_auth(&auth_scope).await {
            tracing::warn!(
                connection_id = %saved.id,
                %error,
                "could not remove an unused BigQuery service-account CLI profile"
            );
        }
    }
    state
        .terminals
        .stop_connection(ConnectionId::from(saved.id), &app);
    state
        .agents_acp
        .stop_connection(ConnectionId::from(saved.id));
    Ok(saved)
}

#[tauri::command]
pub async fn set_connections_schema_group(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    ids: Vec<ConnectionId>,
    schema_group: Option<String>,
) -> AppResult<Vec<ConnectionProfile>> {
    let profiles = state
        .services
        .connections
        .set_schema_group(ids.clone(), schema_group)
        .await?;
    for id in ids {
        state.terminals.stop_connection(id, &app);
        state.agents_acp.stop_connection(id);
    }
    Ok(profiles)
}

#[tauri::command]
pub async fn delete_connection(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: ConnectionId,
) -> AppResult<()> {
    let bigquery_auth_scope = state
        .connections
        .existing_bigquery_auth_scope(id.into())
        .await?;
    let deleted = state.services.connections.delete(id).await?;
    state.terminals.stop_connection(id, &app);
    state.agents_acp.stop_connection(id);
    if let Some(auth_scope) = bigquery_auth_scope {
        if let Err(error) = crate::bigquery::cleanup_connection_auth(&auth_scope).await {
            tracing::warn!(
                connection_id = %id,
                %error,
                "could not remove the deleted BigQuery connection CLI profile"
            );
        }
    }
    match state.services.connections.list_profiles().await {
        Ok(remaining) => {
            if let Err(error) =
                super::demo::remove_if_unreferenced(&app, &deleted, &remaining).await
            {
                tracing::warn!(
                    connection_id = %id,
                    %error,
                    "could not remove the unreferenced Demo SQLite file"
                );
            }
        }
        Err(error) => {
            tracing::warn!(
                connection_id = %id,
                %error,
                "skipped Demo SQLite cleanup because remaining connections were unavailable"
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    id: ConnectionId,
) -> AppResult<super::ConnectionTestReceipt> {
    Ok(super::ConnectionTestReceipt::from_result(
        state.services.connections.test(id).await,
    ))
}

#[tauri::command]
pub async fn test_connection_profile(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
    password: Option<String>,
) -> AppResult<super::ConnectionTestReceipt> {
    Ok(super::ConnectionTestReceipt::from_result(
        state
            .services
            .connections
            .test_profile(ConnectionProfileTestRequest {
                profile,
                password: password.map(Zeroizing::new),
            })
            .await,
    ))
}

#[tauri::command]
pub async fn discover_connection_profile_databases(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
    password: Option<String>,
) -> AppResult<Vec<DatabaseSummary>> {
    state
        .services
        .connections
        .discover_profile_databases(profile, password.map(Zeroizing::new))
        .await
}

#[tauri::command]
pub async fn get_bigquery_auth_state(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
) -> AppResult<crate::bigquery::BigQueryAuthState> {
    let auth_scope = state.connections.bigquery_auth_scope(&profile).await?;
    crate::bigquery::auth_state(profile, &auth_scope).await
}

#[tauri::command]
pub async fn authenticate_bigquery_google_account(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
) -> AppResult<crate::bigquery::BigQueryAuthState> {
    let auth_scope = state.connections.bigquery_auth_scope(&profile).await?;
    crate::bigquery::authenticate_google_account(profile, &auth_scope).await
}

#[tauri::command]
pub async fn authenticate_bigquery_service_account(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
    credential_file: String,
) -> AppResult<crate::bigquery::BigQueryAuthState> {
    let auth_scope = state.connections.bigquery_auth_scope(&profile).await?;
    crate::bigquery::authenticate_service_account(profile, credential_file, &auth_scope).await
}

#[tauri::command]
pub async fn clear_bigquery_service_account_auth(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
) -> AppResult<()> {
    let auth_scope = state.connections.bigquery_auth_scope(&profile).await?;
    crate::bigquery::cleanup_service_account_auth(&auth_scope).await
}

#[tauri::command]
pub async fn discover_bigquery_projects(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
) -> AppResult<Vec<crate::bigquery::BigQueryProjectSummary>> {
    let auth_scope = state.connections.bigquery_auth_scope(&profile).await?;
    crate::bigquery::discover_projects(profile, &auth_scope).await
}

#[tauri::command]
pub async fn discover_bigquery_datasets(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
    project_id: String,
) -> AppResult<Vec<crate::bigquery::BigQueryDatasetSummary>> {
    let auth_scope = state.connections.bigquery_auth_scope(&profile).await?;
    crate::bigquery::discover_datasets(profile, project_id, &auth_scope).await
}
