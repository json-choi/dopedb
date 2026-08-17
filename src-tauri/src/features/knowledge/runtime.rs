//! Process-local source watcher lifecycle.
//!
//! Only Local Folder sources are watched here. GitHub changes arrive through
//! the GitHub App webhook and are incrementally indexed by the control plane.

use std::sync::Arc;
use std::time::Duration;

use dashmap::mapref::entry::Entry;
use dashmap::DashMap;
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppResult;

use super::domain::is_sync_cancelled;
use super::source_sync::{
    KnowledgeSourceSynchronizer, KnowledgeSyncCancellation, KnowledgeSyncReceipt,
};

const WATCH_DEBOUNCE: Duration = Duration::from_millis(750);

#[derive(Clone)]
pub(crate) struct KnowledgeWatchRuntime {
    tasks: Arc<DashMap<Uuid, tokio::task::JoinHandle<()>>>,
    synchronizer: KnowledgeSourceSynchronizer,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeSourceChanged {
    pub(crate) source_id: Uuid,
    pub(crate) state: &'static str,
    pub(crate) error_kind: Option<String>,
}

pub(crate) trait KnowledgeSourceEventSink: Send + Sync {
    fn source_changed(&self, changed: KnowledgeSourceChanged);
}

impl KnowledgeWatchRuntime {
    pub(crate) fn new(synchronizer: KnowledgeSourceSynchronizer) -> Self {
        Self {
            tasks: Arc::new(DashMap::new()),
            synchronizer,
        }
    }

    pub(crate) fn start(&self, events: Arc<dyn KnowledgeSourceEventSink>, source_id: Uuid) {
        let Entry::Vacant(entry) = self.tasks.entry(source_id) else {
            return;
        };
        let runtime = self.clone();
        let synchronizer = self.synchronizer.clone();
        let (start_tx, start_rx) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let _ = start_rx.await;
            if let Err(error) = watch_source(&synchronizer, events.as_ref(), source_id).await {
                emit_state(events.as_ref(), source_id, "failed", Some(error.kind()));
            }
            runtime.tasks.remove(&source_id);
        });
        entry.insert(task);
        let _ = start_tx.send(());
    }

    pub(crate) fn stop(&self, source_id: Uuid) {
        if let Some((_, task)) = self.tasks.remove(&source_id) {
            task.abort();
        }
    }

    pub(crate) async fn start_workspace(
        &self,
        events: Arc<dyn KnowledgeSourceEventSink>,
    ) -> AppResult<()> {
        let source_ids = self.synchronizer.local_source_ids().await?;
        for source_id in source_ids {
            self.start(events.clone(), source_id);
        }
        Ok(())
    }

    pub(crate) async fn sync(&self, source_id: Uuid) -> AppResult<KnowledgeSyncReceipt> {
        self.synchronizer.sync(source_id).await
    }

    pub(crate) async fn cancel_sync(
        &self,
        source_id: Uuid,
    ) -> AppResult<KnowledgeSyncCancellation> {
        self.synchronizer.cancel_sync(source_id).await
    }
}

async fn watch_source(
    synchronizer: &KnowledgeSourceSynchronizer,
    events: &dyn KnowledgeSourceEventSink,
    source_id: Uuid,
) -> AppResult<()> {
    let mut watch = synchronizer.open_watch(source_id).await?;
    drive_changes(synchronizer, events, source_id, &mut watch.changes).await;
    Ok(())
}

async fn drive_changes(
    synchronizer: &KnowledgeSourceSynchronizer,
    events: &dyn KnowledgeSourceEventSink,
    source_id: Uuid,
    changes: &mut tokio::sync::mpsc::Receiver<Vec<String>>,
) {
    while changes.recv().await.is_some() {
        tokio::time::sleep(WATCH_DEBOUNCE).await;
        while changes.try_recv().is_ok() {}
        emit_state(events, source_id, "syncing", None);
        match synchronizer.sync(source_id).await {
            Ok(_) => emit_state(events, source_id, "ready", None),
            // A user-requested stop is not a source failure, so it never leaves a
            // `failed` badge behind; the screen falls back to the stored health.
            Err(error) if is_sync_cancelled(&error) => {
                emit_state(events, source_id, "cancelled", None);
            }
            Err(error) => emit_state(events, source_id, "failed", Some(error.kind())),
        }
    }
}

fn emit_state(
    events: &dyn KnowledgeSourceEventSink,
    source_id: Uuid,
    state: &'static str,
    error_kind: Option<&str>,
) {
    events.source_changed(KnowledgeSourceChanged {
        source_id,
        state,
        error_kind: error_kind.map(str::to_owned),
    });
}
