//! Operation-control use cases independent of concrete persistence and runtime adapters.

use std::time::Duration;

use dopedb_protocol::OperationSummary;
use uuid::Uuid;

use crate::error::AppResult;
use crate::kernel::TerminalAuthority;
use crate::operations::{LocalApprovalAuthority, RestartRecoveryReport};

use super::ports::OperationControlPort;
use super::{OperationDecisionReceipt, OperationDecisionRequest};

#[derive(Clone)]
pub(crate) struct OperationUseCases<P> {
    port: P,
}

impl<P> OperationUseCases<P>
where
    P: OperationControlPort,
{
    pub(crate) fn new(port: P) -> Self {
        Self { port }
    }

    pub(crate) async fn recover_previous_runtimes(&self) -> AppResult<RestartRecoveryReport> {
        self.port.recover_previous_runtimes().await
    }

    /// A revoked or closed Agent grant leaves nothing approvable behind.
    pub(crate) async fn cancel_revoked_agent_proposals(&self, operation_ids: Vec<Uuid>) {
        self.port
            .cancel_revoked_agent_proposals(operation_ids)
            .await;
    }

    pub(crate) async fn approve_local(
        &self,
        authority: &LocalApprovalAuthority,
        request: OperationDecisionRequest,
    ) -> AppResult<OperationDecisionReceipt> {
        self.port.approve_local(authority, request).await
    }

    pub(crate) async fn reject_local(
        &self,
        authority: &LocalApprovalAuthority,
        request: OperationDecisionRequest,
    ) -> AppResult<OperationDecisionReceipt> {
        self.port.reject_local(authority, request).await
    }

    pub(crate) async fn show_terminal(
        &self,
        scope: &TerminalAuthority,
        operation_id: Uuid,
    ) -> AppResult<OperationSummary> {
        self.port.show_terminal(scope, operation_id).await
    }

    pub(crate) async fn wait_terminal(
        &self,
        scope: &TerminalAuthority,
        operation_id: Uuid,
        timeout: Duration,
    ) -> AppResult<OperationSummary> {
        self.port.wait_terminal(scope, operation_id, timeout).await
    }

    pub(crate) async fn cancel_terminal(
        &self,
        scope: &TerminalAuthority,
        operation_id: Uuid,
    ) -> AppResult<OperationSummary> {
        self.port.cancel_terminal(scope, operation_id).await
    }
}
