//! Exact approval and rejection decisions.

use super::*;

impl OperationRepository {
    /// The reason a person recorded with the latest rejection of this operation.
    /// Approval rows are excluded: their reason field carries confirmation phrases.
    pub(crate) async fn rejection_reason(&self, operation_id: Uuid) -> AppResult<Option<String>> {
        let reason: Option<Option<String>> = sqlx::query_scalar(
            "SELECT reason FROM operation_approvals
             WHERE operation_id = ?1 AND decision = 'rejected'
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(operation_id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        Ok(reason.flatten().filter(|reason| !reason.trim().is_empty()))
    }

    /// Append one exact local/workspace decision and its projection transition in
    /// the same SQLite transaction. Agent, Plugin, and System actors are rejected
    /// before any approval row is written.
    pub(crate) async fn decide_approval(
        &self,
        command: OperationApprovalCommand,
    ) -> AppResult<OperationRecord> {
        if !matches!(
            command.approver.kind,
            dopedb_protocol::OperationActorKind::LocalUser
                | dopedb_protocol::OperationActorKind::WorkspaceUser
        ) || command.approver.id.trim().is_empty()
        {
            return Err(operation_conflict(
                "only an identified local or workspace user can approve an operation",
            ));
        }
        if command
            .reason
            .as_ref()
            .is_some_and(|reason| reason.len() > MAX_REQUEST_BYTES)
        {
            return Err(AppError::Config(
                "operation approval reason exceeds the local control-message limit".into(),
            ));
        }

        let _guard = self.write_lock.lock().await;
        let mut tx = self.pool.begin().await?;
        let current = fetch_operation_tx(&mut tx, command.operation_id).await?;
        ensure_runtime(&current, command.runtime_id)?;
        if current.state != OperationState::PendingApproval {
            return Err(operation_conflict(
                "the operation is not awaiting an approval decision",
            ));
        }
        if current.payload_hash != command.expected_payload_hash {
            return Err(operation_conflict(
                "the reviewed payload hash does not match the stored operation",
            ));
        }
        if current.policy_revision != command.current_policy_revision {
            return Err(operation_conflict(
                "the active safety policy changed after the operation was planned",
            ));
        }
        if current
            .expires_at
            .is_some_and(|expires_at| expires_at <= command.now)
        {
            self.transition_tx(
                &mut tx,
                &current,
                OperationState::Expired,
                &json!({"reason": "approval_expired"}),
                command.now,
            )
            .await?;
            tx.commit().await?;
            return Err(operation_conflict("the operation has expired"));
        }

        let approval_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO operation_approvals (
                id, operation_id, payload_hash, approver_kind, approver_id,
                decision, reason, policy_revision, created_at, expires_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(approval_id.to_string())
        .bind(current.id.to_string())
        .bind(&current.payload_hash)
        .bind(actor_kind_str(command.approver.kind))
        .bind(&command.approver.id)
        .bind(approval_decision_str(command.decision))
        .bind(&command.reason)
        .bind(&current.policy_revision)
        .bind(timestamp(command.now))
        .bind(current.expires_at.map(timestamp))
        .execute(&mut *tx)
        .await?;

        let target = match command.decision {
            OperationApprovalDecision::Approved => OperationState::Approved,
            OperationApprovalDecision::Rejected => OperationState::Rejected,
        };
        let updated = self
            .transition_tx(
                &mut tx,
                &current,
                target,
                &json!({
                    "approvalId": approval_id,
                    "approverId": &command.approver.id,
                    "approverKind": actor_kind_str(command.approver.kind),
                    "payloadHash": &current.payload_hash,
                    "policyRevision": &current.policy_revision,
                }),
                command.now,
            )
            .await?;
        tx.commit().await?;
        Ok(updated)
    }
}
