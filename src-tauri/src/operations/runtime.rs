//! Process-wide Operation Runtime facade. It owns the runtime identity and is the
//! only production path that can turn an immutable stored plan into an opaque
//! execution grant.

use std::sync::{Arc, OnceLock};

use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;

use super::execute::{self, ExecutionGrant};
use super::model::{
    NewOperation, OperationApprovalCommand, OperationApprovalDecision, OperationApprover,
    OperationRecord, RestartRecoveryReport,
};
use super::repository::OperationRepository;
use super::{OperationActorKind, OperationState};
use crate::error::{AppError, AppResult};
use crate::store::Store;

/// Stable reason for an Agent proposal whose proposing session no longer holds
/// its exact grant. The Desktop maps it to localized copy.
pub(crate) const AGENT_SESSION_REVOKED: &str = "agent_session_revoked";

/// Answers whether the Agent session that created a proposal still holds its
/// exact grant. The runtime consults it when a proposal is approved and again
/// when its execution is claimed; the Broker session registry provides it.
pub(crate) trait AgentSessionLiveness: Send + Sync {
    fn is_live(&self, terminal_session_id: Uuid) -> bool;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OperationPlanDisposition {
    Ready,
    ApprovalRequired,
}

pub(crate) struct ExactApprovalRequest {
    pub operation_id: Uuid,
    pub expected_payload_hash: String,
    pub approver: OperationApprover,
    pub current_policy_revision: String,
    pub reason: Option<String>,
}

pub(crate) struct ClaimedOperation {
    record: OperationRecord,
    grant: ExecutionGrant,
}

impl ClaimedOperation {
    pub(crate) fn record(&self) -> &OperationRecord {
        &self.record
    }

    pub(crate) fn grant(&self) -> &ExecutionGrant {
        &self.grant
    }
}

/// Opaque capability held by the desktop composition root, never by CLI/Agent
/// adapters. It intentionally implements no serialization, cloning, or defaulting.
pub(crate) struct LocalApprovalAuthority {
    runtime_id: Uuid,
}

#[derive(Clone)]
pub(crate) struct OperationRuntime {
    runtime_id: Uuid,
    repository: OperationRepository,
    /// Shared by every clone: bound once by the Broker when it starts.
    agent_sessions: Arc<OnceLock<Arc<dyn AgentSessionLiveness>>>,
}

impl OperationRuntime {
    pub(crate) fn new(store: &Store) -> (Self, LocalApprovalAuthority) {
        let runtime_id = Uuid::new_v4();
        (
            Self {
                runtime_id,
                repository: OperationRepository::new(store),
                agent_sessions: Arc::new(OnceLock::new()),
            },
            LocalApprovalAuthority { runtime_id },
        )
    }

    pub(crate) const fn runtime_id(&self) -> Uuid {
        self.runtime_id
    }

    /// Bind the Broker's live session registry. Until bound (tests, or before the
    /// Broker starts) no Agent session exists that could need it.
    pub(crate) fn bind_agent_session_liveness(&self, liveness: Arc<dyn AgentSessionLiveness>) {
        let _ = self.agent_sessions.set(liveness);
    }

    /// True when an Agent proposal's session no longer holds its exact grant.
    pub(crate) fn proposing_session_revoked(&self, record: &OperationRecord) -> bool {
        let (Some(terminal_session_id), Some(liveness)) =
            (record.terminal_session_id, self.agent_sessions.get())
        else {
            return false;
        };
        record.actor.kind == OperationActorKind::Agent && !liveness.is_live(terminal_session_id)
    }

    /// The human reason recorded with a rejection, if one was given.
    pub(crate) async fn rejection_reason(&self, operation_id: Uuid) -> AppResult<Option<String>> {
        self.repository.rejection_reason(operation_id).await
    }

    pub(crate) async fn recover_previous_runtimes(&self) -> AppResult<RestartRecoveryReport> {
        self.repository
            .recover_previous_runtimes(self.runtime_id)
            .await
    }

    pub(crate) async fn plan(
        &self,
        operation: NewOperation,
        disposition: OperationPlanDisposition,
    ) -> AppResult<OperationRecord> {
        if operation.kind.may_mutate_target()
            && disposition != OperationPlanDisposition::ApprovalRequired
        {
            return Err(AppError::Blocked {
                reason: "target-mutating operations always require an exact approval".into(),
            });
        }
        let planned = self
            .repository
            .insert_planned(self.runtime_id, operation)
            .await?;
        if planned.state != OperationState::Planned {
            return Ok(planned);
        }
        let target = match disposition {
            OperationPlanDisposition::Ready => OperationState::Ready,
            OperationPlanDisposition::ApprovalRequired => OperationState::PendingApproval,
        };
        self.repository
            .transition(
                planned.id,
                self.runtime_id,
                target,
                &serde_json::json!({"disposition": disposition_str(disposition)}),
            )
            .await
    }

    pub(crate) async fn get(&self, operation_id: Uuid) -> AppResult<OperationRecord> {
        self.repository.get(operation_id).await
    }

    pub(crate) async fn succeeded_row_count(&self, operation_id: Uuid) -> AppResult<Option<u64>> {
        self.repository.succeeded_row_count(operation_id).await
    }

    pub(crate) async fn approve_exact(
        &self,
        authority: &LocalApprovalAuthority,
        request: ExactApprovalRequest,
    ) -> AppResult<OperationRecord> {
        self.ensure_local_approval_authority(authority)?;
        self.decide_exact(request, OperationApprovalDecision::Approved)
            .await
    }

    pub(crate) async fn reject_exact(
        &self,
        authority: &LocalApprovalAuthority,
        request: ExactApprovalRequest,
    ) -> AppResult<OperationRecord> {
        self.ensure_local_approval_authority(authority)?;
        self.decide_exact(request, OperationApprovalDecision::Rejected)
            .await
    }

    async fn decide_exact(
        &self,
        request: ExactApprovalRequest,
        decision: OperationApprovalDecision,
    ) -> AppResult<OperationRecord> {
        self.repository
            .decide_approval(OperationApprovalCommand {
                operation_id: request.operation_id,
                runtime_id: self.runtime_id,
                expected_payload_hash: request.expected_payload_hash,
                approver: request.approver,
                decision,
                reason: request.reason,
                current_policy_revision: request.current_policy_revision,
                now: Utc::now(),
            })
            .await
    }

    fn ensure_local_approval_authority(&self, authority: &LocalApprovalAuthority) -> AppResult<()> {
        if authority.runtime_id == self.runtime_id {
            Ok(())
        } else {
            Err(AppError::Blocked {
                reason: "approval authority belongs to a different application runtime".into(),
            })
        }
    }

    /// Claim by id only. The repository reloads the immutable payload and uses its
    /// own hash in the CAS; callers never resend SQL, connection, or approval.
    pub(crate) async fn claim(&self, operation_id: Uuid) -> AppResult<ClaimedOperation> {
        // An approved Agent proposal executes only while the session that
        // proposed it still holds its exact grant: checked before the claim and
        // again after it, so a revocation in between never reaches the target.
        if self.agent_sessions.get().is_some() {
            let current = self.repository.get(operation_id).await?;
            if self.proposing_session_revoked(&current) {
                if !current.state.is_terminal() && current.state != OperationState::Executing {
                    let _ = self
                        .finish(
                            operation_id,
                            OperationState::Cancelled,
                            &json!({ "origin": AGENT_SESSION_REVOKED }),
                        )
                        .await;
                }
                return Err(AppError::Blocked {
                    reason: AGENT_SESSION_REVOKED.into(),
                });
            }
        }
        let record = self
            .repository
            .claim_execution(operation_id, self.runtime_id, Utc::now())
            .await?;
        if self.proposing_session_revoked(&record) {
            let _ = self
                .finish(
                    operation_id,
                    OperationState::Cancelled,
                    &json!({ "origin": AGENT_SESSION_REVOKED, "phase": "claimed" }),
                )
                .await;
            return Err(AppError::Blocked {
                reason: AGENT_SESSION_REVOKED.into(),
            });
        }
        let grant = execute::issue(&record)?;
        Ok(ClaimedOperation { record, grant })
    }

    /// Reissue an in-process capability for an executing import/export only after
    /// the Job Engine has independently validated its durable checkpoint and exact
    /// operation payload hash.
    pub(crate) async fn resume_job_claim(
        &self,
        operation_id: Uuid,
        expected_payload_hash: &str,
    ) -> AppResult<ClaimedOperation> {
        let record = self
            .repository
            .rebind_resumable_execution(operation_id, self.runtime_id, expected_payload_hash)
            .await?;
        let grant = execute::issue(&record)?;
        Ok(ClaimedOperation { record, grant })
    }

    /// Reissue an execution capability for one provider action only after the
    /// provisioning owner has independently validated its durable receipt,
    /// exact target, plan hash, and last completed checkpoint.
    pub(crate) async fn resume_provider_claim(
        &self,
        operation_id: Uuid,
        expected_payload_hash: &str,
    ) -> AppResult<ClaimedOperation> {
        let record = self
            .repository
            .rebind_provider_execution(operation_id, self.runtime_id, expected_payload_hash)
            .await?;
        let grant = execute::issue(&record)?;
        Ok(ClaimedOperation { record, grant })
    }

    /// Close an interrupted provider action whose durable provisioning receipt
    /// cannot be validated. No execution grant is issued and the operation is
    /// atomically rebound only to record the fail-closed outcome.
    pub(crate) async fn quarantine_provider_execution(
        &self,
        operation_id: Uuid,
        expected_payload_hash: &str,
        reason: &'static str,
    ) -> AppResult<OperationRecord> {
        self.repository
            .quarantine_provider_execution(
                operation_id,
                self.runtime_id,
                expected_payload_hash,
                reason,
            )
            .await
    }

    pub(crate) async fn rebind_pending_job(
        &self,
        operation_id: Uuid,
        expected_payload_hash: &str,
    ) -> AppResult<OperationRecord> {
        self.repository
            .rebind_pending_job(operation_id, self.runtime_id, expected_payload_hash)
            .await
    }

    pub(crate) async fn rebind_paused_job(
        &self,
        operation_id: Uuid,
        expected_payload_hash: &str,
    ) -> AppResult<OperationRecord> {
        self.repository
            .rebind_paused_job(operation_id, self.runtime_id, expected_payload_hash)
            .await
    }

    pub(crate) async fn fail_interrupted_export(
        &self,
        operation_id: Uuid,
        expected_payload_hash: &str,
    ) -> AppResult<OperationRecord> {
        let rebound = self
            .repository
            .rebind_resumable_execution(operation_id, self.runtime_id, expected_payload_hash)
            .await?;
        if rebound.kind != dopedb_protocol::OperationKind::Export {
            return Err(AppError::Blocked {
                reason: "only an interrupted export can use export recovery".into(),
            });
        }
        self.fail(
            operation_id,
            &serde_json::json!({"reason": "non_resumable_export_interrupted"}),
        )
        .await
    }

    pub(crate) async fn progress(&self, operation_id: Uuid, details: &Value) -> AppResult<()> {
        self.repository
            .append_progress(operation_id, self.runtime_id, details)
            .await
    }

    pub(crate) async fn succeed(
        &self,
        operation_id: Uuid,
        details: &Value,
    ) -> AppResult<OperationRecord> {
        self.finish(operation_id, OperationState::Succeeded, details)
            .await
    }

    pub(crate) async fn fail(
        &self,
        operation_id: Uuid,
        details: &Value,
    ) -> AppResult<OperationRecord> {
        self.finish(operation_id, OperationState::Failed, details)
            .await
    }

    pub(crate) async fn confirm_cancelled(
        &self,
        operation_id: Uuid,
        details: &Value,
    ) -> AppResult<OperationRecord> {
        self.finish(operation_id, OperationState::Cancelled, details)
            .await
    }

    /// Cancel a plan that has not been claimed for execution. Callers must signal
    /// the executor instead when the current state is `executing`.
    pub(crate) async fn cancel_before_execution(
        &self,
        operation_id: Uuid,
        details: &Value,
    ) -> AppResult<OperationRecord> {
        self.finish(operation_id, OperationState::Cancelled, details)
            .await
    }

    pub(crate) async fn mark_outcome_unknown(
        &self,
        operation_id: Uuid,
        details: &Value,
    ) -> AppResult<OperationRecord> {
        self.finish(operation_id, OperationState::OutcomeUnknown, details)
            .await
    }

    async fn finish(
        &self,
        operation_id: Uuid,
        target: OperationState,
        details: &Value,
    ) -> AppResult<OperationRecord> {
        self.repository
            .transition(operation_id, self.runtime_id, target, details)
            .await
    }

    #[cfg(test)]
    pub(crate) async fn events(
        &self,
        operation_id: Uuid,
    ) -> AppResult<Vec<super::model::OperationEventRecord>> {
        self.repository.events(operation_id).await
    }

    #[cfg(test)]
    pub(crate) async fn verify_event_chain(&self, operation_id: Uuid) -> AppResult<bool> {
        self.repository.verify_event_chain(operation_id).await
    }
}

const fn disposition_str(value: OperationPlanDisposition) -> &'static str {
    match value {
        OperationPlanDisposition::Ready => "ready",
        OperationPlanDisposition::ApprovalRequired => "approval_required",
    }
}
