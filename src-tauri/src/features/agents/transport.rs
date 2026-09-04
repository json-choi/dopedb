//! Tauri transport for ACP sessions and CLI probes.

use dopedb_protocol::AcpPluginId;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::error::AppResult;
use crate::kernel::identity::{AcpSessionId, ConnectionId};
use crate::state::AppState;
use uuid::Uuid;

use super::acp::{AcpResourceRequest, DesktopAcpRuntimePorts};
use super::domain::{
    AcpPromptContext, AcpSessionFocus, AcpSessionSummary, AgentCliInfo, AgentProvider,
    AgentResourceScopeSelection,
};
use super::runtime::{AcpPluginMutationReceipt, AcpPluginStatus};
use crate::features::knowledge::domain::KnowledgeEnvironmentSummary;

const MAX_EXTERNAL_AGENT_LINK_BYTES: usize = 2_048;

fn validated_external_agent_link(href: &str) -> AppResult<String> {
    if href.is_empty()
        || href.len() > MAX_EXTERNAL_AGENT_LINK_BYTES
        || href.chars().any(char::is_control)
    {
        return Err(crate::AppError::Config(
            "the Agent external link is invalid".into(),
        ));
    }
    let parsed = Url::parse(href)
        .map_err(|_| crate::AppError::Config("the Agent external link is invalid".into()))?;
    match parsed.scheme() {
        "http" | "https"
            if parsed.host_str().is_some()
                && parsed.username().is_empty()
                && parsed.password().is_none() => {}
        "mailto" if !parsed.path().is_empty() => {}
        _ => {
            return Err(crate::AppError::Config(
                "the Agent external link must use HTTPS, HTTP, or mailto".into(),
            ));
        }
    }
    Ok(parsed.into())
}

/// Validate an untrusted Agent link, ask for native consent, then open it.
#[tauri::command]
pub async fn open_agent_external_link(
    app: tauri::AppHandle,
    href: String,
    language: String,
) -> AppResult<bool> {
    let target = validated_external_agent_link(&href)?;
    let (title, message) = if language == "ko" {
        (
            "외부 링크를 열까요?",
            format!("Agent가 제안한 외부 주소입니다. 기본 앱에서 열까요?\n\n{target}"),
        )
    } else {
        (
            "Open external link?",
            format!(
                "The Agent suggested this external destination. Open it in your default application?\n\n{target}"
            ),
        )
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNo)
        .show(move |confirmed| {
            let _ = sender.send(confirmed);
        });
    let confirmed = receiver.await.map_err(|_| {
        crate::AppError::Config("the external-link confirmation was interrupted".into())
    })?;
    if !confirmed {
        return Ok(false);
    }
    app.opener()
        .open_url(target, None::<String>)
        .map_err(|error| {
            crate::AppError::Config(format!("could not open external link: {error}"))
        })?;
    Ok(true)
}

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
#[tauri::command]
pub async fn start_agent_acp_session(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    connection_id: ConnectionId,
    provider: AgentProvider,
    resource_scopes: Vec<AgentResourceScopeSelection>,
    write_connection_id: Option<Uuid>,
) -> AppResult<AcpSessionFocus> {
    state.wait_for_post_paint_recovery().await?;
    let connection = state
        .services
        .knowledge
        .pin_connection_for_read(Uuid::from(connection_id))
        .await?;
    if agent_session_requires_hosted_knowledge_reconciliation(
        connection.scope.selected_account_id.as_deref(),
    ) {
        state.services.knowledge.reconcile_current_access().await?;
    }
    let ports = DesktopAcpRuntimePorts::new(app, state.agent_plugins.clone());
    state
        .agents_acp
        .start(
            connection_id,
            provider,
            AcpResourceRequest {
                resource_scopes,
                write_connection_id,
            },
            ports,
        )
        .await
}

fn agent_session_requires_hosted_knowledge_reconciliation(
    selected_account_id: Option<&str>,
) -> bool {
    selected_account_id.is_some()
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
        None,
    ));
    assert!(agent_session_requires_hosted_knowledge_reconciliation(
        Some("account-1"),
    ));
    assert_eq!(
        validated_external_agent_link("https://example.test/path?q=1")
            .expect("valid external link"),
        "https://example.test/path?q=1"
    );
    assert!(validated_external_agent_link("mailto:owner@example.test").is_ok());
    assert!(validated_external_agent_link("javascript:alert(1)").is_err());
    assert!(validated_external_agent_link("https://user@example.test").is_err());
    assert!(validated_external_agent_link("https://example.test/\nnext").is_err());
    assert!(validated_external_agent_link(&"x".repeat(MAX_EXTERNAL_AGENT_LINK_BYTES + 1)).is_err());
}
