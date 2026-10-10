//! Platform contracts required by Job application use cases.
//!
//! The application layer owns validation and mutation ordering. Connection pins,
//! SQLite, native files, catalog refreshes, Operation persistence, clocks, and
//! database execution stay behind these ports.

use std::future::Future;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use dopedb_protocol::catalog::CatalogSnapshot;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::error::AppResult;
use crate::kernel::identity::{
    AccountScopeId, ConnectionId, JobArtifactId, JobFileCapabilityId, JobId, OperationId,
    WorkspaceConnectionId,
};
use crate::model::{Engine, SafetySettings, WorkspaceConnectionAccess};
use crate::operations::{NewOperation, OperationActor, OperationPlanDisposition, OperationRecord};

use super::{
    Job, JobArtifact, JobFileCapability, JobFileDirection, JobFormat, JobInputInspection, JobKind,
    JobPlan, JobState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JobPermission {
    Read,
    Write,
    /// A SQL import that contains DDL needs the schema credential and the
    /// connection's `manage` grant, exactly like a schema-change proposal.
    Schema,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JobAuthority {
    pub(crate) resource: WorkspaceConnectionId,
    pub(crate) account_scope: AccountScopeId,
    pub(crate) connection_revision: i64,
    pub(crate) engine: Engine,
    pub(crate) workspace_access: WorkspaceConnectionAccess,
}

pub(crate) struct JobOperationContext {
    pub(crate) safety: SafetySettings,
    pub(crate) actor: OperationActor,
    pub(crate) policy_snapshot: Value,
    pub(crate) policy_revision: String,
}

pub(crate) trait JobAuthorityGuard: Send {
    fn authority(&self) -> &JobAuthority;
}

pub(crate) trait JobAuthorityPort: Clone + Send + Sync + 'static {
    type Guard: JobAuthorityGuard;

    fn authorize(
        &self,
        connection_id: ConnectionId,
        permission: JobPermission,
    ) -> impl Future<Output = AppResult<Self::Guard>> + Send;

    fn operation_context<'a>(
        &'a self,
        guard: &'a Self::Guard,
        origin_surface: &'static str,
    ) -> impl Future<Output = AppResult<JobOperationContext>> + Send + 'a;

    fn safety<'a>(
        &'a self,
        guard: &'a Self::Guard,
    ) -> impl Future<Output = AppResult<SafetySettings>> + Send + 'a;
}

pub(crate) struct NewCapability {
    pub(crate) connection_id: ConnectionId,
    pub(crate) direction: JobFileDirection,
    pub(crate) path: PathBuf,
    pub(crate) display_name: String,
    pub(crate) size_bytes: Option<u64>,
    pub(crate) modified_at: Option<String>,
    pub(crate) source_sha256: Option<String>,
    pub(crate) expires_at: DateTime<Utc>,
}

pub(crate) struct ResolvedCapability {
    pub(crate) path: PathBuf,
    pub(crate) display_name: String,
    pub(crate) size_bytes: Option<u64>,
    pub(crate) source_sha256: Option<String>,
}

#[derive(Clone)]
pub(crate) struct JobRecord {
    pub(crate) job: Job,
    pub(crate) workspace_id: crate::kernel::identity::WorkspaceId,
    pub(crate) account_scope: AccountScopeId,
    pub(crate) plan: JobPlan,
    pub(crate) plan_hash: String,
}

pub(crate) struct NewJob {
    pub(crate) id: JobId,
    pub(crate) operation_id: OperationId,
    pub(crate) connection_id: ConnectionId,
    pub(crate) kind: JobKind,
    pub(crate) format: JobFormat,
    pub(crate) plan: JobPlan,
    pub(crate) source_summary: String,
    pub(crate) target_summary: String,
    pub(crate) rows_total: Option<u64>,
    pub(crate) bytes_total: Option<u64>,
    pub(crate) resumable: bool,
}

pub(crate) struct Checkpoint {
    pub(crate) source_fingerprint: String,
    pub(crate) target_fingerprint: String,
    pub(crate) value: Value,
}

pub(crate) trait JobLedgerPort: Clone + Send + Sync + 'static {
    fn create_capability(
        &self,
        authority: &JobAuthority,
        capability: NewCapability,
    ) -> impl Future<Output = AppResult<JobFileCapability>> + Send;

    fn resolve_capability(
        &self,
        authority: &JobAuthority,
        capability_id: JobFileCapabilityId,
        direction: JobFileDirection,
        job_id: Option<JobId>,
    ) -> impl Future<Output = AppResult<ResolvedCapability>> + Send;

    fn retire_input_capability(
        &self,
        job_id: JobId,
    ) -> impl Future<Output = AppResult<Option<PathBuf>>> + Send;

    fn retire_expired_input_capabilities(
        &self,
    ) -> impl Future<Output = AppResult<Vec<PathBuf>>> + Send;

    fn active_input_capability_paths(&self)
        -> impl Future<Output = AppResult<Vec<PathBuf>>> + Send;

    fn insert_job(
        &self,
        authority: &JobAuthority,
        new: NewJob,
    ) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn list(&self, authority: &JobAuthority) -> impl Future<Output = AppResult<Vec<Job>>> + Send;

    fn detail(
        &self,
        authority: &JobAuthority,
        job_id: JobId,
    ) -> impl Future<Output = AppResult<(Job, Vec<JobArtifact>)>> + Send;

    fn get_scoped(
        &self,
        authority: &JobAuthority,
        job_id: JobId,
    ) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn get_unscoped(&self, job_id: JobId) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn queued_records(&self) -> impl Future<Output = AppResult<Vec<JobRecord>>> + Send;

    fn paused_records(&self) -> impl Future<Output = AppResult<Vec<JobRecord>>> + Send;

    fn claim_running(
        &self,
        authority: &JobAuthority,
        job_id: JobId,
    ) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn update_progress(
        &self,
        job_id: JobId,
        rows_processed: u64,
        bytes_processed: u64,
        checkpoint: Option<Checkpoint>,
    ) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn update_totals(
        &self,
        job_id: JobId,
        rows_total: Option<u64>,
        bytes_total: Option<u64>,
    ) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn latest_checkpoint(
        &self,
        job_id: JobId,
    ) -> impl Future<Output = AppResult<Option<Checkpoint>>> + Send;

    fn request_pause(&self, job_id: JobId) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn finish_pause(&self, job_id: JobId) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn rollback_initial_start(
        &self,
        job_id: JobId,
    ) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn request_cancel(&self, job_id: JobId) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn finish(
        &self,
        job_id: JobId,
        state: JobState,
        error_code: Option<&str>,
        redacted_error: Option<&str>,
    ) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn finish_queued(
        &self,
        job_id: JobId,
        state: JobState,
        error_code: &str,
        redacted_error: &str,
    ) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn fail_paused(
        &self,
        job_id: JobId,
        error_code: &str,
        redacted_error: &str,
    ) -> impl Future<Output = AppResult<JobRecord>> + Send;

    fn record_artifact(
        &self,
        job_id: JobId,
        artifact_type: &str,
        path: &Path,
        size_bytes: u64,
        sha256: &str,
    ) -> impl Future<Output = AppResult<()>> + Send;

    fn artifact_path(
        &self,
        authority: &JobAuthority,
        artifact_id: JobArtifactId,
    ) -> impl Future<Output = AppResult<PathBuf>> + Send;

    fn recover_interrupted(&self) -> impl Future<Output = AppResult<Vec<JobRecord>>> + Send;
}

pub(crate) struct PreparedJobFile {
    pub(crate) path: PathBuf,
    pub(crate) display_name: String,
    pub(crate) size_bytes: u64,
    pub(crate) modified_at: Option<String>,
    pub(crate) source_sha256: Option<String>,
}

pub(crate) struct SqlImportAudit {
    pub(crate) statement_count: u64,
    pub(crate) read_count: u64,
    pub(crate) write_count: u64,
    pub(crate) ddl_count: u64,
}

pub(crate) struct InputReview {
    pub(crate) inspection: JobInputInspection,
    pub(crate) sql_audit: Option<SqlImportAudit>,
}

pub(crate) trait JobFilePort: Clone + Send + Sync + 'static {
    fn snapshot_input(
        &self,
        path: PathBuf,
    ) -> impl Future<Output = AppResult<PreparedJobFile>> + Send;

    fn prepare_output(
        &self,
        path: PathBuf,
    ) -> impl Future<Output = AppResult<PreparedJobFile>> + Send;

    fn inspect_input(
        &self,
        path: PathBuf,
        format: JobFormat,
        engine: Engine,
        expected_hash: String,
    ) -> impl Future<Output = AppResult<JobInputInspection>> + Send;

    fn review_input(
        &self,
        path: PathBuf,
        format: JobFormat,
        engine: Engine,
        expected_hash: String,
    ) -> impl Future<Output = AppResult<InputReview>> + Send;

    fn remove_private_input(&self, path: PathBuf) -> impl Future<Output = AppResult<()>> + Send;

    fn sweep_private_inputs(
        &self,
        active_paths: Vec<PathBuf>,
    ) -> impl Future<Output = AppResult<()>> + Send;
}

pub(crate) trait JobCatalogPort: Clone + Send + Sync + 'static {
    fn refresh(
        &self,
        connection_id: ConnectionId,
    ) -> impl Future<Output = AppResult<CatalogSnapshot>> + Send;

    /// A live read for a run that may change the schema: it leaves no cached snapshot
    /// for the run's own DDL to turn stale.
    fn read_before_schema_change(
        &self,
        connection_id: ConnectionId,
    ) -> impl Future<Output = AppResult<CatalogSnapshot>> + Send;

    /// Retire every cached catalog of the connection and announce it after a run's
    /// DDL reached the database, like any other committed schema change.
    fn schema_changed(
        &self,
        connection_id: ConnectionId,
    ) -> impl Future<Output = AppResult<()>> + Send;
}

pub(crate) trait JobOperationPort: Clone + Send + Sync + 'static {
    type Claim: Send + 'static;

    fn plan(
        &self,
        operation: NewOperation,
        disposition: OperationPlanDisposition,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;

    fn get(
        &self,
        operation_id: OperationId,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;

    fn claim(
        &self,
        operation_id: OperationId,
    ) -> impl Future<Output = AppResult<Self::Claim>> + Send;

    fn resume_job_claim(
        &self,
        operation_id: OperationId,
        expected_payload_hash: &str,
    ) -> impl Future<Output = AppResult<Self::Claim>> + Send;

    fn rebind_pending_job(
        &self,
        operation_id: OperationId,
        expected_payload_hash: &str,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;

    fn rebind_paused_job(
        &self,
        operation_id: OperationId,
        expected_payload_hash: &str,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;

    fn fail_interrupted_export(
        &self,
        operation_id: OperationId,
        expected_payload_hash: &str,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;

    fn succeed(
        &self,
        operation_id: OperationId,
        details: &Value,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;

    fn fail(
        &self,
        operation_id: OperationId,
        details: &Value,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;

    fn confirm_cancelled(
        &self,
        operation_id: OperationId,
        details: &Value,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;

    fn cancel_before_execution(
        &self,
        operation_id: OperationId,
        details: &Value,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;

    fn mark_outcome_unknown(
        &self,
        operation_id: OperationId,
        details: &Value,
    ) -> impl Future<Output = AppResult<OperationRecord>> + Send;
}

pub(crate) trait JobExecutionPort<C>: Clone + Send + Sync + 'static
where
    C: Send + 'static,
{
    fn validate_resume(&self, record: &JobRecord) -> impl Future<Output = AppResult<()>> + Send;

    fn run(
        &self,
        record: JobRecord,
        claim: C,
        cancellation: CancellationToken,
    ) -> impl Future<Output = AppResult<WorkerOutcome>> + Send;

    fn cancel(&self, job_id: JobId);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkerOutcome {
    Succeeded,
    Paused,
    Cancelled,
}

pub(crate) trait JobGeneratorPort: Clone + Send + Sync + 'static {
    fn next_job_id(&self) -> JobId;
    fn next_operation_id(&self) -> OperationId;
    fn capability_expires_at(&self) -> DateTime<Utc>;
    fn import_operation_expires_at(&self) -> DateTime<Utc>;
}
