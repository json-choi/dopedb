//! Local Broker runtime shared by the Desktop app and the `dopedb` CLI.

mod discovery;
mod dispatch;
mod external_agent_requests;
mod peer;
mod server;
mod session;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::kernel::identity::RuntimeId;
use crate::kernel::sync::lock_unpoisoned;
use crate::services::ApplicationServices;
use crate::skills::SkillManager;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

pub(crate) use external_agent_requests::{
    ExternalAgentRequestDecision, ExternalAgentRequestKind, ExternalAgentRequestRegistry,
    ExternalAgentRequestSummary,
};
#[cfg(windows)]
pub(crate) use peer::restrict_path_to_current_user;
pub(crate) use session::{
    AgentKnowledgeAuthorization, BrokerAuthorityRefreshGuard, BrokerCapability,
    BrokerSessionRegistry, ExternalAgentProcessAuthorization,
};

#[derive(Debug, Clone, Default)]
pub(crate) struct BrokerRuntimeStatus {
    pub(crate) running: bool,
    pub(crate) endpoint: Option<String>,
    pub(crate) runtime_file: Option<PathBuf>,
    pub(crate) last_error_kind: Option<&'static str>,
}

struct BrokerRuntimeInner {
    runtime_id: RuntimeId,
    sessions: BrokerSessionRegistry,
    external_agent_requests: ExternalAgentRequestRegistry,
    shutdown: CancellationToken,
    status: Mutex<BrokerRuntimeStatus>,
    spawned: AtomicBool,
    stopped: AtomicBool,
    stopped_notify: Notify,
}

#[derive(Clone)]
pub(crate) struct BrokerRuntime {
    inner: Arc<BrokerRuntimeInner>,
}

impl BrokerRuntime {
    pub(crate) fn new(runtime_id: RuntimeId) -> Self {
        Self {
            inner: Arc::new(BrokerRuntimeInner {
                runtime_id,
                sessions: BrokerSessionRegistry::new(runtime_id),
                external_agent_requests: ExternalAgentRequestRegistry::default(),
                shutdown: CancellationToken::new(),
                status: Mutex::new(BrokerRuntimeStatus::default()),
                spawned: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
                stopped_notify: Notify::new(),
            }),
        }
    }

    pub(crate) fn runtime_id(&self) -> RuntimeId {
        self.inner.runtime_id
    }

    pub(crate) fn sessions(&self) -> &BrokerSessionRegistry {
        &self.inner.sessions
    }

    pub(crate) fn external_agent_requests(&self) -> &ExternalAgentRequestRegistry {
        &self.inner.external_agent_requests
    }

    pub(crate) fn begin_authority_refresh(&self) -> BrokerAuthorityRefreshGuard {
        self.inner.sessions.begin_authority_refresh()
    }

    pub(crate) fn confirm_authority(&self) {
        self.inner.sessions.confirm_authority();
    }

    pub(crate) fn mark_authority_unverified(&self) {
        self.inner.sessions.mark_authority_unverified();
    }

    pub(crate) fn runtime_file(&self) -> Option<PathBuf> {
        lock_unpoisoned(&self.inner.status).runtime_file.clone()
    }

    pub(crate) fn prepare_start(&self) -> bool {
        self.inner
            .spawned
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub(crate) fn mark_running(&self, endpoint: String, runtime_file: PathBuf) {
        let mut status = lock_unpoisoned(&self.inner.status);
        status.running = true;
        status.endpoint = Some(endpoint);
        status.runtime_file = Some(runtime_file);
        status.last_error_kind = None;
    }

    pub(crate) fn finish(&self, error: Option<&crate::AppError>) {
        {
            let mut status = lock_unpoisoned(&self.inner.status);
            status.running = false;
            status.endpoint = None;
            status.last_error_kind = error.map(crate::AppError::kind);
        }
        self.inner.stopped.store(true, Ordering::SeqCst);
        self.inner.stopped_notify.notify_waiters();
    }

    pub(crate) fn shutdown_token(&self) -> &CancellationToken {
        &self.inner.shutdown
    }

    pub(crate) fn shutdown(&self) {
        self.inner.external_agent_requests.reject_all();
        self.inner.sessions.revoke_all();
        self.inner.shutdown.cancel();
    }

    /// Revoke every exact-grant capability without stopping the listener.
    ///
    /// Workspace/account authority changes invalidate all issued capabilities,
    /// while the process-local Broker itself remains available to issue fresh
    /// capabilities after the new scope is selected.
    pub(crate) fn revoke_all_sessions(&self) {
        self.inner.sessions.revoke_all();
    }

    pub(crate) async fn shutdown_and_wait(&self, timeout: Duration) {
        self.shutdown();
        if !self.inner.spawned.load(Ordering::SeqCst) || self.inner.stopped.load(Ordering::SeqCst) {
            return;
        }
        let _ = tokio::time::timeout(timeout, self.inner.stopped_notify.notified()).await;
    }
}

pub(crate) fn start(
    runtime: BrokerRuntime,
    services: ApplicationServices,
    skills: Option<SkillManager>,
    app_handle: tauri::AppHandle,
) {
    if !runtime.prepare_start() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(error) = server::serve(runtime.clone(), services, skills, app_handle).await {
            tracing::error!(error_kind = error.kind(), "local broker stopped");
        }
    });
}

#[cfg(test)]
pub(crate) fn assert_dispatch_contract() {
    dispatch::assert_dispatch_contract();
}
