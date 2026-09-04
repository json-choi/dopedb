//! SQL Query vertical slice for desktop and authenticated Terminal workflows.

mod adapters;
mod application;
mod domain;
mod manual_transaction;
mod ports;
pub(crate) mod transport;

use crate::connection::ConnectionManager;
use crate::error::{AppError, AppResult};
use crate::kernel::identity::{ConnectionId, OperationId};
use crate::kernel::TerminalAuthority;
use crate::operations::{OperationActorKind, OperationKind, OperationRuntime, OperationState};
use crate::store::Store;

impl From<domain::QueryDomainError> for crate::error::AppError {
    fn from(error: domain::QueryDomainError) -> Self {
        match error {
            domain::QueryDomainError::Invalid(message) => Self::Config(message),
            domain::QueryDomainError::LimitExceeded(reason) => Self::Blocked { reason },
            domain::QueryDomainError::Serialization(error) => Self::Serialization(error),
        }
    }
}

#[cfg(test)]
pub(crate) use adapters::QueryPlatformAdapter;
#[cfg(not(test))]
use adapters::QueryPlatformAdapter;
#[cfg(feature = "packaged-benchmark")]
pub(crate) use adapters::{run_packaged_result_store_benchmark, PackagedResultStoreMetric};
pub(crate) use adapters::{AgentQueryPlanError, AgentQueryRunError, AgentQueryRunPrepareError};
use adapters::{
    AgentQueryPlanReceipt, DesktopSqlStreamRegistry, DesktopStreamCleanupOwner,
    DesktopStreamCleanupRuntime, PreparedAgentQueryRun,
};
pub(crate) use adapters::{
    DesktopSqlApprovalReview, DesktopSqlInspectionError, DesktopSqlInspectionReceipt,
    DesktopSqlProposalReceipt, DesktopSqlRunError, DesktopSqlRunReceipt, DesktopSqlStreamReceipt,
};
use adapters::{StoredDesktopSqlPayload, DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION};
use application::QueryUseCases;
pub(crate) use domain::{
    validate_query_service_session_snapshot, DesktopPreviewIntent, DesktopSqlInspectionRequest,
    DesktopSqlProposalRequest, DesktopSqlResultExportFormat, DesktopSqlResultExportProgress,
    DesktopSqlResultExportReceipt, DesktopSqlStreamBatch, DesktopSqlStreamReady,
    DesktopSqlStreamSinkError, QueryServiceSessionSnapshot, TerminalQueryPlanRequest,
    TerminalSqlProposalRequest,
};
pub(crate) use manual_transaction::{
    ManualExecutionTarget, ManualScriptRequest, ManualTransactionRuntime, ManualTransactionStatus,
};

#[cfg(test)]
mod domain_tests;

type ComposedQueryApplication = QueryUseCases<QueryPlatformAdapter>;

/// Composition boundary for desktop SQL and Broker-owned query workflows.
#[derive(Clone)]
pub(crate) struct QueriesFeature {
    application: ComposedQueryApplication,
    operation: OperationRuntime,
    desktop_streams: DesktopSqlStreamRegistry,
    desktop_stream_cleanup: DesktopStreamCleanupRuntime,
    _desktop_stream_cleanup_owner: DesktopStreamCleanupOwner,
    manual_transactions: ManualTransactionRuntime,
    store: Store,
    _manual_transaction_revocation_port:
        std::sync::Arc<dyn crate::connection::ConnectionSessionRevocationPort>,
}

impl QueriesFeature {
    /// App shutdown owns a bounded drain before the Tauri runtime tears down
    /// command futures and their connection leases.
    pub(crate) async fn shutdown_desktop_streams(&self, timeout: std::time::Duration) {
        self.desktop_stream_cleanup
            .shutdown_and_drain(timeout)
            .await;
    }

    pub(crate) fn manual_transactions(&self) -> ManualTransactionRuntime {
        self.manual_transactions.clone()
    }

    /// Reloads the trusted SQL behind one exact Agent-created proposal for review.
    pub(crate) async fn review_agent_sql_proposal(
        &self,
        operation_id: OperationId,
        connection_id: ConnectionId,
        expected_payload_hash: String,
    ) -> AppResult<DesktopSqlApprovalReview> {
        let planned = self.operation.get(operation_id.into()).await?;
        self.store
            .get_connection(uuid::Uuid::from(connection_id))
            .await?;
        let active_workspace_id = self.store.active_workspace_id().await?;
        let active_account_scope = self.store.active_local_scope().await?;
        if planned.connection_id != uuid::Uuid::from(connection_id)
            || planned.payload_hash != expected_payload_hash
            || planned.terminal_session_id.is_none()
            || planned.actor.kind != OperationActorKind::Agent
            || planned.workspace_id != active_workspace_id
            || planned.account_scope != active_account_scope
        {
            return Err(AppError::Blocked {
                reason: "the Agent proposal does not match this Desktop session".into(),
            });
        }
        if planned.payload_schema_version != DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION
            || !matches!(
                planned.kind,
                OperationKind::WriteSql | OperationKind::Ddl | OperationKind::Privilege
            )
        {
            return Err(AppError::Blocked {
                reason: "the operation is not a reviewable Agent SQL proposal".into(),
            });
        }
        let payload: StoredDesktopSqlPayload = serde_json::from_value(planned.payload.clone())?;
        let state = if planned.state == OperationState::PendingApproval
            && planned
                .expires_at
                .is_some_and(|expires_at| expires_at <= chrono::Utc::now())
        {
            OperationState::Expired
        } else {
            planned.state
        };
        // Final receipts remain inspectable after restart, but every state that
        // could still approve or execute stays bound to the creating runtime.
        if !state.is_terminal() && planned.runtime_id != self.operation.runtime_id() {
            return Err(AppError::Blocked {
                reason: "the Agent proposal does not match this Desktop session".into(),
            });
        }
        let affected = if state == OperationState::Succeeded {
            self.operation
                .succeeded_row_count(operation_id.into())
                .await?
        } else {
            None
        };
        Ok(DesktopSqlApprovalReview {
            operation_id,
            connection_id,
            payload_hash: planned.payload_hash,
            state,
            risk_level: planned.risk_level,
            sql: payload.sql,
            database: payload.database,
            namespace: payload.namespace,
            affected,
            expires_at: planned.expires_at,
        })
    }

    pub(crate) async fn shutdown_manual_transactions(&self) {
        self.manual_transactions.shutdown().await;
    }

    pub(crate) async fn list_query_service_sessions(
        &self,
        expected_workspace_id: uuid::Uuid,
        expected_account_scope: &str,
    ) -> crate::error::AppResult<Vec<serde_json::Value>> {
        self.store
            .list_query_service_sessions(expected_workspace_id, expected_account_scope)
            .await
    }

    pub(crate) async fn save_query_service_session(
        &self,
        expected_workspace_id: uuid::Uuid,
        expected_account_scope: &str,
        snapshot: serde_json::Value,
    ) -> crate::error::AppResult<()> {
        let snapshot = validate_query_service_session_snapshot(snapshot)?;
        self.store
            .save_query_service_session(expected_workspace_id, expected_account_scope, snapshot)
            .await
    }

    pub(crate) fn reserve_pending_desktop_sql_stream(
        &self,
        owner_webview: String,
        capability: String,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        self.desktop_streams
            .reserve_pending(owner_webview, capability)
    }

    pub(crate) fn reserve_pending_desktop_sql_page(
        &self,
        owner_webview: String,
        capability: String,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        self.desktop_streams
            .reserve_pending_ephemeral(owner_webview, capability)
    }

    pub(crate) fn reserve_desktop_sql_stream(
        &self,
        operation_id: OperationId,
        owner_webview: String,
        capability: String,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        self.desktop_streams
            .reserve(operation_id, owner_webview, capability)
    }

    pub(crate) async fn inspect_desktop_sql(
        &self,
        request: DesktopSqlInspectionRequest,
    ) -> Result<DesktopSqlInspectionReceipt, DesktopSqlInspectionError> {
        self.application.inspect_desktop_sql(request).await
    }

    pub(crate) async fn propose_desktop_sql(
        &self,
        request: DesktopSqlProposalRequest,
    ) -> Result<DesktopSqlProposalReceipt, DesktopSqlInspectionError> {
        self.application.propose_desktop_sql(request).await
    }

    pub(crate) async fn propose_terminal_sql(
        &self,
        request: TerminalSqlProposalRequest,
    ) -> Result<DesktopSqlProposalReceipt, DesktopSqlInspectionError> {
        self.application.propose_terminal_sql(request).await
    }

    pub(crate) async fn run_desktop_sql(
        &self,
        operation_id: OperationId,
    ) -> Result<DesktopSqlRunReceipt, DesktopSqlRunError> {
        self.application.run_desktop_sql(operation_id).await
    }

    pub(crate) async fn run_desktop_sql_stream<F>(
        &self,
        operation_id: OperationId,
        owner_webview: String,
        capability: String,
        emit: F,
    ) -> Result<DesktopSqlStreamReceipt, DesktopSqlRunError>
    where
        F: FnMut(DesktopSqlStreamReady) -> Result<(), DesktopSqlStreamSinkError> + Send,
    {
        let result = self
            .application
            .run_desktop_sql_stream(operation_id, owner_webview, capability, emit)
            .await;
        if result.is_err() {
            // Transport reserves before the future reaches the durable claim so
            // an authorization/policy failure cannot strand a pre-ready credit.
            self.desktop_streams.close(operation_id);
            self.cancel_unstarted_desktop_read(operation_id).await;
        }
        result
    }

    /// Plan and consume a safe desktop read without a frontend proposal/run gap.
    pub(crate) async fn run_desktop_sql_read_stream<F>(
        &self,
        request: DesktopSqlProposalRequest,
        owner_webview: String,
        capability: String,
        emit: F,
    ) -> crate::error::AppResult<DesktopSqlStreamReceipt>
    where
        F: FnMut(DesktopSqlStreamReady) -> Result<(), DesktopSqlStreamSinkError> + Send,
    {
        self.run_desktop_sql_read_stream_after_proposal(
            request,
            owner_webview,
            capability,
            emit,
            |_| std::future::ready(()),
        )
        .await
    }

    /// The proposal is durable before its pending transport capability is
    /// bound. Keeping this hook local makes that handoff explicit: every
    /// failure in the gap must finish the ready operation before returning.
    async fn run_desktop_sql_read_stream_after_proposal<F, H, Future>(
        &self,
        request: DesktopSqlProposalRequest,
        owner_webview: String,
        capability: String,
        emit: F,
        after_proposal: H,
    ) -> crate::error::AppResult<DesktopSqlStreamReceipt>
    where
        F: FnMut(DesktopSqlStreamReady) -> Result<(), DesktopSqlStreamSinkError> + Send,
        H: FnOnce(OperationId) -> Future + Send,
        Future: std::future::Future<Output = ()> + Send,
    {
        #[cfg(feature = "packaged-benchmark")]
        let benchmark_started = std::time::Instant::now();
        let proposal = self
            .application
            .propose_desktop_sql(request)
            .await
            .map_err(DesktopSqlInspectionError::into_error)?;
        if proposal.approval_required || !proposal.auto_run {
            // The atomic helper owns a pending capability before planning, but
            // it cannot return an explicit-workflow proposal ID. Release that
            // capability and terminalize the durable plan rather than leaving
            // an unreachable Ready/PendingApproval operation executable.
            self.forget_pending_desktop_sql_stream(&capability, &owner_webview);
            self.cancel_unstarted_desktop_read(proposal.operation_id)
                .await;
            // This typed signal is deliberately emitted only for an actual
            // read: planning completed but it has not claimed a connection,
            // emitted a batch, or touched the target. A write/DDL submitted to
            // this endpoint remains a generic block and can never trigger the
            // frontend's read fallback.
            return Err(
                if proposal.classification.kind == crate::model::QueryKind::Read {
                    crate::error::AppError::ProposalRequired
                } else {
                    crate::error::AppError::Blocked {
                        reason: "this SQL statement requires the explicit proposal workflow".into(),
                    }
                },
            );
        }
        after_proposal(proposal.operation_id).await;
        if let Err(error) = self.desktop_streams.bind_pending(
            proposal.operation_id,
            owner_webview.clone(),
            capability.clone(),
        ) {
            self.cancel_unstarted_desktop_read(proposal.operation_id)
                .await;
            // The existing invoke contract reports the binding failure, even
            // though the durable plan is now safely terminal as well.
            return Err(crate::error::AppError::Safety(error.to_string()));
        }
        #[cfg(feature = "packaged-benchmark")]
        let execution_offset_ms = benchmark_started.elapsed().as_millis() as u64;
        let receipt = self
            .run_desktop_sql_stream(proposal.operation_id, owner_webview, capability, emit)
            .await
            .map_err(DesktopSqlRunError::into_error)?;
        #[cfg(feature = "packaged-benchmark")]
        let receipt = {
            let mut receipt = receipt;
            receipt.offset_benchmark_stages(execution_offset_ms);
            receipt
        };
        Ok(receipt)
    }

    /// Release a proposal that never reached target execution. `Ready` can
    /// transition directly to `Cancelled`; an unexpected concurrent claim is
    /// conservatively marked `OutcomeUnknown` after executor cancellation so
    /// it never remains executable or silently resumes.
    async fn cancel_unstarted_desktop_read(&self, operation_id: OperationId) {
        self.desktop_streams.close(operation_id);
        crate::executor::cancel::cancel(operation_id.into());
        let cancelled = self
            .operation
            .cancel_before_execution(
                operation_id.into(),
                &serde_json::json!({"reason":"desktop_stream_cancelled_before_execution"}),
            )
            .await;
        if cancelled.is_ok() {
            return;
        }

        // A terminal record proves another path already completed ownership.
        let Ok(record) = self.operation.get(operation_id.into()).await else {
            return;
        };
        if record.state.is_terminal() {
            return;
        }

        // The only legal route to OutcomeUnknown is from Executing. Claiming a
        // still-ready operation here performs no target I/O and makes the
        // otherwise unprovable cancellation durable rather than stranding it.
        if record.state == OperationState::Ready {
            let _ = self.operation.claim(operation_id.into()).await;
        }
        let _ = self
            .operation
            .mark_outcome_unknown(
                operation_id.into(),
                &serde_json::json!({"reason":"desktop_stream_pre_execution_cancel_unconfirmed"}),
            )
            .await;
    }

    pub(crate) async fn plan_terminal_read(
        &self,
        request: TerminalQueryPlanRequest,
    ) -> Result<AgentQueryPlanReceipt, AgentQueryPlanError> {
        self.application.plan_terminal_read(request).await
    }

    pub(crate) async fn prepare_terminal_run(
        &self,
        plan_id: OperationId,
        authority: &TerminalAuthority,
    ) -> Result<PreparedAgentQueryRun, AgentQueryRunPrepareError> {
        self.application
            .prepare_terminal_run(plan_id, authority)
            .await
    }

    /// Feature-owned ACK gate for one desktop result-stream operation.
    pub(crate) fn acknowledge_desktop_sql_stream(
        &self,
        operation_id: OperationId,
        sequence: u64,
        capability: &str,
        owner_webview: &str,
    ) -> bool {
        self.desktop_streams
            .acknowledge(operation_id, sequence, capability, owner_webview)
    }

    pub(crate) fn pull_desktop_sql_stream(
        &self,
        operation_id: OperationId,
        sequence: u64,
        capability: &str,
        owner_webview: &str,
    ) -> Option<DesktopSqlStreamBatch> {
        self.desktop_streams
            .pull(operation_id, sequence, capability, owner_webview)
    }

    /// Cancels a blocked stream and releases its ACK state before the executor
    /// observes the operation cancellation signal.
    pub(crate) fn cancel_desktop_sql_stream(
        &self,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> bool {
        let cancelled = self
            .desktop_streams
            .cancel(operation_id, capability, owner_webview);
        if cancelled {
            crate::executor::cancel::cancel(operation_id.into());
        }
        cancelled
    }

    pub(crate) fn cancel_pending_desktop_sql_stream(
        &self,
        capability: &str,
        owner_webview: &str,
    ) -> bool {
        self.desktop_streams
            .cancel_pending(capability, owner_webview)
    }

    pub(crate) fn forget_pending_desktop_sql_stream(&self, capability: &str, owner_webview: &str) {
        self.desktop_streams
            .forget_pending(capability, owner_webview);
    }

    async fn authorize_desktop_sql_result(
        &self,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> crate::error::AppResult<adapters::DesktopSqlResultAuthority> {
        let authority =
            self.desktop_streams
                .result_authority(operation_id, capability, owner_webview)?;
        let pin = self
            .store
            .pin_connection_for_read(authority.connection_id)
            .await?;
        if pin.scope.workspace_id != authority.workspace_id
            || pin.scope.account_scope.storage_key() != authority.account_scope
            || pin.connection_revision != authority.connection_revision
            || !pin.profile.workspace_access.can_read()
        {
            return Err(crate::error::AppError::Blocked {
                reason: "SQL result authority changed; run the query again".into(),
            });
        }
        Ok(authority)
    }

    pub(crate) async fn read_desktop_sql_result_page(
        &self,
        operation_id: OperationId,
        sequence: u64,
        capability: &str,
        owner_webview: &str,
    ) -> crate::error::AppResult<DesktopSqlStreamBatch> {
        let authority = self
            .authorize_desktop_sql_result(operation_id, capability, owner_webview)
            .await?;
        if sequence as usize >= authority.page_count {
            return Err(crate::error::AppError::NotFound("SQL result page".into()));
        }
        let page = self.desktop_streams.read_result_page(
            operation_id,
            sequence,
            capability,
            owner_webview,
        )?;
        if page.columns != authority.columns {
            return Err(crate::error::AppError::OutcomeUnknown(
                "stored SQL result columns changed".into(),
            ));
        }
        Ok(page)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn export_desktop_sql_result<F>(
        &self,
        export_id: uuid::Uuid,
        operation_id: OperationId,
        capability: String,
        owner_webview: String,
        format: DesktopSqlResultExportFormat,
        destination: std::path::PathBuf,
        progress: F,
    ) -> crate::error::AppResult<DesktopSqlResultExportReceipt>
    where
        F: FnMut(DesktopSqlResultExportProgress) -> crate::error::AppResult<()> + Send + 'static,
    {
        let cancelled = self.desktop_streams.start_result_export(
            export_id,
            operation_id,
            &capability,
            &owner_webview,
        )?;
        // Register the exact export before the first await so a cancellation
        // cannot race ahead of connection-revision reauthorization.
        if let Err(error) = self
            .authorize_desktop_sql_result(operation_id, &capability, &owner_webview)
            .await
        {
            self.desktop_streams.finish_result_export(export_id);
            return Err(error);
        }
        let streams = self.desktop_streams.clone();
        let joined = tokio::task::spawn_blocking(move || {
            streams.export_result_to_path(
                export_id,
                operation_id,
                &capability,
                &owner_webview,
                format,
                destination,
                cancelled,
                progress,
            )
        })
        .await;
        self.desktop_streams.finish_result_export(export_id);
        joined.map_err(|_| {
            crate::error::AppError::Config("SQL result export worker stopped".into())
        })?
    }

    pub(crate) fn cancel_desktop_sql_result_export(
        &self,
        export_id: uuid::Uuid,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> bool {
        self.desktop_streams.cancel_result_export(
            export_id,
            operation_id,
            capability,
            owner_webview,
        )
    }
}

pub(crate) fn compose(
    store: Store,
    connections: ConnectionManager,
    operation: OperationRuntime,
) -> QueriesFeature {
    let desktop_streams = DesktopSqlStreamRegistry::default();
    let desktop_stream_cleanup = DesktopStreamCleanupRuntime::default();
    let desktop_stream_cleanup_owner = desktop_stream_cleanup.composition_owner();
    let manual_transactions = ManualTransactionRuntime::new(store.clone(), connections.clone());
    let manual_transaction_revocation_port: std::sync::Arc<
        dyn crate::connection::ConnectionSessionRevocationPort,
    > = std::sync::Arc::new(manual_transactions.clone());
    connections.register_session_revocation_port(std::sync::Arc::clone(
        &manual_transaction_revocation_port,
    ));
    let adapter = QueryPlatformAdapter::new(
        store.clone(),
        connections,
        operation.clone(),
        desktop_streams.clone(),
        desktop_stream_cleanup.clone(),
        manual_transactions.clone(),
    );
    QueriesFeature {
        application: QueryUseCases::new(adapter),
        operation,
        desktop_streams,
        desktop_stream_cleanup,
        _desktop_stream_cleanup_owner: desktop_stream_cleanup_owner,
        manual_transactions,
        store,
        _manual_transaction_revocation_port: manual_transaction_revocation_port,
    }
}
