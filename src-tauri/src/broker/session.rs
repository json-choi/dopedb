//! In-memory Terminal session capabilities. Tokens never enter SQLite, discovery,
//! logs, argv, or serialized broker results.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use dopedb_protocol::{AcpPluginId, AgentSessionRegisterArguments, SessionAuthentication};
use subtle::ConstantTimeEq;
#[cfg(test)]
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::features::knowledge::domain::KnowledgeSessionScope;
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::{
    AccountScopeId, ConnectionId, RuntimeId, TerminalSessionId, WorkspaceId,
};

use super::peer::{process_is_descendant_or_same, PeerProcessIdentity};

const SESSION_TOKEN_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum BrokerCapability {
    ConnectionRead,
    ConnectionTest,
    CatalogRead,
    DocumentRead,
    QueryPlan,
    QueryRun,
    AnalysisArticleRead,
    AnalysisArticlePropose,
    SqlPropose,
    OperationRead,
    OperationCancel,
    KnowledgeRead,
    KnowledgePropose,
}

impl BrokerCapability {
    pub(crate) const ALL: [Self; 13] = [
        Self::ConnectionRead,
        Self::ConnectionTest,
        Self::CatalogRead,
        Self::DocumentRead,
        Self::QueryPlan,
        Self::QueryRun,
        Self::AnalysisArticleRead,
        Self::AnalysisArticlePropose,
        Self::SqlPropose,
        Self::OperationRead,
        Self::OperationCancel,
        Self::KnowledgeRead,
        Self::KnowledgePropose,
    ];
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AuthenticatedSession {
    pub(crate) terminal_session_id: TerminalSessionId,
    pub(crate) agent_plugin_id: Option<AcpPluginId>,
    pub(crate) runtime_id: RuntimeId,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) account_scope: AccountScopeId,
    /// Database access stays in the Personal/Team storage partition, while a
    /// Personal Workspace GitHub graph is additionally pinned to the exact
    /// signed-in account that received its short-lived Knowledge grant.
    pub(crate) knowledge_account_scope: AccountScopeId,
    pub(crate) scope_generation: i64,
    pub(crate) connection_id: ConnectionId,
    pub(crate) connection_revision: i64,
    pub(crate) capabilities: BTreeSet<BrokerCapability>,
    pub(crate) knowledge_scopes: Vec<KnowledgeSessionScope>,
    /// An ACP resource set may read several selected databases, but mutation
    /// proposals are bounded to this one optional connection before Safety and
    /// database privileges are evaluated.
    pub(crate) write_connection_id: Option<ConnectionId>,
    pub(crate) expires_at: DateTime<Utc>,
}

impl AuthenticatedSession {
    pub(crate) fn require(&self, capability: BrokerCapability) -> AppResult<()> {
        if self.capabilities.contains(&capability) {
            Ok(())
        } else {
            Err(AppError::Blocked {
                reason: "terminal session does not have the required broker capability".into(),
            })
        }
    }
}

struct SessionRecord {
    metadata: AuthenticatedSession,
    authorization: SessionAuthorization,
}

enum SessionAuthorization {
    Bearer(Zeroizing<[u8; SESSION_TOKEN_BYTES]>),
    AgentBootstrap {
        token: Zeroizing<[u8; SESSION_TOKEN_BYTES]>,
        registration: Box<AgentSessionRegisterArguments>,
    },
    AgentProcess(PeerProcessIdentity),
}

impl fmt::Debug for SessionRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionRecord")
            .field("metadata", &self.metadata)
            .field(
                "authorization",
                &match &self.authorization {
                    SessionAuthorization::Bearer(_) => "bearer:<redacted>",
                    SessionAuthorization::AgentBootstrap { .. } => "agent_bootstrap:<redacted>",
                    SessionAuthorization::AgentProcess(_) => "agent_process",
                },
            )
            .finish()
    }
}

pub(crate) struct IssuedSessionCapability {
    pub(crate) terminal_session_id: TerminalSessionId,
    token: Zeroizing<String>,
    pub(crate) expires_at: DateTime<Utc>,
}

#[derive(Default)]
pub(crate) struct AgentKnowledgeAuthorization {
    pub(crate) scopes: Vec<KnowledgeSessionScope>,
    pub(crate) write_connection_id: Option<ConnectionId>,
}

pub(crate) struct ExternalAgentProcessAuthorization {
    pub(crate) plugin_id: AcpPluginId,
    pub(crate) knowledge: AgentKnowledgeAuthorization,
    pub(crate) peer: PeerProcessIdentity,
}

impl IssuedSessionCapability {
    pub(crate) fn token(&self) -> &str {
        &self.token
    }
}

impl fmt::Debug for IssuedSessionCapability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IssuedSessionCapability")
            .field("terminal_session_id", &self.terminal_session_id)
            .field("token", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

#[derive(Clone)]
pub(crate) struct BrokerSessionRegistry {
    runtime_id: RuntimeId,
    sessions: std::sync::Arc<DashMap<TerminalSessionId, SessionRecord>>,
    authority_verified: std::sync::Arc<AtomicBool>,
    authority_refreshes: std::sync::Arc<AtomicUsize>,
}

/// One in-flight hosted-authority verification. While any guard is alive, new
/// Broker authentication and capability issuance fail closed without destroying
/// the already running ACP/PTY process. A successful unchanged refresh can then
/// resume those exact capabilities instead of terminating the conversation.
pub(crate) struct BrokerAuthorityRefreshGuard {
    refreshes: std::sync::Arc<AtomicUsize>,
}

impl BrokerSessionRegistry {
    pub(crate) fn new(runtime_id: RuntimeId) -> Self {
        Self {
            runtime_id,
            sessions: std::sync::Arc::new(DashMap::new()),
            authority_verified: std::sync::Arc::new(AtomicBool::new(true)),
            authority_refreshes: std::sync::Arc::new(AtomicUsize::new(0)),
        }
    }

    pub(crate) fn begin_authority_refresh(&self) -> BrokerAuthorityRefreshGuard {
        self.authority_refreshes.fetch_add(1, Ordering::SeqCst);
        BrokerAuthorityRefreshGuard {
            refreshes: std::sync::Arc::clone(&self.authority_refreshes),
        }
    }

    pub(crate) fn confirm_authority(&self) {
        self.authority_verified.store(true, Ordering::SeqCst);
    }

    pub(crate) fn mark_authority_unverified(&self) {
        self.authority_verified.store(false, Ordering::SeqCst);
    }

    pub(crate) fn authority_available(&self) -> bool {
        self.authority_verified.load(Ordering::SeqCst)
            && self.authority_refreshes.load(Ordering::SeqCst) == 0
    }

    fn ensure_authority_available(&self) -> AppResult<()> {
        if self.authority_available() {
            Ok(())
        } else {
            Err(AppError::Blocked {
                reason: "workspace authority is being revalidated; retry shortly".into(),
            })
        }
    }

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

    pub(crate) fn authenticate(
        &self,
        authentication: &SessionAuthentication,
        peer: Option<&PeerProcessIdentity>,
    ) -> AppResult<AuthenticatedSession> {
        self.ensure_authority_available()?;
        if authentication.token().is_some() {
            return self.authenticate_bearer(authentication);
        }
        let terminal_session_id = TerminalSessionId::from(authentication.terminal_session_id);
        let Some(record) = self.sessions.get(&terminal_session_id) else {
            return Err(authentication_denied());
        };
        if record.metadata.runtime_id != self.runtime_id || record.metadata.expires_at <= Utc::now()
        {
            drop(record);
            self.sessions.remove(&terminal_session_id);
            return Err(authentication_denied());
        }
        let SessionAuthorization::AgentProcess(root) = &record.authorization else {
            return Err(authentication_denied());
        };
        let Some(peer) = peer.copied() else {
            return Err(authentication_denied());
        };
        if !process_is_descendant_or_same(peer, *root) {
            return Err(authentication_denied());
        }
        Ok(record.metadata.clone())
    }

    pub(crate) fn bind_agent_process(
        &self,
        authentication: &SessionAuthentication,
        peer: PeerProcessIdentity,
        registration: &AgentSessionRegisterArguments,
    ) -> AppResult<AuthenticatedSession> {
        self.ensure_authority_available()?;
        if !valid_agent_registration_paths(registration) {
            return Err(authentication_denied());
        }
        let terminal_session_id = TerminalSessionId::from(authentication.terminal_session_id);
        let mut record = self
            .sessions
            .get_mut(&terminal_session_id)
            .ok_or_else(authentication_denied)?;
        if record.metadata.runtime_id != self.runtime_id {
            return Err(authentication_denied());
        }
        if record.metadata.expires_at <= Utc::now() {
            drop(record);
            self.sessions.remove(&terminal_session_id);
            return Err(authentication_denied());
        }
        let supplied_token = authentication.token().ok_or_else(authentication_denied)?;
        let mut supplied = Zeroizing::new([0u8; SESSION_TOKEN_BYTES]);
        if hex::decode_to_slice(supplied_token, supplied.as_mut()).is_err() {
            return Err(authentication_denied());
        }
        let authorized = matches!(
            &record.authorization,
            SessionAuthorization::AgentBootstrap {
                token,
                registration: expected,
            } if expected.as_ref() == registration
                && bool::from(token.as_ref().ct_eq(supplied.as_ref()))
        );
        if !authorized {
            return Err(authentication_denied());
        }
        let authenticated = record.metadata.clone();
        // Replacing the bootstrap state drops and zeroizes the only Broker-held
        // bearer allocation while the map entry remains locked. A second
        // registration therefore cannot race or reuse the capability.
        record.authorization = SessionAuthorization::AgentProcess(peer);
        Ok(authenticated)
    }

    fn authenticate_bearer(
        &self,
        authentication: &SessionAuthentication,
    ) -> AppResult<AuthenticatedSession> {
        let terminal_session_id = TerminalSessionId::from(authentication.terminal_session_id);
        let Some(record) = self.sessions.get(&terminal_session_id) else {
            return Err(authentication_denied());
        };
        if record.metadata.runtime_id != self.runtime_id || record.metadata.expires_at <= Utc::now()
        {
            drop(record);
            self.sessions.remove(&terminal_session_id);
            return Err(authentication_denied());
        }
        let SessionAuthorization::Bearer(expected) = &record.authorization else {
            return Err(authentication_denied());
        };
        let token = authentication.token().ok_or_else(authentication_denied)?;
        let mut supplied = Zeroizing::new([0u8; SESSION_TOKEN_BYTES]);
        if hex::decode_to_slice(token, supplied.as_mut()).is_err()
            || !bool::from(expected.as_ref().ct_eq(supplied.as_ref()))
        {
            return Err(authentication_denied());
        }
        Ok(record.metadata.clone())
    }

    pub(crate) fn revoke(&self, terminal_session_id: TerminalSessionId) -> bool {
        self.sessions.remove(&terminal_session_id).is_some()
    }

    pub(crate) fn revoke_connection(&self, connection_id: ConnectionId) -> usize {
        let ids = self
            .sessions
            .iter()
            .filter_map(|entry| {
                let selected = entry.metadata.knowledge_scopes.iter().any(|scope| {
                    ConnectionId::from(scope.authority_connection_id) == connection_id
                        || scope.connections.iter().any(|connection| {
                            ConnectionId::from(connection.connection_id) == connection_id
                        })
                });
                (entry.metadata.connection_id == connection_id
                    || entry.metadata.write_connection_id == Some(connection_id)
                    || selected)
                    .then_some(*entry.key())
            })
            .collect::<Vec<_>>();
        let count = ids.len();
        for id in ids {
            self.sessions.remove(&id);
        }
        count
    }

    pub(crate) fn revoke_all(&self) {
        self.sessions.clear();
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.sessions.len()
    }
}

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
            "the Agent write target is outside its selected Project resource set".into(),
        ));
    }
    Ok(())
}

impl Drop for BrokerAuthorityRefreshGuard {
    fn drop(&mut self) {
        let previous = self.refreshes.fetch_sub(1, Ordering::SeqCst);
        debug_assert!(previous > 0, "Broker authority refresh guard underflowed");
    }
}

fn valid_agent_registration_paths(registration: &AgentSessionRegisterArguments) -> bool {
    registration.validate()
        && [
            registration.runtime_executable.as_str(),
            registration.runtime_resolved_executable.as_str(),
            registration.adapter_entrypoint.as_str(),
            registration.provider_cli_executable.as_str(),
            registration.provider_cli_resolved_executable.as_str(),
        ]
        .into_iter()
        .all(|path| std::path::Path::new(path).is_absolute())
}

fn authentication_denied() -> AppError {
    AppError::Blocked {
        reason: "terminal session authentication was denied".into(),
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use std::collections::HashMap;

    use crate::features::knowledge::domain::KnowledgeSessionConnection;
    use crate::kernel::access::WorkspaceKind;
    use crate::kernel::access::{AccountScope, ActiveResourceScope, CatalogCachePolicy};
    use crate::model::{
        ConnectionProfile, Engine, Provider, WorkspaceConnectionAccess, WorkspaceCredentialMode,
    };

    use super::*;

    fn registration(plugin_id: dopedb_protocol::AcpPluginId) -> AgentSessionRegisterArguments {
        let root = if cfg!(windows) {
            r"C:\DopeDB"
        } else {
            "/opt/dopedb"
        };
        AgentSessionRegisterArguments {
            plugin_id,
            adapter_bundle_version: "1.0.0".into(),
            runtime_executable: format!("{root}/node"),
            runtime_resolved_executable: format!("{root}/node"),
            runtime_sha256: "ab".repeat(32),
            adapter_entrypoint: format!("{root}/plugins/adapter.js"),
            adapter_entrypoint_sha256: "cd".repeat(32),
            provider_cli_executable: format!("{root}/provider-cli"),
            provider_cli_resolved_executable: format!("{root}/provider-cli"),
            provider_cli_sha256: "ef".repeat(32),
        }
    }

    fn pin(connection_id: Uuid) -> PinnedConnection {
        PinnedConnection {
            scope: ActiveResourceScope {
                workspace_id: Uuid::nil(),
                workspace_kind: WorkspaceKind::Personal,
                selected_account_id: None,
                account_scope: AccountScope::Personal,
                generation: 7,
            },
            connection_id,
            connection_revision: 11,
            binding_revision: 3,
            binding_updated_at: Utc::now().to_rfc3339(),
            profile: ConnectionProfile {
                id: connection_id,
                name: "fixture".into(),
                engine: Engine::Sqlite,
                provider: Provider::Auto,
                driver_id: None,
                host: String::new(),
                port: 0,
                database: ":memory:".into(),
                username: String::new(),
                sslmode: "disable".into(),
                extra_params: HashMap::new(),
                readonly_default: true,
                allow_writes: false,
                secret_ref: None,
                env: Some("dev".into()),
                schema_group: None,
                workspace_access: WorkspaceConnectionAccess::Local,
                credential_mode: WorkspaceCredentialMode::Local,
                provider_target: None,
                schema_access_available: false,
            },
            requires_remote_rbac: false,
            catalog_cache_policy: CatalogCachePolicy::Persistent,
        }
    }

    #[test]
    fn capability_is_256_bit_redacted_and_memory_only() {
        let runtime_id = RuntimeId::from(Uuid::new_v4());
        let registry = BrokerSessionRegistry::new(runtime_id);
        let session_id = TerminalSessionId::from(Uuid::new_v4());
        let issued = registry
            .issue(
                session_id,
                &pin(Uuid::new_v4()),
                [BrokerCapability::QueryPlan],
                Duration::from_secs(60),
            )
            .unwrap();
        assert_eq!(issued.token().len(), SESSION_TOKEN_BYTES * 2);
        assert!(hex::decode(issued.token()).is_ok());
        let debug = format!("{issued:?}");
        assert!(debug.contains("<redacted>"));
        assert!(!debug.contains(issued.token()));
        assert_eq!(issued.terminal_session_id, session_id);
        assert_eq!(registry.len(), 1);
    }

    #[test]
    fn authentication_is_exact_scope_capability_and_revocation_bound() {
        let runtime_id =
            RuntimeId::from(Uuid::from_str("018f0000-1111-7222-8333-444455556666").unwrap());
        let connection_id = ConnectionId::from(Uuid::new_v4());
        let terminal_session_id = TerminalSessionId::from(Uuid::new_v4());
        let registry = BrokerSessionRegistry::new(runtime_id);
        let issued = registry
            .issue(
                terminal_session_id,
                &pin(connection_id.into()),
                [BrokerCapability::QueryPlan],
                Duration::from_secs(60),
            )
            .unwrap();
        let authentication = SessionAuthentication::new(
            issued.terminal_session_id.into(),
            issued.token().to_owned(),
        );
        let authenticated = registry.authenticate(&authentication, None).unwrap();
        assert_eq!(authenticated.terminal_session_id, terminal_session_id);
        assert_eq!(authenticated.runtime_id, runtime_id);
        assert_eq!(authenticated.connection_id, connection_id);
        assert_eq!(authenticated.connection_revision, 11);
        assert_eq!(authenticated.scope_generation, 7);
        assert_eq!(authenticated.knowledge_account_scope.as_str(), "personal");
        assert!(authenticated.require(BrokerCapability::QueryPlan).is_ok());
        assert!(authenticated.require(BrokerCapability::SqlPropose).is_err());

        // A routine hosted-authority refresh pauses new Broker work without
        // deleting the process capability. Confirming the unchanged authority
        // resumes the same session only after the in-flight guard is released.
        let refresh = registry.begin_authority_refresh();
        assert!(registry.authenticate(&authentication, None).is_err());
        assert!(registry
            .issue(
                TerminalSessionId::from(Uuid::new_v4()),
                &pin(connection_id.into()),
                [BrokerCapability::ConnectionRead],
                Duration::from_secs(60),
            )
            .is_err());
        registry.confirm_authority();
        assert!(registry.authenticate(&authentication, None).is_err());
        drop(refresh);
        assert!(registry.authenticate(&authentication, None).is_ok());

        // A failed Team-authority verification stays fail closed across the end
        // of its request, then a later proven refresh restores the same capability.
        let failed_refresh = registry.begin_authority_refresh();
        registry.mark_authority_unverified();
        drop(failed_refresh);
        assert!(registry.authenticate(&authentication, None).is_err());
        let recovered_refresh = registry.begin_authority_refresh();
        registry.confirm_authority();
        drop(recovered_refresh);
        assert!(registry.authenticate(&authentication, None).is_ok());

        let wrong = SessionAuthentication::new(issued.terminal_session_id.into(), "00".repeat(32));
        assert!(registry.authenticate(&wrong, None).is_err());

        let root = super::super::peer::current_process_identity_for_test().unwrap();
        let descriptor = registration(dopedb_protocol::AcpPluginId::Claude);
        assert!(registry
            .bind_agent_process(&authentication, root, &descriptor)
            .is_err());

        let agent_session_id = TerminalSessionId::from(Uuid::new_v4());
        let agent = registry
            .issue_agent(
                agent_session_id,
                &pin(connection_id.into()),
                [BrokerCapability::QueryPlan],
                Duration::from_secs(60),
                descriptor.clone(),
            )
            .unwrap();
        let agent_authentication =
            SessionAuthentication::new(agent.terminal_session_id.into(), agent.token().to_owned());
        // Bootstrap capabilities are command-specific and cannot authorize a
        // normal Broker command before registration.
        assert!(registry.authenticate(&agent_authentication, None).is_err());
        let mut wrong_descriptor = descriptor.clone();
        wrong_descriptor.plugin_id = dopedb_protocol::AcpPluginId::Codex;
        assert!(registry
            .bind_agent_process(&agent_authentication, root, &wrong_descriptor)
            .is_err());
        registry
            .bind_agent_process(&agent_authentication, root, &descriptor)
            .unwrap();
        // Registration consumes the bearer atomically; neither ordinary use
        // nor a second registration may reuse it.
        assert!(registry.authenticate(&agent_authentication, None).is_err());
        assert!(registry
            .bind_agent_process(&agent_authentication, root, &descriptor)
            .is_err());

        let process_bound = SessionAuthentication::process_bound(agent_session_id.into());
        assert!(registry.authenticate(&process_bound, Some(&root)).is_ok());
        let reused_pid = super::super::peer::PeerProcessIdentity::for_test(
            root.pid(),
            root.started_at().saturating_add(1),
        );
        assert!(registry
            .authenticate(&process_bound, Some(&reused_pid))
            .is_err());
        let unrelated =
            super::super::peer::PeerProcessIdentity::for_test(root.pid().saturating_add(1), 0);
        assert!(registry
            .authenticate(&process_bound, Some(&unrelated))
            .is_err());
        assert!(registry.revoke(agent_session_id));
        assert!(registry.authenticate(&process_bound, Some(&root)).is_err());
        assert!(registry.revoke(terminal_session_id));
        assert!(registry.authenticate(&authentication, None).is_err());

        let mut signed_in_personal = pin(connection_id.into());
        signed_in_personal.scope.selected_account_id = Some("account-123".into());
        let signed_in_session_id = TerminalSessionId::from(Uuid::new_v4());
        let signed_in = registry
            .issue(
                signed_in_session_id,
                &signed_in_personal,
                [BrokerCapability::KnowledgeRead],
                Duration::from_secs(60),
            )
            .unwrap();
        let signed_in_authentication = SessionAuthentication::new(
            signed_in.terminal_session_id.into(),
            signed_in.token().to_owned(),
        );
        let signed_in_authenticated = registry
            .authenticate(&signed_in_authentication, None)
            .unwrap();
        assert_eq!(signed_in_authenticated.account_scope.as_str(), "personal");
        assert_eq!(
            signed_in_authenticated.knowledge_account_scope.as_str(),
            "account-123"
        );
    }

    #[test]
    fn connection_revocation_removes_only_matching_sessions() {
        let registry = BrokerSessionRegistry::new(RuntimeId::from(Uuid::new_v4()));
        let first_connection = ConnectionId::from(Uuid::new_v4());
        let second_connection = ConnectionId::from(Uuid::new_v4());
        let selected_connection = ConnectionId::from(Uuid::new_v4());
        registry
            .issue(
                TerminalSessionId::from(Uuid::new_v4()),
                &pin(first_connection.into()),
                [BrokerCapability::ConnectionRead],
                Duration::from_secs(60),
            )
            .unwrap();
        registry
            .issue(
                TerminalSessionId::from(Uuid::new_v4()),
                &pin(second_connection.into()),
                [BrokerCapability::ConnectionRead],
                Duration::from_secs(60),
            )
            .unwrap();
        registry
            .issue_agent_with_knowledge(
                TerminalSessionId::from(Uuid::new_v4()),
                &pin(second_connection.into()),
                [BrokerCapability::ConnectionRead],
                Duration::from_secs(60),
                registration(dopedb_protocol::AcpPluginId::Codex),
                AgentKnowledgeAuthorization {
                    scopes: vec![KnowledgeSessionScope {
                        project_id: Uuid::new_v4(),
                        knowledge_grant_id: None,
                        project_environment_id: Uuid::new_v4(),
                        environment_revision: 1,
                        authority_connection_id: Uuid::from(second_connection),
                        authority_connection_revision: 11,
                        sources: Vec::new(),
                        graph_revision_ids: Vec::new(),
                        connections: vec![KnowledgeSessionConnection {
                            connection_id: Uuid::from(selected_connection),
                            connection_revision: 3,
                            remote_connection_id: None,
                            connection_content_revision: 3,
                            role: "secondary".into(),
                            alias: "Secondary".into(),
                        }],
                    }],
                    write_connection_id: None,
                },
            )
            .unwrap();
        assert_eq!(registry.revoke_connection(first_connection), 1);
        assert_eq!(registry.len(), 2);
        assert_eq!(registry.revoke_connection(selected_connection), 1);
        assert_eq!(registry.len(), 1);
    }

    #[test]
    fn expired_capability_is_rejected_and_eagerly_removed() {
        let registry = BrokerSessionRegistry::new(RuntimeId::from(Uuid::new_v4()));
        let issued = registry
            .issue(
                TerminalSessionId::from(Uuid::new_v4()),
                &pin(Uuid::new_v4()),
                [BrokerCapability::ConnectionRead],
                Duration::from_millis(1),
            )
            .unwrap();
        let authentication = SessionAuthentication::new(
            issued.terminal_session_id.into(),
            issued.token().to_owned(),
        );
        std::thread::sleep(Duration::from_millis(5));
        assert!(registry.authenticate(&authentication, None).is_err());
        assert_eq!(registry.len(), 0);
    }
}
