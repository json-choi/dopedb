//! Official ACP client runtime for the in-app Agent surface.
//!
//! Authentication stays entirely with the locally installed Agent tooling. This
//! module never opens its auth files, reads a token, refreshes credentials, or
//! offers a login flow.

#[path = "acp_admission.rs"]
mod admission;
mod authority;
mod configuration;
mod desktop;
mod event_sink;
mod knowledge_scope;
mod persistence;
mod process;
mod prompt;
#[path = "acp_runtime.rs"]
mod runtime_api;
#[path = "acp_session.rs"]
mod session;
#[path = "acp_session_driver.rs"]
mod session_driver;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, Implementation, InitializeRequest, LoadSessionRequest,
    NewSessionRequest, PermissionOptionKind, PromptRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionConfigOption, SessionId, SessionNotification, SessionUpdate,
    SetSessionConfigOptionRequest,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, ConnectionTo};
use chrono::Utc;
use dashmap::DashMap;
use tokio::sync::{oneshot, Notify};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::broker::{AgentKnowledgeAuthorization, BrokerCapability, BrokerRuntime};
use crate::error::{AppError, AppResult};
use crate::features::knowledge::KnowledgeFeature;
use crate::kernel::access::ActiveResourceScope;
use crate::kernel::identity::{AcpSessionId, ConnectionId, TerminalSessionId};
use crate::kernel::sync::lock_unpoisoned;
use crate::store::Store;

#[cfg(test)]
pub(crate) use configuration::assert_session_configuration_contract;
pub(crate) use desktop::DesktopAcpRuntimePorts;
use event_sink::SharedAcpSessionEventSink;
pub(crate) use knowledge_scope::narrow_resource_scope;
use knowledge_scope::{AcpKnowledgeScopePort, FeatureKnowledgeScopePort};
use persistence::{
    AcpSessionPersistencePort, PersistenceCommand, PersistenceRequest, PersistenceTracker,
    StoreAcpSessionPersistence,
};
use process::AcpProcess;
#[cfg(test)]
pub(crate) use prompt::assert_editor_context_scope_contract;
use session_driver::*;

use super::domain::{
    agent_error, AcpPermissionOption, AcpPromptContext, AcpSessionChanged, AcpSessionEvent,
    AcpSessionEventPayload, AcpSessionFocus, AcpSessionLifecycle, AcpSessionSummary, AgentProvider,
    AgentResourceScopeSelection,
};

const ACP_CAPABILITY_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const ACP_START_TIMEOUT: Duration = Duration::from_secs(120);
const ACP_START_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_ACTIVE_SESSIONS: usize = 8;
/// A prepared session nobody has prompted is closed after this idle time so a
/// background preparation can never pin an adapter process indefinitely.
const UNPROMPTED_SESSION_IDLE_TTL: Duration = Duration::from_secs(10 * 60);
const IDLE_SESSION_SWEEP_INTERVAL: Duration = Duration::from_secs(60);
const MAX_REPLAY_EVENTS: usize = 512;
const MAX_REPLAY_BYTES: usize = 4 * 1024 * 1024;
const MAX_EVENT_BYTES: usize = 512 * 1024;
const MAX_PERMISSION_OPTIONS: usize = 16;
const MAX_PERMISSION_OPTION_BYTES: usize = 1024;
const MAX_CONFIG_OPTIONS: usize = 64;
const MAX_CONFIG_OPTION_ID_BYTES: usize = 256;
const MAX_CONFIG_OPTION_VALUE_BYTES: usize = 1024;
const AGENT_PROCESS_CLOSED: &str = "agent_process_closed";
const AGENT_PROCESS_UNAVAILABLE: &str = "agent_process_unavailable";
/// Stable codes the Desktop maps to localized copy instead of English text.
const AGENT_START_CANCELLED: &str = "agent_start_cancelled";
const AGENT_SESSION_LIMIT: &str = "agent_session_limit";
const AGENT_SCOPE_CHANGED: &str = "agent_scope_changed";
/// The pinned resources could not be checked right now (network, timeout, a
/// hosted authority asking to retry); retrying the same resume can succeed.
const AGENT_SCOPE_UNVERIFIED: &str = "agent_scope_unverified";
/// Untitled-session sentinel; the Desktop maps it to localized copy.
const UNTITLED_SESSION_TITLE: &str = "New Agent session";

#[derive(Clone)]
pub(crate) struct AcpRuntime {
    sessions_persistence: Arc<dyn AcpSessionPersistencePort>,
    knowledge_scope: Arc<dyn AcpKnowledgeScopePort>,
    broker: BrokerRuntime,
    sessions: Arc<DashMap<AcpSessionId, Arc<AcpSession>>>,
    persistence: Arc<PersistenceTracker>,
    idle_sweeper_started: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
pub(crate) struct AcpResourceRequest {
    pub(crate) resource_scopes: Vec<AgentResourceScopeSelection>,
    pub(crate) write_connection_id: Option<Uuid>,
}

struct AcpSession {
    id: AcpSessionId,
    connection_id: ConnectionId,
    broker_session_id: TerminalSessionId,
    storage_scope: ActiveResourceScope,
    persistence: Arc<PersistenceTracker>,
    summary: Mutex<AcpSessionSummary>,
    events: Mutex<ReplayBuffer>,
    persistence_queue: tokio::sync::mpsc::UnboundedSender<PersistenceCommand>,
    push_order: Mutex<()>,
    accepting_events: AtomicBool,
    /// True only while `session/load` streams provider history that the local
    /// bounded transcript already shows.
    replaying_history: AtomicBool,
    next_sequence: AtomicU64,
    busy: AtomicBool,
    /// Set by the first accepted prompt; untouched prepared sessions stay
    /// eligible for idle closing and for replacement at the session cap.
    prompted: AtomicBool,
    /// Startup can be cancelled by the person (status bar or chat) before the
    /// adapter finishes initializing; the flag distinguishes it from a timeout.
    startup_cancel: CancellationToken,
    startup_cancelled_by_user: AtomicBool,
    command: Mutex<Option<tokio::sync::mpsc::UnboundedSender<SessionCommand>>>,
    permissions: Mutex<HashMap<String, PendingPermission>>,
    config_options: Mutex<HashMap<String, HashSet<String>>>,
    terminated: AtomicBool,
    termination: Notify,
    event_sink: SharedAcpSessionEventSink,
}

struct PendingPermission {
    allowed: HashSet<String>,
    response: oneshot::Sender<Option<String>>,
}

struct ReplayBuffer {
    events: VecDeque<ReplayEvent>,
    bytes: usize,
}

struct ReplayEvent {
    event: AcpSessionEvent,
    bytes: usize,
}

enum SessionCommand {
    Prompt {
        text: String,
        context: Box<AcpPromptContext>,
    },
    Cancel,
    Close,
    SetConfigOption {
        config_id: String,
        value: String,
        response: oneshot::Sender<AppResult<()>>,
    },
}

fn detached_session_projection(mut summary: AcpSessionSummary) -> AcpSessionSummary {
    if matches!(
        summary.lifecycle,
        AcpSessionLifecycle::Starting
            | AcpSessionLifecycle::Ready
            | AcpSessionLifecycle::Running
            | AcpSessionLifecycle::WaitingPermission
    ) {
        summary.lifecycle = AcpSessionLifecycle::Failed;
        summary.error = Some(AGENT_PROCESS_UNAVAILABLE.into());
    }
    summary
}

fn detached_focus_projection(mut focus: AcpSessionFocus) -> AcpSessionFocus {
    focus.session = detached_session_projection(focus.session);
    focus.broker_session_id = None;
    focus
}
