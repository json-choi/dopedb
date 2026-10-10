//! Authority re-verification for manual transactions. A session keeps only the
//! retention of its authorized pool, not the workspace scope gate, so every
//! statement and the COMMIT re-pin the connection and compare it with the
//! authority that opened the session: workspace, account, scope generation,
//! member binding, and a shared connection's revision. A stale session is rolled
//! back. COMMIT additionally re-checks the device Safety write gate and refuses,
//! keeping the transaction open, when data changes were turned off.

use super::*;

use crate::model::WorkspaceConnectionAccess;

/// Whether a freshly pinned connection still carries the authority that opened
/// the session: same workspace, account, and scope generation (any switch or
/// membership change), same member binding, and — for shared connections, whose
/// revision moves with their template — the same connection revision. A local
/// connection's revision also moves with local metadata (schema groups, its
/// write ceiling); its material edits end sessions through profile revocation,
/// and its write gate is re-checked by every write and by COMMIT.
fn same_authority(fresh: &PinnedConnection, opened: &PinnedConnection) -> bool {
    let shared = fresh.profile.workspace_access != WorkspaceConnectionAccess::Local;
    fresh.scope == opened.scope
        && fresh.binding_revision == opened.binding_revision
        && fresh.binding_updated_at == opened.binding_updated_at
        && (!shared || fresh.connection_revision == opened.connection_revision)
        && fresh.profile.workspace_access.can_write()
}

/// The result of re-checking authority immediately before COMMIT.
enum CommitAuthority {
    Allowed,
    /// Refuse but keep the transaction open (for example, device writes are off
    /// and can be turned back on).
    Refuse(AppError),
    /// The authority that opened the session no longer holds: roll it back.
    RollBack,
}

impl ManualTransactionRuntime {
    /// Commit after re-checking the authority that opened the session and the
    /// current device Safety gate. Workspace refreshes and scope changes are
    /// excluded for the whole commit, so neither can race the check.
    pub(crate) async fn commit(
        &self,
        connection_id: Uuid,
        transaction_id: Uuid,
    ) -> AppResult<ManualTransactionStatus> {
        let admission = self.connections.begin_session_admission().await;
        let session = self.exact(connection_id, transaction_id).await?;
        let fresh = admission.pin_connection(connection_id).await;
        match self.commit_authority(fresh, &session).await {
            CommitAuthority::Allowed => {}
            CommitAuthority::Refuse(error) => return Err(error),
            CommitAuthority::RollBack => {
                self.end_session(
                    connection_id,
                    Some(Arc::clone(&session)),
                    ManualTransactionEndReason::AuthorityChanged,
                    "connection authority changed before commit",
                )
                .await;
                return Err(refused(ManualTransactionRefusal::AuthorityChanged));
            }
        }
        // A running statement keeps the session open; COMMIT never waits behind it.
        let link = session.take_for_commit()?;
        self.unmap(connection_id, &session).await;
        let status = session.status();
        match link.connection.finish(true).await {
            Ok(()) => {
                self.publish_ended(&session, ManualTransactionEndReason::Committed);
                self.record_boundary(&session, "manual_transaction:commit", "COMMIT", None)
                    .await
                    .map_err(|error| {
                        AppError::OutcomeUnknown(format!(
                            "manual transaction committed but its audit receipt failed: {error}"
                        ))
                    })?;
                Ok(status)
            }
            Err(detail) => {
                // The connection is already closed. A COMMIT that reached the
                // server may have applied, so the outcome is recorded as unknown.
                self.publish_ended(&session, ManualTransactionEndReason::CommitOutcomeUnknown);
                if let Err(error) = self
                    .record_boundary(
                        &session,
                        "manual_transaction:commit:outcome_unknown",
                        "COMMIT",
                        Some(detail.clone()),
                    )
                    .await
                {
                    tracing::warn!(
                        %connection_id,
                        %transaction_id,
                        %error,
                        "manual transaction unknown-outcome audit receipt failed"
                    );
                }
                Err(AppError::OutcomeUnknown(format!(
                    "manual transaction commit acknowledgement failed: {detail}"
                )))
            }
        }
    }

    async fn commit_authority(
        &self,
        fresh: AppResult<PinnedConnection>,
        session: &ManualSession,
    ) -> CommitAuthority {
        match fresh {
            Ok(fresh) if same_authority(&fresh, &session.pin) => {}
            // Removed from the scope, or the role can no longer read it.
            Ok(_) | Err(AppError::NotFound(_) | AppError::Blocked { .. }) => {
                return CommitAuthority::RollBack
            }
            Err(error) => return CommitAuthority::Refuse(error),
        }
        match self.store.get_safety(session.connection_id).await {
            Ok(settings) if settings.allow_writes => CommitAuthority::Allowed,
            Ok(_) => CommitAuthority::Refuse(refused(ManualTransactionRefusal::WritesDisabled)),
            Err(error) => CommitAuthority::Refuse(error),
        }
    }

    /// The open session for a statement, after re-verifying the authority that
    /// opened it. Sessions do not hold the workspace scope gate, so this check —
    /// made while the calling operation holds its own scope guard for the whole
    /// statement — is what keeps a statement (and its history/audit writes) from
    /// running after an account, workspace, membership, or connection-authority
    /// change that a revocation has not ended yet. A stale session is rolled back.
    pub(super) async fn statement_session(
        &self,
        connection_id: Uuid,
        database: &str,
    ) -> Option<AppResult<Arc<ManualSession>>> {
        let session = self.mapped(connection_id).await?;
        if session.database != database {
            return Some(Err(refused(ManualTransactionRefusal::OtherDatabase)));
        }
        let current = match self.store.pin_connection_for_read(connection_id).await {
            Ok(fresh) => same_authority(&fresh, &session.pin),
            Err(AppError::NotFound(_) | AppError::Blocked { .. }) => false,
            Err(error) => return Some(Err(error)),
        };
        if !current {
            self.end_session(
                connection_id,
                Some(Arc::clone(&session)),
                ManualTransactionEndReason::AuthorityChanged,
                "connection authority changed before a statement",
            )
            .await;
            return Some(Err(refused(ManualTransactionRefusal::AuthorityChanged)));
        }
        Some(Ok(session))
    }
}
