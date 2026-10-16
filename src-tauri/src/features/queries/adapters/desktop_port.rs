//! Desktop query port implementation backed by the local platform adapter.

use super::super::domain::{
    DesktopSqlInspectionRequest, DesktopSqlProposalRequest, DesktopSqlStreamReady,
    DesktopSqlStreamSinkError, TerminalSqlProposalRequest,
};
use super::super::ports::DesktopQueryPort;
use super::desktop_contracts::{
    DesktopSqlInspectionError, DesktopSqlInspectionReceipt, DesktopSqlProposalReceipt,
    DesktopSqlRunError, DesktopSqlRunReceipt, DesktopSqlStreamReceipt,
};
use super::platform::QueryPlatformAdapter;
use crate::kernel::identity::OperationId;

impl DesktopQueryPort for QueryPlatformAdapter {
    type InspectionReceipt = DesktopSqlInspectionReceipt;
    type ProposalReceipt = DesktopSqlProposalReceipt;
    type RunReceipt = DesktopSqlRunReceipt;
    type StreamReceipt = DesktopSqlStreamReceipt;
    type InspectionError = DesktopSqlInspectionError;
    type RunError = DesktopSqlRunError;

    async fn inspect_desktop_sql(
        &self,
        request: DesktopSqlInspectionRequest,
    ) -> Result<Self::InspectionReceipt, Self::InspectionError> {
        QueryPlatformAdapter::inspect_desktop_sql(self, request).await
    }

    async fn propose_desktop_sql(
        &self,
        request: DesktopSqlProposalRequest,
    ) -> Result<Self::ProposalReceipt, Self::InspectionError> {
        QueryPlatformAdapter::propose_desktop_sql(self, request).await
    }

    async fn propose_desktop_auto_read(
        &self,
        request: DesktopSqlProposalRequest,
    ) -> Result<Self::ProposalReceipt, Self::InspectionError> {
        QueryPlatformAdapter::propose_desktop_auto_read(self, request).await
    }

    async fn propose_terminal_sql(
        &self,
        request: TerminalSqlProposalRequest,
    ) -> Result<Self::ProposalReceipt, Self::InspectionError> {
        QueryPlatformAdapter::propose_terminal_sql(self, request).await
    }

    async fn run_desktop_sql(
        &self,
        operation_id: OperationId,
    ) -> Result<Self::RunReceipt, Self::RunError> {
        QueryPlatformAdapter::run_desktop_sql(self, operation_id).await
    }

    async fn run_desktop_sql_stream<F>(
        &self,
        operation_id: OperationId,
        owner_webview: String,
        capability: String,
        emit: F,
    ) -> Result<Self::StreamReceipt, Self::RunError>
    where
        F: FnMut(DesktopSqlStreamReady) -> Result<(), DesktopSqlStreamSinkError> + Send,
    {
        QueryPlatformAdapter::run_desktop_sql_stream(
            self,
            operation_id,
            owner_webview,
            capability,
            emit,
        )
        .await
    }
}
