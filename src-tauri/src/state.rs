//! Shared application state managed by Tauri and injected into commands.

use std::sync::Arc;

use crate::broker::BrokerRuntime;
use crate::connection::ConnectionManager;
use crate::error::AppResult;
use crate::features::agents::acp::AcpRuntime;
use crate::features::agents::runtime::AcpPluginManager;
use crate::features::knowledge::runtime::KnowledgeWatchRuntime;
use crate::features::knowledge::{
    KeychainKnowledgeSourceRoot, KnowledgeSourceSynchronizer, LocalFolderAdapter,
    TauriKnowledgeSourceEventSink,
};
use crate::features::providers;
use crate::features::terminals::{self, TerminalsFeature};
use crate::operations::{LocalApprovalAuthority, OperationRuntime};
use crate::services::ApplicationServices;
use crate::skills::SkillManager;
use crate::startup::{PostPaintRecoveryGate, StartupTrace};
use crate::store::Store;

pub struct AppState {
    /// Transport-neutral application services shared by Tauri and the local broker.
    pub services: ApplicationServices,
    /// Process-local owner retained by the composition root so child transports and
    /// pools can be explicitly stopped before the async runtime exits.
    pub(crate) connections: ConnectionManager,
    /// Owner-local CLI broker. Session capabilities live only inside this runtime.
    pub(crate) broker: BrokerRuntime,
    /// Offline Skill bundle inventory and atomic per-user installer.
    pub(crate) skills: SkillManager,
    /// Connection-pinned Shell PTYs and their process-tree lifecycle.
    pub(crate) terminals: TerminalsFeature,
    /// Official ACP client sessions. Authentication remains in local agent tooling.
    pub(crate) agents_acp: AcpRuntime,
    /// Signed first-party ACP adapter plugins and the bundled Node runtime.
    pub(crate) agent_plugins: AcpPluginManager,
    /// Desktop-only approval capability. CLI and Terminal adapters are composed
    /// without this authority and therefore cannot obtain it.
    pub(crate) local_operation_approval: LocalApprovalAuthority,
    /// Process-local capability registry for Local Folder Knowledge sources.
    /// Absolute roots are restored from the OS credential store and never cross IPC.
    pub(crate) local_knowledge_sources: LocalFolderAdapter,
    pub(crate) knowledge_watches: KnowledgeWatchRuntime,
    pub(crate) startup_trace: StartupTrace,
    store: Store,
    post_paint_recovery: PostPaintRecoveryGate,
}

impl AppState {
    pub async fn new(startup_trace: StartupTrace) -> AppResult<Self> {
        let started = startup_trace.stage_started();
        let store = Store::open().await;
        startup_trace.finish("store_ready", "critical", started, store.is_ok());
        let store = store?;
        let (operation, local_operation_approval) = OperationRuntime::new(&store);
        let provider_composition = providers::prepare(store.clone(), operation.clone());
        let connections = ConnectionManager::with_authorities(
            store.clone(),
            Arc::new(crate::features::workspaces::adapters::HostedWorkspaceControlPlane),
            provider_composition.local_connection_port(),
        );
        let providers = provider_composition
            .finish(Arc::new(connections.clone()), Arc::new(connections.clone()));
        let broker = BrokerRuntime::new(operation.runtime_id().into());
        let terminals = terminals::compose(store.clone(), broker.clone());
        let agent_plugins = AcpPluginManager::new()?;
        let services = ApplicationServices::with_providers(
            store.clone(),
            connections.clone(),
            operation,
            providers,
        );
        let agents_acp = AcpRuntime::new(store.clone(), services.knowledge.clone(), broker.clone());
        let skills = SkillManager::new()?;
        let local_knowledge_sources = LocalFolderAdapter::new();
        let knowledge_watches = KnowledgeWatchRuntime::new(KnowledgeSourceSynchronizer::new(
            services.knowledge.clone(),
            local_knowledge_sources.clone(),
            Arc::new(KeychainKnowledgeSourceRoot),
        ));
        let started = startup_trace.stage_started();
        let recovery = services.operation.recover_previous_runtimes().await;
        startup_trace.finish("operation_recovery", "critical", started, recovery.is_ok());
        let recovery = recovery?;
        let started = startup_trace.stage_started();
        let provider_recovery = services
            .providers
            .recover_provisioning(&recovery.provisioning_checkpoint_validation_required)
            .await;
        startup_trace.finish(
            "provider_recovery",
            "critical",
            started,
            provider_recovery.is_ok(),
        );
        provider_recovery?;
        Ok(Self {
            services,
            connections,
            broker,
            skills,
            terminals,
            agents_acp,
            agent_plugins,
            local_operation_approval,
            local_knowledge_sources,
            knowledge_watches,
            startup_trace,
            store,
            post_paint_recovery: PostPaintRecoveryGate::new(),
        })
    }

    pub(crate) fn start_post_paint_recovery(&self, app: tauri::AppHandle) {
        if !self.post_paint_recovery.claim_start() {
            return;
        }
        let store = self.store.clone();
        let jobs = self.services.job.clone();
        let trace = self.startup_trace.clone();
        let gate = self.post_paint_recovery.clone();
        let broker = self.broker.clone();
        let services = self.services.clone();
        let skills = self.skills.clone();
        let agent_plugins = self.agent_plugins.clone();
        let knowledge_watches = self.knowledge_watches.clone();
        tauri::async_runtime::spawn(async move {
            let started = trace.stage_started();
            let acp = store.recover_interrupted_agent_acp_sessions().await;
            trace.finish("agent_session_recovery", "post_paint", started, acp.is_ok());
            if let Err(error) = &acp {
                tracing::error!(%error, "post-paint Agent session recovery failed");
            }

            let started = trace.stage_started();
            let jobs = jobs.recover_interrupted().await;
            trace.finish("job_recovery", "post_paint", started, jobs.is_ok());
            if let Err(error) = &jobs {
                tracing::error!(%error, "post-paint Job recovery failed");
            }
            let succeeded = acp.is_ok() && jobs.is_ok();
            if succeeded {
                let started = trace.stage_started();
                crate::broker::start(broker, services, Some(skills), app.clone());
                trace.finish("broker_start", "post_paint", started, true);
                let update_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    agent_plugins.check_installed_updates(&update_app).await;
                });
                let watch_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let events = Arc::new(TauriKnowledgeSourceEventSink::new(watch_app));
                    if let Err(error) = knowledge_watches.start_workspace(events).await {
                        tracing::warn!(
                            error_kind = error.kind(),
                            "Project Knowledge watcher recovery deferred"
                        );
                    }
                });
            }
            gate.finish(succeeded);
        });
    }

    pub(crate) async fn wait_for_post_paint_recovery(&self) -> AppResult<()> {
        self.post_paint_recovery.wait().await
    }

    #[cfg(feature = "packaged-benchmark")]
    pub(crate) fn packaged_benchmark_store(&self) -> &Store {
        &self.store
    }
}
