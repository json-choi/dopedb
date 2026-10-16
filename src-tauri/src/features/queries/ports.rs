//! Ports through which SQL query use cases reach platform adapters.

use std::future::Future;

use crate::kernel::identity::OperationId;
use crate::kernel::TerminalAuthority;

use super::domain::{
    DesktopSqlInspectionRequest, DesktopSqlProposalRequest, DesktopSqlStreamReady,
    DesktopSqlStreamSinkError, TerminalQueryPlanRequest, TerminalSqlProposalRequest,
};

pub(crate) trait TerminalQueryPort: Clone + Send + Sync + 'static {
    type PlanReceipt: Send;
    type PreparedRun: Send;
    type PlanError: Send;
    type PrepareError: Send;

    fn plan_terminal_read(
        &self,
        request: TerminalQueryPlanRequest,
    ) -> impl Future<Output = Result<Self::PlanReceipt, Self::PlanError>> + Send;

    fn prepare_terminal_run(
        &self,
        plan_id: OperationId,
        authority: &TerminalAuthority,
    ) -> impl Future<Output = Result<Self::PreparedRun, Self::PrepareError>> + Send;
}

/// Platform boundary for desktop and Terminal SQL proposal operations.
///
/// Requests use pure feature contracts; lease-backed receipts and platform error
/// representations remain associated adapter outputs.
pub(crate) trait DesktopQueryPort: Clone + Send + Sync + 'static {
    type InspectionReceipt: Send;
    type ProposalReceipt: Send;
    type RunReceipt: Send;
    type StreamReceipt: Send;
    type InspectionError: Send;
    type RunError: Send;

    fn inspect_desktop_sql(
        &self,
        request: DesktopSqlInspectionRequest,
    ) -> impl Future<Output = Result<Self::InspectionReceipt, Self::InspectionError>> + Send;

    fn propose_desktop_sql(
        &self,
        request: DesktopSqlProposalRequest,
    ) -> impl Future<Output = Result<Self::ProposalReceipt, Self::InspectionError>> + Send;

    /// Plan an auto-run read for the atomic stream helper without a target preview.
    fn propose_desktop_auto_read(
        &self,
        request: DesktopSqlProposalRequest,
    ) -> impl Future<Output = Result<Self::ProposalReceipt, Self::InspectionError>> + Send;

    fn propose_terminal_sql(
        &self,
        request: TerminalSqlProposalRequest,
    ) -> impl Future<Output = Result<Self::ProposalReceipt, Self::InspectionError>> + Send;

    fn run_desktop_sql(
        &self,
        operation_id: OperationId,
    ) -> impl Future<Output = Result<Self::RunReceipt, Self::RunError>> + Send;

    fn run_desktop_sql_stream<F>(
        &self,
        operation_id: OperationId,
        owner_webview: String,
        capability: String,
        emit: F,
    ) -> impl Future<Output = Result<Self::StreamReceipt, Self::RunError>> + Send
    where
        F: FnMut(DesktopSqlStreamReady) -> Result<(), DesktopSqlStreamSinkError> + Send;
}
