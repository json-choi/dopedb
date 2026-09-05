//! Durable, scope-aware import/export Job application use cases.
//!
//! Native file dialogs mint opaque capabilities, immutable plans are bound to an
//! exact Operation, and bounded workers persist progress/checkpoints so interruption
//! becomes an explicit pause rather than an ambiguous retry.

mod execution;
mod files;
mod planning;
mod recovery;

use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::{broadcast, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::features::jobs::{Job, JobChangedEvent, JobKind};
use crate::kernel::identity::JobId;

use super::ports::{
    JobAuthorityPort, JobCatalogPort, JobExecutionPort, JobFilePort, JobGeneratorPort,
    JobLedgerPort, JobOperationPort, JobRecord,
};

const MAX_CONCURRENT_JOBS: usize = 2;

pub(crate) struct JobDependencies<L, A, F, C, O, E, G> {
    pub(crate) ledger: L,
    pub(crate) authority: A,
    pub(crate) files: F,
    pub(crate) catalog: C,
    pub(crate) operation: O,
    pub(crate) execution: E,
    pub(crate) generator: G,
}

#[derive(Clone)]
pub(crate) struct JobUseCases<L, A, F, C, O, E, G> {
    ledger: L,
    authority: A,
    files: F,
    catalog: C,
    operation: O,
    execution: E,
    generator: G,
    running: Arc<DashMap<JobId, CancellationToken>>,
    concurrency: Arc<Semaphore>,
    events: broadcast::Sender<JobChangedEvent>,
}

impl<L, A, F, C, O, E, G> JobUseCases<L, A, F, C, O, E, G>
where
    L: JobLedgerPort,
    A: JobAuthorityPort,
    F: JobFilePort,
    C: JobCatalogPort,
    O: JobOperationPort,
    E: JobExecutionPort<O::Claim>,
    G: JobGeneratorPort,
{
    pub(crate) fn new(
        dependencies: JobDependencies<L, A, F, C, O, E, G>,
        events: broadcast::Sender<JobChangedEvent>,
    ) -> Self {
        let JobDependencies {
            ledger,
            authority,
            files,
            catalog,
            operation,
            execution,
            generator,
        } = dependencies;
        Self {
            ledger,
            authority,
            files,
            catalog,
            operation,
            execution,
            generator,
            running: Arc::new(DashMap::new()),
            concurrency: Arc::new(Semaphore::new(MAX_CONCURRENT_JOBS)),
            events,
        }
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<JobChangedEvent> {
        self.events.subscribe()
    }

    fn emit(&self, job: &Job) {
        let _ = self.events.send(JobChangedEvent {
            connection_id: job.connection_id,
            job_id: job.id,
            kind: job.kind,
            state: job.state,
            rows_processed: job.rows_processed,
            bytes_processed: job.bytes_processed,
        });
    }

    async fn retire_import_source(&self, record: &JobRecord) {
        if record.job.kind != JobKind::Import || !record.job.state.terminal() {
            return;
        }
        let path = match self.ledger.retire_input_capability(record.job.id).await {
            Ok(Some(path)) => path,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(
                    job_id = %record.job.id,
                    error = %error,
                    "could not retire a private job input"
                );
                return;
            }
        };
        if let Err(error) = self.files.remove_private_input(path).await {
            tracing::warn!(
                job_id = %record.job.id,
                error = %error,
                "could not remove a retired private job input"
            );
        }
    }
}
