//! Broker envelope validation, authentication sequencing, and feature-handler routing.
mod analysis_article_operation;
mod connection_catalog;
mod external_agent;
mod knowledge;
mod projection;
mod public_skill;
mod query_document;

use projection::*;

use super::session::{AuthenticatedSession, BrokerCapability, BrokerSessionRegistry};
use super::ExternalAgentRequestRegistry;
use crate::error::AppError;
use crate::features::catalog::CatalogReadPolicy;
use crate::features::connections::{AgentConnectionSummary, CliConnectionResolutionError};
use crate::features::documents::{AgentDocumentReadError, TerminalDocumentReadRequest};
use crate::features::queries::TerminalSqlProposalRequest;
use crate::features::queries::{AgentQueryPlanError, TerminalQueryPlanRequest};
use crate::kernel::identity::{ConnectionId, RuntimeId, TerminalSessionId};
use crate::kernel::TerminalAuthority;
use crate::model::{DocumentPage, DocumentQuery, Engine, QueryResult};
use crate::monitoring::HealthSnapshot;
use crate::services::ApplicationServices;
use crate::skills::SkillManager;
use dopedb_protocol::{
    decode_arguments, encode_frame, AgentSessionRegisterCommand, AppOpenCommand, AppOpenResult,
    CatalogArguments, CatalogSearchArguments, CatalogSearchCommand, CatalogSearchMatch,
    CatalogSearchMatchType, CatalogSearchResult, CatalogShowCommand, CatalogSnapshot, CommandName,
    CommandSpec, ConnectionListCommand, ConnectionListResult, ConnectionSelector,
    ConnectionSelectorArguments, ConnectionShowCommand, ConnectionSummary, ConnectionTestCommand,
    ConnectionTestResult, DatabaseEngine, DatabaseListCommand, DatabaseListResult,
    DatabaseSummary as ProtocolDatabaseSummary, DocumentPage as ProtocolDocumentPage,
    DocumentQuery as ProtocolDocumentQuery, DocumentRunArguments, DocumentRunCommand,
    DocumentRunResult, EmptyArguments, ErrorCode, OperationArguments, OperationCancelCommand,
    OperationShowCommand, OperationSummary, OperationWaitArguments, OperationWaitCommand,
    ProtocolError, QueryCancelCommand, QueryHealth, QueryPlanArguments, QueryPlanCommand,
    QueryPlanResult, QueryResultPage, QueryRunArguments, QueryRunCommand, QueryRunResult,
    RequestEnvelope, ResponseEnvelope, SchemaListCommand, SchemaListResult, SchemaSummary,
    SkillInstallCommand, SkillMutationArguments, SkillRemoveCommand, SkillRepairCommand,
    SkillStatusCommand, SkillsGetCommand, SkillsListCommand, SqlProposeArguments,
    SqlProposeCommand, StatusCommand, StatusResult, TableDescribeArguments, TableDescribeCommand,
    TableDescribeResult, VersionCommand, VersionResult, COMMAND_SCHEMA_VERSION,
    MAX_CATALOG_SEARCH_KINDS, MAX_CATALOG_SEARCH_MATCHES, MAX_CATALOG_SEARCH_QUERY_BYTES,
    MAX_RESPONSE_BYTES, MAX_STRING_BYTES, PROTOCOL_MAX, PROTOCOL_MIN,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;
use tauri::{Emitter, Manager};
use uuid::Uuid;

const MAX_SQL_BYTES: usize = MAX_STRING_BYTES;
const MAX_TABLE_SELECTOR_BYTES: usize = 512;
const MAX_OPERATION_WAIT: Duration = Duration::from_secs(30);

#[cfg(test)]
pub(crate) fn assert_dispatch_contract() {
    connection_catalog::assert_catalog_search_contract();
    projection::assert_execution_error_contract();
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationActivityEvent {
    request_id: Uuid,
    terminal_session_id: TerminalSessionId,
    connection_id: Option<ConnectionId>,
    command: &'static str,
    state: &'static str,
    error_code: Option<ErrorCode>,
}

#[derive(Clone)]
pub(crate) struct BrokerDispatcher {
    runtime_id: RuntimeId,
    app_version: &'static str,
    sessions: BrokerSessionRegistry,
    external_agent_requests: ExternalAgentRequestRegistry,
    services: Option<ApplicationServices>,
    skills: Option<SkillManager>,
    app_handle: Option<tauri::AppHandle>,
    peer: Option<super::peer::PeerProcessIdentity>,
}

impl BrokerDispatcher {
    pub(crate) fn new(
        runtime_id: RuntimeId,
        app_version: &'static str,
        sessions: BrokerSessionRegistry,
        external_agent_requests: ExternalAgentRequestRegistry,
        services: Option<ApplicationServices>,
        skills: Option<SkillManager>,
        app_handle: Option<tauri::AppHandle>,
    ) -> Self {
        Self {
            runtime_id,
            app_version,
            sessions,
            external_agent_requests,
            services,
            skills,
            app_handle,
            peer: None,
        }
    }

    pub(crate) fn for_peer(&self, peer: super::peer::PeerProcessIdentity) -> Self {
        let mut dispatcher = self.clone();
        dispatcher.peer = Some(peer);
        dispatcher
    }

    pub(crate) async fn dispatch(&self, request: RequestEnvelope) -> ResponseEnvelope {
        let requested_protocol = request.protocol_version;
        let activity = (request.command != CommandName::AgentSessionRegister)
            .then_some(request.authentication.as_ref())
            .flatten()
            .and_then(|authentication| {
                self.sessions
                    .authenticate(authentication, self.peer.as_ref())
                    .ok()
                    .map(|session| {
                        (
                            request.request_id,
                            session.terminal_session_id,
                            session.connection_id,
                            request.command,
                        )
                    })
            });
        let response_protocol = if (PROTOCOL_MIN..=PROTOCOL_MAX).contains(&requested_protocol) {
            requested_protocol
        } else {
            PROTOCOL_MAX
        };
        let response = self.dispatch_current(request).await;
        let response = response_at_protocol(response, response_protocol);
        if let Some((request_id, terminal_session_id, connection_id, command)) = activity {
            self.emit_operation_activity(
                request_id,
                terminal_session_id,
                connection_id,
                command,
                &response,
            );
        }
        response
    }

    fn emit_operation_activity(
        &self,
        request_id: Uuid,
        terminal_session_id: TerminalSessionId,
        connection_id: ConnectionId,
        command: CommandName,
        response: &ResponseEnvelope,
    ) {
        let Some(app) = &self.app_handle else {
            return;
        };
        let payload = OperationActivityEvent {
            request_id,
            terminal_session_id,
            connection_id: Some(connection_id),
            command: command.as_str(),
            state: if response.is_ok() {
                "completed"
            } else {
                "failed"
            },
            error_code: response.error().map(ProtocolError::code),
        };
        if let Err(error) = app.emit("operation:changed", payload) {
            tracing::warn!(%error, "failed to emit broker operation activity");
        }
    }

    async fn dispatch_current(&self, request: RequestEnvelope) -> ResponseEnvelope {
        let request_id = request.request_id;
        if request.protocol_version < PROTOCOL_MIN
            || request.protocol_version > PROTOCOL_MAX
            || request.command_schema_version != COMMAND_SCHEMA_VERSION
        {
            return failure(request_id, ErrorCode::ProtocolMismatch, false);
        }

        match request.command {
            CommandName::AgentSessionRegister => self.register_agent_session(&request),
            CommandName::ExternalAgentConfigCreate
            | CommandName::ExternalAgentSessionStart
            | CommandName::ExternalAgentSessionRevoke => {
                external_agent::handle(self, &request).await
            }
            CommandName::Version
            | CommandName::Status
            | CommandName::AppOpen
            | CommandName::SkillsList
            | CommandName::SkillsGet
            | CommandName::SkillStatus
            | CommandName::SkillInstall
            | CommandName::SkillRepair
            | CommandName::SkillRemove => public_skill::handle(self, &request).await,
            CommandName::ConnectionList
            | CommandName::ConnectionShow
            | CommandName::ConnectionTest
            | CommandName::DatabaseList
            | CommandName::CatalogShow
            | CommandName::CatalogSearch
            | CommandName::SchemaList
            | CommandName::TableDescribe => connection_catalog::handle(self, &request).await,
            CommandName::DocumentRun
            | CommandName::QueryPlan
            | CommandName::QueryRun
            | CommandName::QueryCancel => query_document::handle(self, &request).await,
            CommandName::SqlPropose
            | CommandName::OperationShow
            | CommandName::OperationWait
            | CommandName::OperationCancel => query_document::handle(self, &request).await,
            CommandName::AnalysisArticlePropose
            | CommandName::AnalysisArticleUpdate
            | CommandName::AnalysisArticleVerify
            | CommandName::AnalysisArticleList => {
                analysis_article_operation::handle(self, &request).await
            }
            CommandName::KnowledgeSearch
            | CommandName::SourceSearch
            | CommandName::SourceRead
            | CommandName::KnowledgeExplain
            | CommandName::KnowledgeNeighbors
            | CommandName::KnowledgePath
            | CommandName::KnowledgeEvidence
            | CommandName::KnowledgeDiff
            | CommandName::FunnelTrace
            | CommandName::EnvironmentContext
            | CommandName::KnowledgeMappingPropose => knowledge::handle(self, &request).await,
            CommandName::Unknown => failure(request_id, ErrorCode::InvalidRequest, false),
        }
    }

    fn register_agent_session(&self, request: &RequestEnvelope) -> ResponseEnvelope {
        let request_id = request.request_id;
        if !self.sessions.authority_available() {
            return failure(request_id, ErrorCode::RuntimeUnavailable, true);
        }
        let arguments = match decode_arguments::<AgentSessionRegisterCommand>(request) {
            Ok(arguments) if arguments.validate() => arguments,
            _ => return failure(request_id, ErrorCode::InvalidRequest, false),
        };
        let Some(authentication) = request.authentication.as_ref() else {
            return failure(request_id, ErrorCode::AuthenticationDenied, false);
        };
        if authentication.token().is_none() {
            return failure(request_id, ErrorCode::AuthenticationDenied, false);
        }
        let Some(peer) = self.peer else {
            return failure(request_id, ErrorCode::AuthenticationDenied, false);
        };
        respond(
            request_id,
            self.sessions
                .bind_agent_process(authentication, peer, &arguments)
                .map(|_| dopedb_protocol::EmptyArguments::default())
                .map_err(|_| ErrorCode::AuthenticationDenied),
        )
    }

    pub(super) fn authenticate(
        &self,
        request: &RequestEnvelope,
        capability: BrokerCapability,
    ) -> Result<AuthenticatedSession, (ErrorCode, bool)> {
        if !self.sessions.authority_available() {
            return Err((ErrorCode::RuntimeUnavailable, true));
        }
        let authentication = request
            .authentication
            .as_ref()
            .ok_or((ErrorCode::AuthenticationDenied, false))?;
        let session = self
            .sessions
            .authenticate(authentication, self.peer.as_ref())
            .map_err(|_| (ErrorCode::AuthenticationDenied, false))?;
        session
            .require(capability)
            .map_err(|_| (ErrorCode::ScopeDenied, false))?;
        Ok(session)
    }

    pub(super) fn services(&self) -> Result<&ApplicationServices, ErrorCode> {
        self.services.as_ref().ok_or(ErrorCode::Internal)
    }
}
