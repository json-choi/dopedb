//! Tauri transport for ACP sessions, CLI probes, and read-only retired archives.

use dopedb_protocol::AcpPluginId;
use tauri::State;

use crate::error::AppResult;
use crate::kernel::identity::{AcpSessionId, ConnectionId, RetiredChatThreadId};
use crate::state::AppState;
use uuid::Uuid;

use super::acp::{AcpResourceRequest, DesktopAcpRuntimePorts};
use super::domain::{
    AcpPromptContext, AcpSessionFocus, AcpSessionSummary, AgentCliInfo, AgentProvider,
    AgentResourceScopeSelection, RetiredChatArchiveMessage, RetiredChatArchiveThread,
};
use super::runtime::{AcpPluginMutationReceipt, AcpPluginStatus};
use crate::features::knowledge::domain::KnowledgeEnvironmentSummary;

/// Inspect the two closed-catalog ACP adapter plugin installations.
#[tauri::command]
pub fn list_agent_acp_plugins(state: State<'_, AppState>) -> AppResult<Vec<AcpPluginStatus>> {
    state.agent_plugins.statuses()
}

/// Check signed catalog metadata without downloading or activating an adapter.
#[tauri::command]
pub async fn check_agent_acp_plugin_updates(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<Vec<AcpPluginStatus>> {
    state.agent_plugins.check_updates(&app, true).await
}

/// Download, verify, stage, and enable one signed first-party adapter plugin.
#[tauri::command]
pub async fn install_agent_acp_plugin(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    plugin_id: AcpPluginId,
) -> AppResult<AcpPluginMutationReceipt> {
    state.agent_plugins.install(&app, plugin_id).await
}

/// Close that provider's sessions and remove only its managed plugin files.
#[tauri::command]
pub async fn remove_agent_acp_plugin(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    plugin_id: AcpPluginId,
) -> AppResult<AcpPluginMutationReceipt> {
    let provider = match plugin_id {
        AcpPluginId::Claude => AgentProvider::Claude,
        AcpPluginId::Codex => AgentProvider::Codex,
    };
    state
        .agents_acp
        .stop_provider_and_wait(provider, std::time::Duration::from_secs(10))
        .await?;
    state.agent_plugins.remove(&app, plugin_id).await
}

/// Enable or disable an installed provider without changing its local CLI or login.
#[tauri::command]
pub fn set_agent_acp_plugin_enabled(
    state: State<'_, AppState>,
    plugin_id: AcpPluginId,
    enabled: bool,
) -> AppResult<AcpPluginStatus> {
    state.agent_plugins.set_enabled(plugin_id, enabled)
}

/// Start one connection-pinned session through an official ACP registry adapter.
// The flat arguments are the stable Tauri invoke wire contract used by shipped clients.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_agent_acp_session(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    connection_id: ConnectionId,
    provider: AgentProvider,
    project_environment_id: Option<Uuid>,
    environment_connection_ids: Option<Vec<Uuid>>,
    resource_scopes: Option<Vec<AgentResourceScopeSelection>>,
    write_connection_id: Option<Uuid>,
) -> AppResult<AcpSessionFocus> {
    state.wait_for_post_paint_recovery().await?;
    let has_project_resource_scope = project_environment_id.is_some()
        || resource_scopes
            .as_ref()
            .is_some_and(|scopes| !scopes.is_empty());
    if has_project_resource_scope {
        let connection = state
            .services
            .knowledge
            .pin_connection_for_read(Uuid::from(connection_id))
            .await?;
        if agent_session_requires_hosted_knowledge_reconciliation(
            has_project_resource_scope,
            connection.scope.selected_account_id.as_deref(),
        ) {
            state.services.knowledge.reconcile_current_access().await?;
        }
    }
    let ports = DesktopAcpRuntimePorts::new(app, state.agent_plugins.clone());
    state
        .agents_acp
        .start(
            connection_id,
            provider,
            AcpResourceRequest {
                project_environment_id,
                environment_connection_ids,
                resource_scopes,
                write_connection_id,
            },
            ports,
        )
        .await
}

fn agent_session_requires_hosted_knowledge_reconciliation(
    has_project_resource_scope: bool,
    selected_account_id: Option<&str>,
) -> bool {
    has_project_resource_scope && selected_account_id.is_some()
}

/// List exact Project Environments available through this connection revision.
#[tauri::command]
pub async fn list_agent_knowledge_environments(
    state: State<'_, AppState>,
    connection_id: ConnectionId,
) -> AppResult<Vec<KnowledgeEnvironmentSummary>> {
    state.wait_for_post_paint_recovery().await?;
    let connection = state
        .services
        .knowledge
        .pin_connection_for_read(Uuid::from(connection_id))
        .await?;
    if connection.scope.selected_account_id.is_some() {
        state.services.knowledge.reconcile_current_access().await?;
    }
    state
        .services
        .knowledge
        .agent_knowledge_environments(&connection)
        .await
}

/// Resume persisted history through the official adapter's ACP session/load path.
#[tauri::command]
pub async fn resume_agent_acp_session(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: AcpSessionId,
) -> AppResult<AcpSessionFocus> {
    state.wait_for_post_paint_recovery().await?;
    let ports = DesktopAcpRuntimePorts::new(app, state.agent_plugins.clone());
    state.agents_acp.resume(id, ports).await
}

/// List workspace-scoped ACP conversations, including persisted closed history.
#[tauri::command]
pub async fn list_agent_acp_sessions(
    state: State<'_, AppState>,
) -> AppResult<Vec<AcpSessionSummary>> {
    state.wait_for_post_paint_recovery().await?;
    state.agents_acp.list().await
}

/// Replay a bounded ACP event stream when switching conversations.
#[tauri::command]
pub async fn focus_agent_acp_session(
    state: State<'_, AppState>,
    id: AcpSessionId,
    after_sequence: Option<u64>,
) -> AppResult<AcpSessionFocus> {
    state.wait_for_post_paint_recovery().await?;
    state.agents_acp.focus(id, after_sequence).await
}

/// Submit a prompt plus bounded editor context to the pinned ACP session.
#[tauri::command]
pub async fn prompt_agent_acp_session(
    state: State<'_, AppState>,
    id: AcpSessionId,
    prompt: String,
    context: AcpPromptContext,
) -> AppResult<()> {
    state.wait_for_post_paint_recovery().await?;
    state.agents_acp.prompt(id, prompt, context)
}

/// Cancel only the active ACP turn.
#[tauri::command]
pub async fn cancel_agent_acp_session(
    state: State<'_, AppState>,
    id: AcpSessionId,
) -> AppResult<()> {
    state.wait_for_post_paint_recovery().await?;
    state.agents_acp.cancel(id).await
}

/// Resolve an actual ACP permission request with one offered option or cancel it.
#[tauri::command]
pub async fn respond_agent_acp_permission(
    state: State<'_, AppState>,
    id: AcpSessionId,
    request_id: String,
    option_id: Option<String>,
) -> AppResult<()> {
    state.wait_for_post_paint_recovery().await?;
    state
        .agents_acp
        .respond_permission(id, &request_id, option_id)
}

/// Close one ACP process and immediately revoke its connection capability.
#[tauri::command]
pub async fn close_agent_acp_session(
    state: State<'_, AppState>,
    id: AcpSessionId,
) -> AppResult<()> {
    state.wait_for_post_paint_recovery().await?;
    state.agents_acp.close(id)
}

/// Change one option that the active ACP adapter actually advertised.
#[tauri::command]
pub async fn set_agent_acp_config_option(
    state: State<'_, AppState>,
    id: AcpSessionId,
    config_id: String,
    value: String,
) -> AppResult<()> {
    state.wait_for_post_paint_recovery().await?;
    state
        .agents_acp
        .set_config_option(id, config_id, value)
        .await
}

/// Claude Code / Codex CLI status for connection-pinned Terminal profiles.
#[tauri::command]
pub async fn detect_agent_clis(state: State<'_, AppState>) -> AppResult<Vec<AgentCliInfo>> {
    let agents = state.services.agents.clone();
    Ok(agents.detect_clis().await)
}

#[cfg(test)]
pub(crate) fn assert_agent_transport_contract() {
    assert!(!agent_session_requires_hosted_knowledge_reconciliation(
        true, None,
    ));
    assert!(agent_session_requires_hosted_knowledge_reconciliation(
        true,
        Some("account-1"),
    ));
    assert!(!agent_session_requires_hosted_knowledge_reconciliation(
        false,
        Some("account-1"),
    ));
}

/// List the read-only archive left by the retired in-app Agent chat.
#[tauri::command]
pub async fn list_retired_chat_archive_threads(
    state: State<'_, AppState>,
) -> AppResult<Vec<RetiredChatArchiveThread>> {
    state.services.agents.list_retired_archive_threads().await
}

/// Read one archived thread's messages, oldest first, without any mutation path.
#[tauri::command]
pub async fn get_retired_chat_archive_messages(
    state: State<'_, AppState>,
    thread_id: RetiredChatThreadId,
) -> AppResult<Vec<RetiredChatArchiveMessage>> {
    state
        .services
        .agents
        .retired_archive_messages(thread_id)
        .await
}
