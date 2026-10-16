//! Desktop-approved bootstrap for an official Agent CLI outside the app window.

use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

use dopedb_protocol::{
    AcpPluginId, ExternalAgentConfig, ExternalAgentConfigCreateCommand,
    ExternalAgentConfigCreateResult, ExternalAgentProvider, ExternalAgentSessionRevokeCommand,
    ExternalAgentSessionStartCommand, ExternalAgentSessionStartResult,
};
use tauri::{Emitter, Manager, UserAttentionType};

use super::*;
use crate::broker::{
    AgentKnowledgeAuthorization, ExternalAgentProcessAuthorization, ExternalAgentProposalReference,
    ExternalAgentRequestDecision, ExternalAgentRequestKind, ExternalAgentRequestRegistry,
    ExternalAgentRequestSummary,
};
use crate::error::AppResult;
use crate::features::agents::acp::narrow_resource_scope;
use crate::kernel::access::ActiveResourceScope;

const EXTERNAL_AGENT_APPROVAL_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const EXTERNAL_AGENT_CAPABILITY_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const REQUEST_EVENT: &str = "external-agent:requested";
const REQUEST_FINISHED_EVENT: &str = "external-agent:finished";

pub(super) async fn handle(
    dispatcher: &BrokerDispatcher,
    request: &RequestEnvelope,
) -> ResponseEnvelope {
    match request.command {
        CommandName::ExternalAgentConfigCreate => configure(dispatcher, request).await,
        CommandName::ExternalAgentSessionStart => start(dispatcher, request).await,
        CommandName::ExternalAgentSessionRevoke => revoke(dispatcher, request),
        _ => failure(request.request_id, ErrorCode::InvalidRequest, false),
    }
}

async fn configure(dispatcher: &BrokerDispatcher, request: &RequestEnvelope) -> ResponseEnvelope {
    let arguments = match decode_arguments::<ExternalAgentConfigCreateCommand>(request) {
        Ok(arguments)
            if arguments.validate() && valid_working_directory(&arguments.working_directory) =>
        {
            arguments
        }
        _ => return failure(request.request_id, ErrorCode::InvalidRequest, false),
    };
    let summary = ExternalAgentRequestSummary {
        id: request.request_id,
        kind: ExternalAgentRequestKind::Configure,
        provider: arguments.provider,
        working_directory: arguments.working_directory,
        config: None,
        proposal: None,
    };
    let decision = match await_decision(dispatcher, summary).await {
        Ok(decision) => decision,
        Err(code) => return failure(request.request_id, code, false),
    };
    let ExternalAgentRequestDecision::Approved(Some(config)) = decision else {
        return failure(request.request_id, ErrorCode::PolicyBlocked, false);
    };
    if !config.validate() || config.provider != arguments.provider {
        return failure(request.request_id, ErrorCode::InvalidRequest, false);
    }
    respond(
        request.request_id,
        Ok::<_, ErrorCode>(ExternalAgentConfigCreateResult { config }),
    )
}

async fn start(dispatcher: &BrokerDispatcher, request: &RequestEnvelope) -> ResponseEnvelope {
    let arguments = match decode_arguments::<ExternalAgentSessionStartCommand>(request) {
        Ok(arguments)
            if arguments.validate() && valid_working_directory(&arguments.working_directory) =>
        {
            arguments
        }
        _ => return failure(request.request_id, ErrorCode::InvalidRequest, false),
    };
    let Some(peer) = dispatcher.peer else {
        return failure(request.request_id, ErrorCode::AuthenticationDenied, false);
    };
    let summary = ExternalAgentRequestSummary {
        id: request.request_id,
        kind: ExternalAgentRequestKind::Start,
        provider: arguments.config.provider,
        working_directory: arguments.working_directory.clone(),
        config: Some(arguments.config.clone()),
        proposal: None,
    };
    match await_decision(dispatcher, summary).await {
        Ok(ExternalAgentRequestDecision::Approved(None)) => {}
        Ok(_) => return failure(request.request_id, ErrorCode::PolicyBlocked, false),
        Err(code) => return failure(request.request_id, code, false),
    }
    let provider = arguments.config.provider;
    let result = issue_session(dispatcher, arguments.config, peer)
        .await
        .map_err(map_application_error);
    if let Ok(started) = &result {
        dispatcher
            .external_agent_requests
            .register_external_session(
                TerminalSessionId::from(started.terminal_session_id),
                provider,
                arguments.working_directory,
            );
    }
    respond(request.request_id, result)
}

/// Show a pending SQL proposal from a Desktop-approved external Agent process in
/// the same approval gate. In-app ACP sessions are not registered here because
/// their transcript already owns the one approval card.
pub(super) fn surface_proposal(
    dispatcher: &BrokerDispatcher,
    terminal_session_id: TerminalSessionId,
    summary: &OperationSummary,
) {
    if summary.state != dopedb_protocol::OperationState::PendingApproval {
        return;
    }
    let Some(entry) = dispatcher.external_agent_requests.enqueue_proposal(
        terminal_session_id,
        ExternalAgentProposalReference {
            operation_id: summary.operation_id,
            connection_id: summary.connection_id,
            payload_hash: summary.payload_hash.clone(),
            state: summary.state,
        },
    ) else {
        return;
    };
    let Some(app) = dispatcher.app_handle.as_ref() else {
        return;
    };
    request_attention(dispatcher, UserAttentionType::Informational);
    if let Err(error) = app.emit(REQUEST_EVENT, entry) {
        tracing::warn!(%error, "failed to announce an external Agent proposal");
    }
}

/// Ask for the person's attention without activating the window: keystrokes
/// typed in another app, often the requesting terminal, must never land on an
/// approval control. Returns `false` when there is no window to show it in.
fn request_attention(dispatcher: &BrokerDispatcher, attention: UserAttentionType) -> bool {
    let Some(window) = dispatcher
        .app_handle
        .as_ref()
        .and_then(|app| app.get_webview_window("main"))
    else {
        return false;
    };
    if let Err(error) = window.request_user_attention(Some(attention)) {
        tracing::debug!(%error, "could not request attention for an external Agent request");
    }
    true
}

/// Release what a removed external Agent session queued for approval and clear
/// those entries from the Desktop approval UI.
pub(crate) fn release_external_session(
    requests: &ExternalAgentRequestRegistry,
    app: Option<&tauri::AppHandle>,
    terminal_session_id: TerminalSessionId,
) {
    let released = requests.forget_external_session(terminal_session_id);
    let Some(app) = app else {
        return;
    };
    for id in released {
        if let Err(error) = app.emit(REQUEST_FINISHED_EVENT, id) {
            tracing::warn!(%error, %id, "failed to clear a released external Agent proposal");
        }
    }
}

fn revoke(dispatcher: &BrokerDispatcher, request: &RequestEnvelope) -> ResponseEnvelope {
    if decode_arguments::<ExternalAgentSessionRevokeCommand>(request).is_err() {
        return failure(request.request_id, ErrorCode::InvalidRequest, false);
    }
    let Some(authentication) = request.authentication.as_ref() else {
        return failure(request.request_id, ErrorCode::AuthenticationDenied, false);
    };
    let session = match dispatcher
        .sessions
        .authenticate(authentication, dispatcher.peer.as_ref())
    {
        Ok(session) if session.agent_plugin_id.is_some() => session,
        _ => return failure(request.request_id, ErrorCode::AuthenticationDenied, false),
    };
    dispatcher.sessions.revoke(session.terminal_session_id);
    release_external_session(
        &dispatcher.external_agent_requests,
        dispatcher.app_handle.as_ref(),
        session.terminal_session_id,
    );
    respond(
        request.request_id,
        Ok::<_, ErrorCode>(dopedb_protocol::EmptyArguments {}),
    )
}

async fn await_decision(
    dispatcher: &BrokerDispatcher,
    summary: ExternalAgentRequestSummary,
) -> Result<ExternalAgentRequestDecision, ErrorCode> {
    let id = summary.id;
    let receiver = dispatcher
        .external_agent_requests
        .begin(summary.clone())
        .map_err(map_application_error)?;
    let Some(app) = dispatcher.app_handle.as_ref() else {
        finish_request(dispatcher, id);
        return Err(ErrorCode::Internal);
    };
    // Ask for attention first so a missing window cannot leave an already-emitted
    // request in the approval UI after its pending receiver has been removed. The
    // window is never activated: the request is blocking a terminal the person
    // may still be typing in.
    if !request_attention(dispatcher, UserAttentionType::Critical)
        || app.emit(REQUEST_EVENT, summary).is_err()
    {
        finish_request(dispatcher, id);
        return Err(ErrorCode::Internal);
    }
    let decision = tokio::time::timeout(EXTERNAL_AGENT_APPROVAL_TIMEOUT, receiver).await;
    finish_request(dispatcher, id);
    match decision {
        Ok(Ok(decision)) => Ok(decision),
        Ok(Err(_)) => Err(ErrorCode::PolicyBlocked),
        Err(_) => Err(ErrorCode::Timeout),
    }
}

fn finish_request(dispatcher: &BrokerDispatcher, id: Uuid) {
    dispatcher.external_agent_requests.finish(id);
    let Some(app) = dispatcher.app_handle.as_ref() else {
        return;
    };
    if let Err(error) = app.emit(REQUEST_FINISHED_EVENT, id) {
        tracing::warn!(%error, %id, "failed to clear an external Agent approval request");
    }
}

async fn issue_session(
    dispatcher: &BrokerDispatcher,
    config: ExternalAgentConfig,
    peer: crate::broker::peer::PeerProcessIdentity,
) -> AppResult<ExternalAgentSessionStartResult> {
    let services = dispatcher
        .services
        .as_ref()
        .ok_or_else(|| AppError::Config("application services are unavailable".into()))?;
    let mut anchor = services
        .knowledge
        .pin_connection_for_read(config.anchor_connection_id)
        .await?;
    if anchor.scope.selected_account_id.is_some() {
        services.knowledge.reconcile_current_access().await?;
        anchor = services
            .knowledge
            .pin_connection_for_read(config.anchor_connection_id)
            .await?;
    }

    let mut scopes = Vec::with_capacity(config.resource_scopes.len());
    let mut connection_ids = BTreeSet::new();
    let mut source_ids = BTreeSet::new();
    for selection in &config.resource_scopes {
        let authority = services
            .knowledge
            .pin_connection_for_read(selection.authority_connection_id)
            .await?;
        if !same_storage_scope(&anchor.scope, &authority.scope) {
            return Err(AppError::Blocked {
                reason: "the external Agent resources belong to another workspace or account"
                    .into(),
            });
        }
        let mut scope = services
            .knowledge
            .knowledge_session_scope(
                &authority,
                Some(selection.project_environment_id),
                &selection.connection_ids,
            )
            .await?
            .ok_or_else(|| AppError::Blocked {
                reason: "the configured Project resource scope is unavailable".into(),
            })?;
        narrow_resource_scope(&mut scope, &selection.connection_ids, &selection.source_ids)?;
        if scope.project_id != config.project_id
            || scope
                .connections
                .iter()
                .any(|connection| !connection_ids.insert(connection.connection_id))
            || scope
                .sources
                .iter()
                .any(|source| !source_ids.insert(source.source_id))
        {
            return Err(AppError::Blocked {
                reason: "the external Agent configuration is not one exact Project resource set"
                    .into(),
            });
        }
        scopes.push(scope);
    }
    if config
        .write_connection_id
        .is_some_and(|connection_id| !connection_ids.contains(&connection_id))
    {
        return Err(AppError::Blocked {
            reason: "the external Agent write target is outside the selected database set".into(),
        });
    }
    let knowledge_account_scope = anchor
        .scope
        .selected_account_id
        .as_deref()
        .unwrap_or_else(|| anchor.scope.account_scope.storage_key());
    for scope in &scopes {
        services
            .knowledge
            .exact_knowledge_session_graphs(
                scope,
                anchor.scope.workspace_id,
                knowledge_account_scope,
            )
            .await?;
    }

    let terminal_session_id = TerminalSessionId::from(Uuid::new_v4());
    let expires_at = dispatcher.sessions.issue_external_agent_process(
        terminal_session_id,
        &anchor,
        BrokerCapability::ALL,
        EXTERNAL_AGENT_CAPABILITY_TTL,
        ExternalAgentProcessAuthorization {
            plugin_id: match config.provider {
                ExternalAgentProvider::Codex => AcpPluginId::Codex,
                ExternalAgentProvider::Claude => AcpPluginId::Claude,
            },
            knowledge: AgentKnowledgeAuthorization {
                scopes,
                write_connection_id: config.write_connection_id.map(ConnectionId::from),
            },
            peer,
        },
    )?;
    Ok(ExternalAgentSessionStartResult {
        terminal_session_id: terminal_session_id.into(),
        expires_at,
    })
}

fn valid_working_directory(value: &str) -> bool {
    let supplied = Path::new(value);
    if !supplied.is_absolute() {
        return false;
    }
    let Ok(canonical) = std::fs::canonicalize(supplied) else {
        return false;
    };
    canonical.as_path() == supplied && canonical.is_dir()
}

fn same_storage_scope(left: &ActiveResourceScope, right: &ActiveResourceScope) -> bool {
    left.workspace_id == right.workspace_id
        && left.account_scope.storage_key() == right.account_scope.storage_key()
        && left.selected_account_id == right.selected_account_id
}
