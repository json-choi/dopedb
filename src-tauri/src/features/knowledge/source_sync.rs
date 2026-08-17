//! Local/hosted Knowledge source synchronization use case shared by transport and watchers.

use std::path::PathBuf;
use std::sync::Arc;

use dashmap::DashMap;
use dopedb_protocol::{GraphBuildArtifactV1, KnowledgeSourceProvider};
use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::access::{ActiveResourceScope, WorkspaceKind};
use crate::kernel::identity::{AccountId, WorkspaceId};

use super::adapters::local::{LocalFolderAdapter, LocalFolderWatch};
use super::domain::{
    sync_cancelled, validate_graph_publish, Project, ProjectDefinition, ProjectEnvironment,
    SourceHealthState, SourceSnapshot, SyncCancellation,
};
use super::extractor::build_graph;
use super::ports::{LocalKnowledgeSourcePort, RemoteKnowledgeEnvironment, RemoteKnowledgeProject};
use super::KnowledgeFeature;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeSyncReceipt {
    pub(crate) source_id: Uuid,
    pub(crate) state: SourceHealthState,
    pub(crate) graph_revision_id: Option<Uuid>,
    pub(crate) parsed_files: u64,
    pub(crate) skipped_files: u64,
    pub(crate) changed_files: Vec<String>,
    pub(crate) node_count: usize,
    pub(crate) edge_count: usize,
}

/// What a cancel request actually reached. `cancelled` is false when nothing was
/// in flight for the source, so the screen never claims it stopped work it did
/// not. `verified` is false when this device could not ask the authority that
/// owns the work at all, so `cancelled: false` is never read as the stronger
/// claim that nothing was running.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KnowledgeSyncCancellation {
    pub(crate) source_id: Uuid,
    pub(crate) cancelled: bool,
    pub(crate) verified: bool,
}

pub(crate) trait KnowledgeSourceRootPort: Send + Sync {
    fn fetch_root(&self, source_id: Uuid) -> AppResult<Option<PathBuf>>;
}

/// The local sync runs of each source. `gates` makes a source an occupancy
/// claim rather than a bulletin board: a second local sync for the same source
/// waits for the run in flight instead of racing it, so two runs can never both
/// build and publish an index while only the last-registered one hears a stop.
/// `signals` then holds exactly one signal — the running one's — so a stop that
/// reached the previous run can never be inherited by the next.
#[derive(Clone, Default)]
struct SyncRunRegistry {
    signals: Arc<DashMap<Uuid, SyncCancellation>>,
    /// One gate per source. Gates are kept for the process lifetime because the
    /// set of sources is bounded and removing a gate a waiting run already holds
    /// would let a third run claim the source alongside it.
    gates: Arc<DashMap<Uuid, Arc<tokio::sync::Mutex<()>>>>,
}

impl SyncRunRegistry {
    /// Wait for the run in flight for `source_id`, then claim the source for a
    /// new logical run with a signal of its own.
    async fn begin(&self, source_id: Uuid) -> SyncRun {
        // Cloned out of the map before awaiting so no map guard is ever held
        // across a suspension point.
        let gate = self
            .gates
            .entry(source_id)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone();
        let permit = gate.lock_owned().await;
        let cancellation = SyncCancellation::default();
        self.signals.insert(source_id, cancellation.clone());
        SyncRun {
            registry: self.clone(),
            source_id,
            cancellation,
            stoppable: true,
            _permit: permit,
        }
    }

    /// Stop the run in flight for `source_id`. `false` when there is none, so the
    /// receipt never claims local work was stopped.
    fn cancel(&self, source_id: Uuid) -> bool {
        match self.signals.get(&source_id) {
            Some(run) => {
                run.cancel();
                true
            }
            None => false,
        }
    }
}

/// Holds the source for one logical run: the stop signal while the run can still
/// observe it, and the occupancy permit until the run returns.
struct SyncRun {
    registry: SyncRunRegistry,
    source_id: Uuid,
    cancellation: SyncCancellation,
    stoppable: bool,
    _permit: tokio::sync::OwnedMutexGuard<()>,
}

impl SyncRun {
    fn cancellation(&self) -> &SyncCancellation {
        &self.cancellation
    }

    /// Leave the window in which a stop can still reach this run, so a Stop that
    /// arrives from here on reports honestly that it reached no stoppable work.
    /// The source stays claimed until the run returns, so the uninterruptible
    /// publish that follows still runs alone.
    fn close_stop_window(&mut self) {
        if !self.stoppable {
            return;
        }
        self.stoppable = false;
        // Only the run that still owns the claim releases it; a slow earlier run
        // must not remove the signal a newer run already registered.
        self.registry
            .signals
            .remove_if(&self.source_id, |_, current| {
                current.same_run(&self.cancellation)
            });
    }
}

impl Drop for SyncRun {
    fn drop(&mut self) {
        self.close_stop_window();
    }
}

#[derive(Clone)]
pub(crate) struct KnowledgeSourceSynchronizer {
    knowledge: KnowledgeFeature,
    local_sources: LocalFolderAdapter,
    roots: Arc<dyn KnowledgeSourceRootPort>,
    runs: SyncRunRegistry,
}

impl KnowledgeSourceSynchronizer {
    pub(crate) fn new(
        knowledge: KnowledgeFeature,
        local_sources: LocalFolderAdapter,
        roots: Arc<dyn KnowledgeSourceRootPort>,
    ) -> Self {
        Self {
            knowledge,
            local_sources,
            roots,
            runs: SyncRunRegistry::default(),
        }
    }

    pub(crate) async fn local_source_ids(&self) -> AppResult<Vec<Uuid>> {
        let scope = self.knowledge.active_resource_scope().await?;
        Ok(self
            .knowledge
            .scopes(scope.workspace_id)
            .await?
            .into_iter()
            .filter(|source| source.binding.provider == KnowledgeSourceProvider::LocalFolder)
            .map(|source| source.binding.source_id)
            .collect())
    }

    pub(crate) async fn open_watch(&self, source_id: Uuid) -> AppResult<LocalFolderWatch> {
        let active_scope = self.knowledge.active_resource_scope().await?;
        let stored = self
            .knowledge
            .scopes(active_scope.workspace_id)
            .await?
            .into_iter()
            .find(|source| source.binding.source_id == source_id)
            .ok_or_else(|| AppError::NotFound("the Project Knowledge source".into()))?;
        if stored.binding.provider == KnowledgeSourceProvider::Github {
            return Err(AppError::Blocked {
                reason: "hosted GitHub Knowledge sources are not watched on Desktop".into(),
            });
        }
        let root = self.roots.fetch_root(source_id)?.ok_or_else(|| {
            AppError::NotFound("the Local Folder capability on this device".into())
        })?;
        self.local_sources
            .restore(stored.binding.clone(), stored.environment.revision, root)?;
        self.local_sources.watch(&stored.binding).await
    }

    /// Stop the sync running for `source_id`. Local work observes this run's own
    /// signal at its next checkpoint; a hosted GitHub index is stopped by the
    /// control plane, which supersedes the queued job and discards its partial
    /// index so the source returns to `stale` instead of `syncing`.
    pub(crate) async fn cancel_sync(&self, source_id: Uuid) -> AppResult<KnowledgeSyncCancellation> {
        // The source is resolved inside the active workspace before anything is
        // stopped, so a cancel can never reach a sync outside the current scope.
        let active_scope = self.knowledge.active_resource_scope().await?;
        let stored = self
            .knowledge
            .scopes(active_scope.workspace_id)
            .await?
            .into_iter()
            .find(|candidate| candidate.binding.source_id == source_id)
            .ok_or_else(|| AppError::NotFound("the Project Knowledge source".into()))?;
        if stored.binding.provider != KnowledgeSourceProvider::Github {
            // A Local Folder sync runs entirely on this device, so its own signal
            // is the whole answer and this device did check it.
            return Ok(KnowledgeSyncCancellation {
                source_id,
                cancelled: self.runs.cancel(source_id),
                verified: true,
            });
        }
        // A hosted index is stoppable only through the control plane; this device
        // registers no local run for it, so there is no local signal to consult.
        // Without a signed-in workspace account the control plane cannot be asked
        // at all, so the receipt reports the request as unverified instead of
        // asserting that nothing was running.
        if active_scope.selected_account_id.is_none() {
            return Ok(KnowledgeSyncCancellation {
                source_id,
                cancelled: false,
                verified: false,
            });
        }
        let remote = self.active_remote_scope(active_scope).await?;
        let cancelled = self
            .knowledge
            .cancel_remote_source_sync(
                remote.account.as_str(),
                remote.remote_workspace_id,
                source_id,
            )
            .await?;
        Ok(KnowledgeSyncCancellation {
            source_id,
            cancelled,
            verified: true,
        })
    }

    pub(crate) async fn sync(&self, source_id: Uuid) -> AppResult<KnowledgeSyncReceipt> {
        let active_scope = self.knowledge.active_resource_scope().await?;
        let stored = self
            .knowledge
            .scopes(active_scope.workspace_id)
            .await?
            .into_iter()
            .find(|candidate| candidate.binding.source_id == source_id)
            .ok_or_else(|| AppError::NotFound("the Project Knowledge source".into()))?;
        let previous_artifact = self.knowledge.active_for_source(source_id).await?;
        // The hosted arm holds no local run: the control plane owns that job and
        // has no checkpoint here, so registering a signal nothing reads would let
        // a cancel receipt claim a stop this device never made.
        if stored.binding.provider == KnowledgeSourceProvider::Github {
            let remote = self.active_remote_scope(active_scope).await?;
            let previous_graph_revision_id = self
                .knowledge
                .request_remote_source_sync(
                    remote.account.as_str(),
                    remote.remote_workspace_id,
                    source_id,
                )
                .await?;
            return Ok(KnowledgeSyncReceipt {
                source_id,
                state: SourceHealthState::Syncing,
                graph_revision_id: previous_graph_revision_id,
                parsed_files: previous_artifact
                    .as_ref()
                    .map_or(0, |artifact| artifact.health.parsed_files),
                skipped_files: previous_artifact
                    .as_ref()
                    .map_or(0, |artifact| artifact.health.skipped_files),
                changed_files: previous_artifact
                    .as_ref()
                    .map_or_else(Vec::new, |artifact| artifact.changed_files.clone()),
                node_count: previous_artifact
                    .as_ref()
                    .map_or(0, |artifact| artifact.nodes.len()),
                edge_count: previous_artifact
                    .as_ref()
                    .map_or(0, |artifact| artifact.edges.len()),
            });
        }

        // Claiming the source here serialises this run against any other local
        // sync of the same source, so only one of them can build and publish.
        let mut run = self.runs.begin(source_id).await;
        let cancellation = run.cancellation().clone();
        let parent = previous_artifact
            .as_ref()
            .map(|artifact| artifact.graph_revision_id);
        let previous_snapshot = self.knowledge.source_snapshot(source_id).await?;
        let root = self.roots.fetch_root(source_id)?.ok_or_else(|| {
            AppError::NotFound("the Local Folder capability on this device".into())
        })?;
        self.local_sources
            .restore(stored.binding.clone(), stored.environment.revision, root)?;
        let snapshot = self
            .local_sources
            .snapshot(&stored.binding, previous_snapshot.as_ref())
            .await?;
        if cancellation.is_cancelled() {
            return Err(sync_cancelled());
        }
        let artifact = if let Some(artifact) = unchanged_graph(
            previous_snapshot.as_ref(),
            &snapshot,
            previous_artifact.as_ref(),
        ) {
            // The pinned revision is unchanged, so there is no stoppable work left.
            run.close_stop_window();
            artifact
        } else {
            let artifact = build_graph(
                &self.local_sources,
                &snapshot,
                parent,
                previous_artifact.as_ref(),
                &cancellation,
            )
            .await?;
            validate_graph_publish(&artifact, &stored.environment)?;
            // Last cancellation point: the stage/save/activate sequence below runs
            // to completion so a cancel can never leave a half-written index. The
            // stop window closes with it, so a Stop that arrives from here on
            // reports honestly that it reached no work instead of claiming a stop
            // this run cannot make.
            if cancellation.is_cancelled() {
                return Err(sync_cancelled());
            }
            run.close_stop_window();
            self.knowledge.stage(&artifact).await?;
            self.knowledge
                .save_scope(
                    &stored.project,
                    &stored.environment,
                    &snapshot.binding,
                    snapshot.environment_revision,
                )
                .await?;
            self.knowledge.save_snapshot(&snapshot).await?;
            artifact
        };
        if parent != Some(artifact.graph_revision_id) {
            self.knowledge.activate(&artifact).await?;
        }
        Ok(KnowledgeSyncReceipt {
            source_id,
            state: SourceHealthState::Ready,
            graph_revision_id: Some(artifact.graph_revision_id),
            parsed_files: artifact.health.parsed_files,
            skipped_files: artifact.health.skipped_files,
            changed_files: artifact.changed_files,
            node_count: artifact.nodes.len(),
            edge_count: artifact.edges.len(),
        })
    }

    async fn active_remote_scope(
        &self,
        scope: ActiveResourceScope,
    ) -> AppResult<ActiveRemoteKnowledgeScope> {
        let account_value = scope.selected_account_id.as_ref().ok_or_else(|| {
            AppError::Config("Sign in to connect GitHub to Personal Workspace".into())
        })?;
        let account = AccountId::new(account_value.clone())
            .ok_or_else(|| AppError::Config("the selected workspace account is invalid".into()))?;
        let projects = if scope.workspace_kind == WorkspaceKind::Personal {
            self.knowledge
                .knowledge_projects(scope.workspace_id)
                .await?
                .into_iter()
                .map(project_projection)
                .collect::<Vec<_>>()
        } else {
            let projects = self
                .knowledge
                .list_remote_projects(account.as_str(), scope.workspace_id)
                .await?;
            for project in &projects {
                self.knowledge
                    .save_knowledge_project(&project_definition(scope.workspace_id, project))
                    .await?;
            }
            projects
        };
        let remote_workspace_id = if scope.workspace_kind == WorkspaceKind::Personal {
            self.knowledge
                .ensure_personal_scope(account.as_str(), &projects)
                .await?
                .workspace_id
        } else {
            scope.workspace_id
        };
        Ok(ActiveRemoteKnowledgeScope {
            account,
            remote_workspace_id,
        })
    }
}

struct ActiveRemoteKnowledgeScope {
    account: AccountId,
    remote_workspace_id: Uuid,
}

fn project_definition(workspace_id: Uuid, project: &RemoteKnowledgeProject) -> ProjectDefinition {
    ProjectDefinition {
        project: Project {
            id: project.id,
            workspace_id: WorkspaceId::from(workspace_id),
            name: project.name.clone(),
            revision: project.revision,
        },
        environments: project
            .environments
            .iter()
            .map(|environment| ProjectEnvironment {
                id: environment.id,
                project_id: project.id,
                name: environment.name.clone(),
                risk_class: environment.risk_class,
                revision: environment.revision,
            })
            .collect(),
    }
}

fn project_projection(definition: ProjectDefinition) -> RemoteKnowledgeProject {
    RemoteKnowledgeProject {
        id: definition.project.id,
        name: definition.project.name,
        revision: definition.project.revision,
        environments: definition
            .environments
            .into_iter()
            .map(|environment| RemoteKnowledgeEnvironment {
                id: environment.id,
                name: environment.name,
                risk_class: environment.risk_class,
                revision: environment.revision,
            })
            .collect(),
    }
}

fn unchanged_graph(
    previous_snapshot: Option<&SourceSnapshot>,
    snapshot: &SourceSnapshot,
    previous_artifact: Option<&GraphBuildArtifactV1>,
) -> Option<GraphBuildArtifactV1> {
    previous_snapshot
        .filter(|previous| {
            previous.source_revision_sha256 == snapshot.source_revision_sha256
                && previous.binding.source_id == snapshot.binding.source_id
        })
        .and(previous_artifact)
        .filter(|artifact| artifact.binding.source_id == snapshot.binding.source_id)
        .cloned()
}
