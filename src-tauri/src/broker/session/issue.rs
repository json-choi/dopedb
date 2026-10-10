//! Capability issuance for the Broker session registry. Every session is pinned
//! to one exact connection scope with a positive TTL, and an Agent's optional
//! single write target must lie inside its selected Project resources. Bearer
//! tokens exist only in process memory and in the returned capability.

use std::time::Duration;

use chrono::{DateTime, Utc};
use dopedb_protocol::AgentSessionRegisterArguments;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::features::knowledge::domain::KnowledgeSessionScope;
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::{AccountScopeId, ConnectionId, TerminalSessionId};

use super::{
    valid_agent_registration_paths, AgentKnowledgeAuthorization, AuthenticatedSession,
    BrokerCapability, BrokerSessionRegistry, ExternalAgentProcessAuthorization,
    IssuedSessionCapability, SessionAuthorization, SessionRecord, SESSION_TOKEN_BYTES,
};

impl BrokerSessionRegistry {
    pub(crate) fn issue(
        &self,
        terminal_session_id: TerminalSessionId,
        pin: &PinnedConnection,
        capabilities: impl IntoIterator<Item = BrokerCapability>,
        ttl: Duration,
    ) -> AppResult<IssuedSessionCapability> {
        self.issue_with_authorization(
            terminal_session_id,
            pin,
            capabilities,
            ttl,
            None,
            AgentKnowledgeAuthorization::default(),
        )
    }

    #[cfg(test)]
    pub(crate) fn issue_agent(
        &self,
        terminal_session_id: TerminalSessionId,
        pin: &PinnedConnection,
        capabilities: impl IntoIterator<Item = BrokerCapability>,
        ttl: Duration,
        registration: AgentSessionRegisterArguments,
    ) -> AppResult<IssuedSessionCapability> {
        if !valid_agent_registration_paths(&registration) {
            return Err(AppError::Config(
                "the ACP launcher registration descriptor is invalid".into(),
            ));
        }
        self.issue_with_authorization(
            terminal_session_id,
            pin,
            capabilities,
            ttl,
            Some(registration),
            AgentKnowledgeAuthorization::default(),
        )
    }

    pub(crate) fn issue_agent_with_knowledge(
        &self,
        terminal_session_id: TerminalSessionId,
        pin: &PinnedConnection,
        capabilities: impl IntoIterator<Item = BrokerCapability>,
        ttl: Duration,
        registration: AgentSessionRegisterArguments,
        knowledge: AgentKnowledgeAuthorization,
    ) -> AppResult<IssuedSessionCapability> {
        if !valid_agent_registration_paths(&registration) {
            return Err(AppError::Config(
                "the ACP launcher registration descriptor is invalid".into(),
            ));
        }
        self.issue_with_authorization(
            terminal_session_id,
            pin,
            capabilities,
            ttl,
            Some(registration),
            knowledge,
        )
    }

    /// Issue an exact Project resource capability directly to an owner-local
    /// CLI process after the Desktop approval UI accepted that request. No
    /// bearer is created or returned: the caller and its descendants are the
    /// complete authentication boundary for this runtime-only session.
    pub(crate) fn issue_external_agent_process(
        &self,
        terminal_session_id: TerminalSessionId,
        pin: &PinnedConnection,
        capabilities: impl IntoIterator<Item = BrokerCapability>,
        ttl: Duration,
        authorization: ExternalAgentProcessAuthorization,
    ) -> AppResult<DateTime<Utc>> {
        let ExternalAgentProcessAuthorization {
            plugin_id,
            knowledge,
            peer,
        } = authorization;
        let AgentKnowledgeAuthorization {
            scopes: knowledge_scopes,
            write_connection_id,
        } = knowledge;
        self.ensure_authority_available()?;
        if ttl.is_zero() {
            return Err(AppError::Config(
                "external Agent session capability TTL must be positive".into(),
            ));
        }
        validate_write_target(&knowledge_scopes, write_connection_id)?;
        let expires_at = Utc::now()
            + chrono::Duration::from_std(ttl)
                .map_err(|_| AppError::Config("Agent session TTL is too large".into()))?;
        let account_scope = AccountScopeId::new(pin.scope.account_scope.storage_key())
            .expect("active resource scope has a non-empty account partition");
        let knowledge_account_scope = AccountScopeId::new(
            pin.scope
                .selected_account_id
                .as_deref()
                .unwrap_or_else(|| pin.scope.account_scope.storage_key()),
        )
        .expect("active resource scope has a non-empty Knowledge account partition");
        self.sessions.insert(
            terminal_session_id,
            SessionRecord {
                metadata: AuthenticatedSession {
                    terminal_session_id,
                    agent_plugin_id: Some(plugin_id),
                    runtime_id: self.runtime_id,
                    workspace_id: pin.scope.workspace_id.into(),
                    account_scope,
                    knowledge_account_scope,
                    scope_generation: pin.scope.generation,
                    connection_id: pin.connection_id.into(),
                    connection_revision: pin.connection_revision,
                    capabilities: capabilities.into_iter().collect(),
                    knowledge_scopes,
                    write_connection_id,
                    expires_at,
                },
                authorization: SessionAuthorization::AgentProcess(peer),
            },
        );
        Ok(expires_at)
    }

    fn issue_with_authorization(
        &self,
        terminal_session_id: TerminalSessionId,
        pin: &PinnedConnection,
        capabilities: impl IntoIterator<Item = BrokerCapability>,
        ttl: Duration,
        agent_registration: Option<AgentSessionRegisterArguments>,
        knowledge: AgentKnowledgeAuthorization,
    ) -> AppResult<IssuedSessionCapability> {
        let AgentKnowledgeAuthorization {
            scopes: knowledge_scopes,
            write_connection_id,
        } = knowledge;
        self.ensure_authority_available()?;
        if ttl.is_zero() {
            return Err(AppError::Config(
                "terminal session capability TTL must be positive".into(),
            ));
        }
        validate_write_target(&knowledge_scopes, write_connection_id)?;
        let mut token = Zeroizing::new([0u8; SESSION_TOKEN_BYTES]);
        getrandom::fill(token.as_mut()).map_err(|_| {
            AppError::Config("operating system random source is unavailable".into())
        })?;
        let expires_at = Utc::now()
            + chrono::Duration::from_std(ttl)
                .map_err(|_| AppError::Config("terminal session TTL is too large".into()))?;
        let agent_plugin_id = agent_registration
            .as_ref()
            .map(|registration| registration.plugin_id);
        let account_scope = AccountScopeId::new(pin.scope.account_scope.storage_key())
            .expect("active resource scope has a non-empty account partition");
        let knowledge_account_scope = AccountScopeId::new(
            pin.scope
                .selected_account_id
                .as_deref()
                .unwrap_or_else(|| pin.scope.account_scope.storage_key()),
        )
        .expect("active resource scope has a non-empty Knowledge account partition");
        let metadata = AuthenticatedSession {
            terminal_session_id,
            agent_plugin_id,
            runtime_id: self.runtime_id,
            workspace_id: pin.scope.workspace_id.into(),
            account_scope,
            knowledge_account_scope,
            scope_generation: pin.scope.generation,
            connection_id: pin.connection_id.into(),
            connection_revision: pin.connection_revision,
            capabilities: capabilities.into_iter().collect(),
            knowledge_scopes,
            write_connection_id,
            expires_at,
        };
        self.sessions.insert(
            terminal_session_id,
            SessionRecord {
                metadata,
                authorization: match agent_registration {
                    Some(registration) => SessionAuthorization::AgentBootstrap {
                        token: token.clone(),
                        registration: Box::new(registration),
                    },
                    None => SessionAuthorization::Bearer(token.clone()),
                },
            },
        );
        Ok(IssuedSessionCapability {
            terminal_session_id,
            token: Zeroizing::new(hex::encode(token.as_ref())),
            expires_at,
        })
    }
}

/// At most one write target, and only a database the session already selected.
fn validate_write_target(
    knowledge_scopes: &[KnowledgeSessionScope],
    write_connection_id: Option<ConnectionId>,
) -> AppResult<()> {
    if write_connection_id.is_some_and(|write_connection_id| {
        !knowledge_scopes.iter().any(|scope| {
            scope.connections.iter().any(|connection| {
                ConnectionId::from(connection.connection_id) == write_connection_id
            })
        })
    }) {
        return Err(AppError::Config(
            crate::features::agents::domain::agent_error::SCOPE_UNAVAILABLE.into(),
        ));
    }
    Ok(())
}
