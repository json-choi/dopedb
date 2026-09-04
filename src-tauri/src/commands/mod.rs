//! Remaining cross-feature `#[tauri::command]` adapters.
//! Feature vertical slices own their transport beside the feature; commands stay
//! here only when they still span shared service boundaries. Every command returns an
//! [`AppResult`] that serializes to `{ kind, message }` for the frontend.
//!
//! Safety invariants live in the service/operation path: writes, DDL, and privilege
//! changes are blocked unless policy authorizes the exact request. The executor
//! re-checks its gates as defense in depth, while the database's read-only session
//! remains the authoritative stop.

use tauri::State;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::activity::AuditVerdict;
use crate::features::documents::{
    DesktopDocumentProposalReceipt, DesktopDocumentProposalRequest, DesktopDocumentReadError,
    DocumentReadReceipt,
};
use crate::features::monitoring::{
    MonitoringError, MonitoringProposalReceipt, MonitoringProposalRequest, MonitoringStatusReceipt,
};
use crate::features::operation_control::{OperationDecisionReceipt, OperationDecisionRequest};
use crate::features::scripts::{
    DesktopScriptProposalReceipt, DesktopScriptProposalRequest, DesktopScriptRunError,
    DesktopScriptRunReceipt, TableScriptContext,
};
use crate::model::{DocumentQuery, HistoryEntry, SafetySettings};
use crate::state::AppState;

#[tauri::command]
pub async fn cli_installation_status(
    _state: State<'_, AppState>,
) -> AppResult<crate::cli_install::CliInstallationStatus> {
    tokio::task::spawn_blocking(crate::cli_install::installation_status)
        .await
        .map_err(|_| AppError::Config("the CLI status worker stopped unexpectedly".into()))?
}

#[tauri::command]
pub async fn install_cli(
    _state: State<'_, AppState>,
    update_path: bool,
    replace_existing: bool,
) -> AppResult<crate::cli_install::CliInstallReceipt> {
    tokio::task::spawn_blocking(move || crate::cli_install::install(update_path, replace_existing))
        .await
        .map_err(|_| AppError::Config("the CLI installer worker stopped unexpectedly".into()))?
}

#[tauri::command]
pub async fn skill_status(
    state: State<'_, AppState>,
    target: dopedb_protocol::SkillTargetSelection,
) -> AppResult<dopedb_protocol::SkillStatusResult> {
    let skills = state.skills.clone();
    tokio::task::spawn_blocking(move || skills.status(target))
        .await
        .map_err(|_| AppError::Config("the Skill inventory worker stopped unexpectedly".into()))?
}

#[tauri::command]
pub async fn install_skill(
    state: State<'_, AppState>,
    target: dopedb_protocol::SkillTargetSelection,
    expected: Vec<dopedb_protocol::SkillTargetExpectation>,
) -> AppResult<dopedb_protocol::SkillMutationResult> {
    let skills = state.skills.clone();
    tokio::task::spawn_blocking(move || {
        skills.install(dopedb_protocol::SkillMutationArguments { target, expected })
    })
    .await
    .map_err(|_| AppError::Config("the Skill installer worker stopped unexpectedly".into()))?
}

#[tauri::command]
pub async fn repair_skill(
    state: State<'_, AppState>,
    target: dopedb_protocol::SkillTargetSelection,
    expected: Vec<dopedb_protocol::SkillTargetExpectation>,
) -> AppResult<dopedb_protocol::SkillMutationResult> {
    let skills = state.skills.clone();
    tokio::task::spawn_blocking(move || {
        skills.repair(dopedb_protocol::SkillMutationArguments { target, expected })
    })
    .await
    .map_err(|_| AppError::Config("the Skill repair worker stopped unexpectedly".into()))?
}

#[tauri::command]
pub async fn remove_skill(
    state: State<'_, AppState>,
    target: dopedb_protocol::SkillTargetSelection,
    expected: Vec<dopedb_protocol::SkillTargetExpectation>,
) -> AppResult<dopedb_protocol::SkillMutationResult> {
    let skills = state.skills.clone();
    tokio::task::spawn_blocking(move || {
        skills.remove(dopedb_protocol::SkillMutationArguments { target, expected })
    })
    .await
    .map_err(|_| AppError::Config("the Skill removal worker stopped unexpectedly".into()))?
}

#[tauri::command]
pub async fn skill_self_test(
    state: State<'_, AppState>,
) -> AppResult<crate::skills::SkillSelfTestReceipt> {
    let skills = state.skills.clone();
    tokio::task::spawn_blocking(move || {
        let binary = crate::cli_install::bundled_cli_binary()?;
        skills.self_test_cli(&binary)
    })
    .await
    .map_err(|_| AppError::Config("the Skill self-test worker stopped unexpectedly".into()))?
}

#[tauri::command]
pub async fn approve_operation(
    state: State<'_, AppState>,
    operation_id: Uuid,
    payload_hash: String,
    reason: Option<String>,
) -> AppResult<OperationDecisionReceipt> {
    state
        .services
        .operation
        .approve_local(
            &state.local_operation_approval,
            OperationDecisionRequest {
                operation_id,
                expected_payload_hash: payload_hash,
                reason,
            },
        )
        .await
}

#[tauri::command]
pub async fn reject_operation(
    state: State<'_, AppState>,
    operation_id: Uuid,
    payload_hash: String,
    reason: Option<String>,
) -> AppResult<OperationDecisionReceipt> {
    state
        .services
        .operation
        .reject_local(
            &state.local_operation_approval,
            OperationDecisionRequest {
                operation_id,
                expected_payload_hash: payload_hash,
                reason,
            },
        )
        .await
}

// ── typed document queries (MongoDB) ─────────────────────────────────────────

#[tauri::command]
pub async fn propose_document_query(
    state: State<'_, AppState>,
    id: Uuid,
    query: DocumentQuery,
    origin: Option<String>,
) -> AppResult<DesktopDocumentProposalReceipt> {
    state
        .services
        .document
        .propose_desktop_read(DesktopDocumentProposalRequest {
            connection_id: id,
            query,
            origin,
        })
        .await
        .map_err(DesktopDocumentReadError::into_error)
}

/// Typed document execution accepts only a durable single-use operation id. The
/// stored query is reclassified against the MongoDB stage allowlist before use.
#[tauri::command]
pub async fn run_document_query(
    state: State<'_, AppState>,
    operation_id: Uuid,
) -> AppResult<DocumentReadReceipt> {
    state
        .services
        .document
        .run_desktop_read(operation_id)
        .await
        .map_err(DesktopDocumentReadError::into_error)
}

// ── multi-statement script execution ─────────────────────────────────────────

#[tauri::command]
pub async fn propose_script(
    state: State<'_, AppState>,
    id: Uuid,
    sql: String,
    database: Option<String>,
    namespace: Option<String>,
    origin: Option<String>,
) -> AppResult<DesktopScriptProposalReceipt> {
    state
        .services
        .script
        .propose_desktop(DesktopScriptProposalRequest {
            connection_id: id,
            sql,
            database,
            namespace,
            origin,
            schema_change: None,
            table_change: None,
        })
        .await
        .map_err(DesktopScriptRunError::into_error)
}

#[tauri::command]
pub async fn propose_table_changes(
    state: State<'_, AppState>,
    id: Uuid,
    database: Option<String>,
    statements: Vec<String>,
    catalog_fingerprint: String,
) -> AppResult<DesktopScriptProposalReceipt> {
    if statements.is_empty() {
        return Err(AppError::Config(
            "at least one staged table change is required".into(),
        ));
    }
    let statement_count = statements.len();
    state
        .services
        .script
        .propose_desktop(DesktopScriptProposalRequest {
            connection_id: id,
            sql: statements.join(";\n"),
            database,
            namespace: None,
            origin: Some("table_editor".into()),
            schema_change: None,
            table_change: Some(TableScriptContext {
                catalog_fingerprint,
                expected_affected: vec![1; statement_count],
            }),
        })
        .await
        .map_err(DesktopScriptRunError::into_error)
}

/// Execute a previously persisted script by operation id only.
#[tauri::command]
pub async fn run_script(
    state: State<'_, AppState>,
    operation_id: Uuid,
) -> AppResult<DesktopScriptRunReceipt> {
    state
        .services
        .script
        .run_desktop(operation_id)
        .await
        .map_err(DesktopScriptRunError::into_error)
}

// ── safety settings ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_safety(state: State<'_, AppState>, id: Uuid) -> AppResult<SafetySettings> {
    state.services.safety.get(id).await
}

#[tauri::command]
pub async fn set_safety(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: Uuid,
    settings: SafetySettings,
) -> AppResult<()> {
    if state.services.safety.update(id, settings).await? {
        state.terminals.stop_connection(id.into(), &app);
        state.agents_acp.stop_connection(id.into());
    }
    Ok(())
}

// ── lightweight monitoring access ───────────────────────────────────────────

#[tauri::command]
pub async fn get_monitoring_status(
    state: State<'_, AppState>,
    id: Uuid,
) -> AppResult<MonitoringStatusReceipt> {
    state
        .services
        .monitoring
        .status(id)
        .await
        .map_err(MonitoringError::into_error)
}

/// Persist one immutable fixed-role proposal. The desktop must render its literal
/// SQL and hash before using the separate exact approval command.
#[tauri::command]
pub async fn propose_postgres_monitoring(
    state: State<'_, AppState>,
    id: Uuid,
    enabled: bool,
) -> AppResult<MonitoringProposalReceipt> {
    state
        .services
        .monitoring
        .propose_postgres_role(MonitoringProposalRequest {
            connection_id: id,
            enabled,
        })
        .await
        .map_err(MonitoringError::into_error)
}

/// Consume one exactly approved fixed-role proposal by operation id only.
#[tauri::command]
pub async fn set_postgres_monitoring(
    state: State<'_, AppState>,
    operation_id: Uuid,
) -> AppResult<MonitoringStatusReceipt> {
    state
        .services
        .monitoring
        .run_postgres_role(operation_id)
        .await
        .map_err(MonitoringError::into_error)
}

// ── logs ─────────────────────────────────────────────────────────────────────

/// Verify the hash-chain without materializing every audit body in memory.
#[tauri::command]
pub async fn audit_verify(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> AppResult<AuditVerdict> {
    state.services.activity.verify_audit(connection_id).await
}

#[tauri::command]
pub async fn list_audit_page(
    state: State<'_, AppState>,
    request: crate::features::activity::AuditPageRequest,
) -> AppResult<crate::model::AuditPage> {
    state.services.activity.audit_page(request).await
}

#[tauri::command]
pub async fn get_audit_entry(
    state: State<'_, AppState>,
    connection_id: Uuid,
    entry_id: Uuid,
) -> AppResult<crate::model::AuditEntry> {
    state
        .services
        .activity
        .audit_entry(connection_id, entry_id)
        .await
}

#[tauri::command]
pub async fn list_history_page(
    state: State<'_, AppState>,
    request: crate::features::activity::HistoryPageRequest,
) -> AppResult<crate::model::HistoryPage> {
    state.services.activity.history_page(request).await
}

#[tauri::command]
pub async fn get_history_entry(
    state: State<'_, AppState>,
    connection_id: Uuid,
    history_id: Uuid,
) -> AppResult<HistoryEntry> {
    state
        .services
        .activity
        .history_entry(connection_id, history_id)
        .await
}

// ── native picker ─────────────────────────────────────────────────────────────

/// Native file picker for a SQLite database path. None means the user cancelled.
#[tauri::command]
pub async fn pick_file(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}
