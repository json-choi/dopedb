//! Tauri approval surface for external official Agent CLI sessions.

use dopedb_protocol::ExternalAgentConfig;
use tauri::State;
use uuid::Uuid;

use crate::broker::{
    ExternalAgentRequestDecision, ExternalAgentRequestKind, ExternalAgentRequestSummary,
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[tauri::command]
pub fn list_external_agent_requests(
    state: State<'_, AppState>,
) -> Vec<ExternalAgentRequestSummary> {
    state.broker.external_agent_requests().list()
}

#[tauri::command]
pub fn respond_external_agent_request(
    state: State<'_, AppState>,
    id: Uuid,
    approved: bool,
    config: Option<ExternalAgentConfig>,
) -> AppResult<()> {
    let request = state
        .broker
        .external_agent_requests()
        .list()
        .into_iter()
        .find(|request| request.id == id)
        .ok_or_else(|| AppError::Blocked {
            reason: "the external Agent approval request is no longer pending".into(),
        })?;
    if request.kind == ExternalAgentRequestKind::Proposal {
        // A queued proposal is decided only through the exact operation approval
        // card. Closing its entry never approves, rejects, or widens anything.
        if approved || config.is_some() {
            return Err(AppError::Config(
                "an external Agent proposal is decided through its exact approval card".into(),
            ));
        }
        state.broker.external_agent_requests().dismiss_proposal(id);
        return Ok(());
    }
    let decision = if !approved {
        if config.is_some() {
            return Err(AppError::Config(
                "a rejected external Agent request cannot include a configuration".into(),
            ));
        }
        ExternalAgentRequestDecision::Rejected
    } else {
        match request.kind {
            ExternalAgentRequestKind::Configure => {
                // An approved configuration must be one valid Project resource set.
                let config = config
                    .filter(ExternalAgentConfig::validate)
                    .ok_or_else(|| {
                        AppError::Config(super::domain::agent_error::SCOPE_UNAVAILABLE.into())
                    })?;
                if config.provider != request.provider {
                    return Err(AppError::Config(
                        "the approved Agent provider does not match the request".into(),
                    ));
                }
                ExternalAgentRequestDecision::Approved(Some(config))
            }
            ExternalAgentRequestKind::Start => {
                if config.is_some() {
                    return Err(AppError::Config(
                        "a session approval cannot change the requested Agent configuration".into(),
                    ));
                }
                ExternalAgentRequestDecision::Approved(None)
            }
            ExternalAgentRequestKind::Proposal => {
                return Err(AppError::Config(
                    "an external Agent proposal is decided through its exact approval card".into(),
                ));
            }
        }
    };
    state.broker.external_agent_requests().respond(id, decision)
}
