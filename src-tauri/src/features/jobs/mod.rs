//! Durable import/export job feature.

use std::path::PathBuf;

mod adapters;
mod application;
pub(crate) mod domain;
mod ports;
mod state_machine;
pub(crate) mod transport;
mod validation;

use tokio::sync::broadcast;

use crate::connection::ConnectionManager;
use crate::error::AppResult;
use crate::features::catalog::CatalogFeature;
use crate::kernel::identity::{ConnectionId, ConnectionJobId, JobArtifactId, JobFileCapabilityId};
use crate::operations::OperationRuntime;
use crate::store::Store;

use adapters::authority::RuntimeJobAuthority;
use adapters::catalog::JobCatalogAdapter;
use adapters::filesystem::LocalJobFiles;
use adapters::generator::SystemJobGenerator;
use adapters::ledger::JobRepository;
use adapters::worker::JobWorker;
use application::{JobDependencies, JobUseCases};
pub(crate) use domain::{
    CreateJobRequest, Job, JobArtifact, JobChangedEvent, JobDetail, JobErrorPolicy,
    JobFieldMapping, JobFileCapability, JobFileDirection, JobFormat, JobInputInspection, JobKind,
    JobPlan, JobProposal, JobSqlAudit, JobState, JobValidation,
};
pub(crate) use state_machine::JobTransition;
pub(crate) use validation::{
    summaries, valid_sha256_fingerprint, validate_mapping_sources, validate_plan,
    validate_required_target_columns,
};

type ComposedJobApplication = JobUseCases<
    JobRepository,
    RuntimeJobAuthority,
    LocalJobFiles,
    JobCatalogAdapter,
    OperationRuntime,
    JobWorker,
    SystemJobGenerator,
>;

#[derive(Clone)]
pub(crate) struct JobsFeature {
    application: ComposedJobApplication,
}

impl JobsFeature {
    pub(crate) fn subscribe(&self) -> broadcast::Receiver<JobChangedEvent> {
        self.application.subscribe()
    }

    pub(crate) async fn recover_interrupted(&self) -> AppResult<u64> {
        self.application.recover_interrupted().await
    }

    pub(crate) async fn register_input(
        &self,
        connection_id: ConnectionId,
        path: PathBuf,
    ) -> AppResult<JobFileCapability> {
        self.application.register_input(connection_id, path).await
    }

    pub(crate) async fn register_output(
        &self,
        connection_id: ConnectionId,
        path: PathBuf,
    ) -> AppResult<JobFileCapability> {
        self.application.register_output(connection_id, path).await
    }

    pub(crate) async fn inspect_input(
        &self,
        connection_id: ConnectionId,
        capability_id: JobFileCapabilityId,
        format: JobFormat,
    ) -> AppResult<JobInputInspection> {
        self.application
            .inspect_input(connection_id, capability_id, format)
            .await
    }

    pub(crate) async fn create(&self, request: CreateJobRequest) -> AppResult<JobProposal> {
        self.application.create(request).await
    }

    pub(crate) async fn list(&self, connection_id: ConnectionId) -> AppResult<Vec<Job>> {
        self.application.list(connection_id).await
    }

    pub(crate) async fn detail(&self, scoped_id: ConnectionJobId) -> AppResult<JobDetail> {
        self.application.detail(scoped_id).await
    }

    pub(crate) async fn start(&self, scoped_id: ConnectionJobId) -> AppResult<Job> {
        self.application.start(scoped_id).await
    }

    pub(crate) async fn pause(&self, scoped_id: ConnectionJobId) -> AppResult<Job> {
        self.application.pause(scoped_id).await
    }

    pub(crate) async fn cancel(&self, scoped_id: ConnectionJobId) -> AppResult<Job> {
        self.application.cancel(scoped_id).await
    }

    pub(crate) async fn artifact_path(
        &self,
        connection_id: ConnectionId,
        artifact_id: JobArtifactId,
    ) -> AppResult<PathBuf> {
        self.application
            .artifact_path(connection_id, artifact_id)
            .await
    }
}

pub(crate) fn compose(
    store: Store,
    connections: ConnectionManager,
    catalog: CatalogFeature,
    operation: OperationRuntime,
) -> JobsFeature {
    let ledger = JobRepository::new(store.clone());
    let catalog = JobCatalogAdapter::new(catalog, store.clone());
    let authority = RuntimeJobAuthority::new(store, connections);
    let (events, _) = broadcast::channel(256);
    let execution = JobWorker::new(
        ledger.clone(),
        authority.clone(),
        catalog.clone(),
        events.clone(),
    );
    JobsFeature {
        application: JobUseCases::new(
            JobDependencies {
                ledger,
                authority,
                files: LocalJobFiles,
                catalog,
                operation,
                execution,
                generator: SystemJobGenerator,
            },
            events,
        ),
    }
}
