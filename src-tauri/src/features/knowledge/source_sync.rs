//! Local/hosted Knowledge source synchronization use case shared by transport and watchers.

use std::path::PathBuf;
use std::sync::Arc;

use dopedb_protocol::{GraphBuildArtifactV1, KnowledgeSourceProvider};
use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::adapters::local::{LocalFolderAdapter, LocalFolderWatch};
use super::domain::{validate_graph_publish, SourceHealthState, SourceSnapshot};
use super::extractor::build_graph;
use super::ports::LocalKnowledgeSourcePort;
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

pub(crate) trait KnowledgeSourceRootPort: Send + Sync {
    fn fetch_root(&self, source_id: Uuid) -> AppResult<Option<PathBuf>>;
}

#[derive(Clone)]
pub(crate) struct KnowledgeSourceSynchronizer {
    knowledge: KnowledgeFeature,
    local_sources: LocalFolderAdapter,
    roots: Arc<dyn KnowledgeSourceRootPort>,
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

    pub(crate) async fn sync(&self, source_id: Uuid) -> AppResult<KnowledgeSyncReceipt> {
        let active_scope = self.knowledge.active_resource_scope().await?;
        let stored = self
            .knowledge
            .scopes(active_scope.workspace_id)
            .await?
            .into_iter()
            .find(|candidate| candidate.binding.source_id == source_id)
            .ok_or_else(|| AppError::NotFound("the Project Knowledge source".into()))?;
        if stored.binding.provider == KnowledgeSourceProvider::Github {
            return Err(AppError::Blocked {
                reason: "hosted GitHub Knowledge sources are revision-tracked by the workspace"
                    .into(),
            });
        }
        let previous_artifact = self.knowledge.active_for_source(source_id).await?;

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
        let artifact = if let Some(artifact) = unchanged_graph(
            previous_snapshot.as_ref(),
            &snapshot,
            previous_artifact.as_ref(),
        ) {
            artifact
        } else {
            let artifact = build_graph(
                &self.local_sources,
                &snapshot,
                parent,
                previous_artifact.as_ref(),
            )
            .await?;
            validate_graph_publish(&artifact, &stored.environment)?;
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
