//! Bounded local worker adapter.
//!
//! The entrypoint owns execution ordering while export, import, resume validation,
//! SQL generation, and artifact publication remain isolated implementation modules.

mod export;
mod files;
mod import;
mod resume;
mod statements;
mod validation;

use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::features::jobs::{Job, JobChangedEvent, JobPlan, JobState};
use crate::kernel::identity::JobId;
use crate::operations::ClaimedOperation;

use super::super::ports::{JobExecutionPort, JobLedgerPort, JobRecord, WorkerOutcome};
use super::authority::RuntimeJobAuthority;
use super::catalog::JobCatalogAdapter;
use super::ledger::JobRepository;
use files::{file_len, partial_path};
use validation::verify_operation;

#[derive(Clone)]
pub(in crate::features::jobs) struct JobWorker {
    repository: JobRepository,
    authority: RuntimeJobAuthority,
    catalog: JobCatalogAdapter,
    events: broadcast::Sender<JobChangedEvent>,
}

impl JobWorker {
    pub(in crate::features::jobs) fn new(
        repository: JobRepository,
        authority: RuntimeJobAuthority,
        catalog: JobCatalogAdapter,
        events: broadcast::Sender<JobChangedEvent>,
    ) -> Self {
        Self {
            repository,
            authority,
            catalog,
            events,
        }
    }

    async fn run_inner(
        &self,
        record: JobRecord,
        claimed: ClaimedOperation,
        cancellation: CancellationToken,
    ) -> AppResult<WorkerOutcome> {
        verify_operation(&record, &claimed)?;
        match &record.plan {
            JobPlan::Export { .. } => {
                let recovery_record = record.clone();
                let result = self.run_export(record, &claimed, cancellation).await;
                if matches!(&result, Err(_) | Ok(WorkerOutcome::Cancelled)) {
                    if let Err(error) = self.retain_export_partial(&recovery_record).await {
                        tracing::warn!(
                            job_id = %recovery_record.job.id,
                            error = %error,
                            "could not retain export partial artifact"
                        );
                    }
                }
                result
            }
            JobPlan::Import { .. } => self.run_import(record, &claimed, cancellation).await,
        }
    }

    async fn stop_outcome(&self, job_id: JobId) -> AppResult<WorkerOutcome> {
        let current = self.repository.get_unscoped(job_id).await?;
        match current.job.state {
            JobState::Running | JobState::PauseRequested => Ok(WorkerOutcome::Paused),
            JobState::CancelRequested => Ok(WorkerOutcome::Cancelled),
            JobState::Paused => Ok(WorkerOutcome::Paused),
            _ => Err(AppError::Blocked {
                reason: "job stop request no longer matches its lifecycle state".into(),
            }),
        }
    }

    async fn retain_export_partial(&self, record: &JobRecord) -> AppResult<()> {
        use super::super::ports::{JobAuthorityGuard, JobAuthorityPort, JobPermission};
        use super::format::file_sha256;
        use validation::ensure_record_scope;

        let JobPlan::Export { capability_id, .. } = &record.plan else {
            return Ok(());
        };
        let guard = self
            .authority
            .authorize(record.job.connection_id, JobPermission::Read)
            .await?;
        ensure_record_scope(record, guard.authority())?;
        let capability = self
            .repository
            .resolve_capability(
                guard.authority(),
                *capability_id,
                crate::features::jobs::JobFileDirection::Output,
                Some(record.job.id),
            )
            .await?;
        let partial = partial_path(&capability.path, record.job.id)?;
        let size = match std::fs::metadata(&partial) {
            Ok(metadata) if metadata.is_file() && metadata.len() > 0 => file_len(&partial)?,
            _ => return Ok(()),
        };
        let sha256 = file_sha256(&partial)?;
        self.repository
            .record_artifact(record.job.id, "partial", &partial, size, &sha256)
            .await
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
}

impl JobExecutionPort<ClaimedOperation> for JobWorker {
    async fn validate_resume(&self, record: &JobRecord) -> AppResult<()> {
        self.validate_resume_inner(record).await
    }

    async fn run(
        &self,
        record: JobRecord,
        claim: ClaimedOperation,
        cancellation: CancellationToken,
    ) -> AppResult<WorkerOutcome> {
        self.run_inner(record, claim, cancellation).await
    }

    fn cancel(&self, job_id: JobId) {
        crate::executor::cancel::cancel(job_id.into());
    }
}
