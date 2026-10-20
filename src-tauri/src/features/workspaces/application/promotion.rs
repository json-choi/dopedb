//! Promotion of existing team-local connections to team connections.
//!
//! A connection created in a team workspace before every team connection was shared stays on
//! the device that made it. Each time memberships are synchronized, that creator device
//! publishes its own rows once: the connection keeps its id and credential binding, so
//! nothing that references it moves. Only the creating account on its own device publishes,
//! SQLite files are never listed, and a failed row is retried later, never reported with
//! backend text.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::features::connections::ConnectionCredentialVault;
use crate::kernel::identity::{AccountId, ConnectionId};

use super::super::domain::{can_create_team_connection, ConnectionPromotionStatus};
use super::super::ports::{
    WorkspaceConfigurationPort, WorkspaceControlPlanePort, WorkspaceRepositoryPort,
    WorkspaceRuntimePort,
};
use super::{WorkspaceConnectionPublishRequest, WorkspaceUseCases};

/// A transient failure retries on the next synchronization soon; a refusal waits longer.
const TRANSIENT_RETRY: Duration = Duration::from_secs(60);
const REFUSED_RETRY: Duration = Duration::from_secs(10 * 60);

/// Why a team-local connection is still only on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PromotionBlock {
    RoleDenied,
    Unreachable,
    Refused,
}

/// What the person can be told about promotion: connections shared since launch and the
/// reason each remaining local connection waits. Connection ids never leave this struct.
#[derive(Debug, Default)]
pub(crate) struct PromotionState {
    promoted: usize,
    blocked: HashMap<ConnectionId, PromotionBlock>,
}

impl PromotionState {
    fn status(&self) -> ConnectionPromotionStatus {
        let count = |reason| {
            self.blocked
                .values()
                .filter(|block| **block == reason)
                .count()
        };
        ConnectionPromotionStatus {
            promoted: self.promoted,
            role_denied: count(PromotionBlock::RoleDenied),
            unreachable: count(PromotionBlock::Unreachable),
            refused: count(PromotionBlock::Refused),
        }
    }
}

/// Closed outcome counts of one promotion pass. Nothing identifying is kept.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct PromotionReport {
    pub(crate) promoted: usize,
    /// The account's role is below editor, so it cannot add team connections.
    pub(crate) role_denied: usize,
    /// The workspace service or the session was unreachable; retried on the next pass.
    pub(crate) unreachable: usize,
    /// The service or this device refused the connection as it is; retried much later.
    pub(crate) refused: usize,
    /// Waiting out the retry delay of an earlier failure.
    pub(crate) deferred: usize,
}

impl<R, A, C, V, E, S> WorkspaceUseCases<R, A, C, V, E, S>
where
    R: WorkspaceRepositoryPort,
    A: WorkspaceRuntimePort,
    C: WorkspaceControlPlanePort,
    V: ConnectionCredentialVault + ?Sized,
    E: WorkspaceConfigurationPort,
    S: super::super::ports::WorkspaceSshProfilePort,
{
    /// Publish every team-local connection the account created in the team workspaces it can
    /// add connections to. Idempotent: a published row is no longer local, and a retried
    /// publication reuses the id the service already holds.
    pub(super) fn promotion_status(&self) -> ConnectionPromotionStatus {
        self.promotion_state
            .lock()
            .map(|state| state.status())
            .unwrap_or_default()
    }

    fn record_promotion(&self, connection_id: ConnectionId, outcome: Option<PromotionBlock>) {
        if let Ok(mut state) = self.promotion_state.lock() {
            match outcome {
                Some(block) => {
                    state.blocked.insert(connection_id, block);
                }
                None => {
                    state.blocked.remove(&connection_id);
                    state.promoted += 1;
                }
            }
        }
    }

    pub(super) async fn promote_local_connections(
        &self,
        account_user_id: &AccountId,
    ) -> PromotionReport {
        let mut report = PromotionReport::default();
        let local = match self
            .repository
            .promotable_connections(account_user_id)
            .await
        {
            Ok(local) => local,
            Err(error) => {
                tracing::warn!(
                    error_kind = error.kind(),
                    "team connection promotion could not list local connections"
                );
                return report;
            }
        };
        let listed: HashSet<ConnectionId> = local
            .iter()
            .map(|(_, profile)| ConnectionId::from(profile.id))
            .collect();
        if let Ok(mut state) = self.promotion_state.lock() {
            // A connection that was deleted or moved on is no longer waiting.
            state.blocked.retain(|id, _| listed.contains(id));
        }
        for (workspace_id, profile) in local {
            let connection_id = ConnectionId::from(profile.id);
            if self.promotion_deferred(connection_id) {
                report.deferred += 1;
                continue;
            }
            let allowed = match self.membership_role(account_user_id, workspace_id).await {
                Ok(role) => can_create_team_connection(role),
                Err(_) => false,
            };
            if !allowed {
                report.role_denied += 1;
                self.record_promotion(connection_id, Some(PromotionBlock::RoleDenied));
                continue;
            }
            match self
                .publish_connection(WorkspaceConnectionPublishRequest {
                    connection_id,
                    workspace_id,
                    account_user_id: account_user_id.clone(),
                })
                .await
            {
                Ok(_) => {
                    report.promoted += 1;
                    self.record_promotion(connection_id, None);
                }
                Err(error) => {
                    let transient = matches!(
                        error,
                        AppError::Network(_)
                            | AppError::Timeout(_)
                            | AppError::AuthenticationRequired(_)
                            | AppError::RetryLater { .. }
                    );
                    if transient {
                        report.unreachable += 1;
                        self.record_promotion(connection_id, Some(PromotionBlock::Unreachable));
                    } else {
                        report.refused += 1;
                        self.record_promotion(connection_id, Some(PromotionBlock::Refused));
                    }
                    tracing::warn!(
                        error_kind = error.kind(),
                        "team connection promotion deferred"
                    );
                    self.defer_promotion(
                        connection_id,
                        if transient {
                            TRANSIENT_RETRY
                        } else {
                            REFUSED_RETRY
                        },
                    );
                }
            }
        }
        if report != PromotionReport::default() {
            tracing::info!(
                promoted = report.promoted,
                role_denied = report.role_denied,
                unreachable = report.unreachable,
                refused = report.refused,
                deferred = report.deferred,
                "team connection promotion finished"
            );
        }
        report
    }

    fn promotion_deferred(&self, connection_id: ConnectionId) -> bool {
        self.promotion_retry_at
            .lock()
            .map(|retry| {
                retry
                    .get(&connection_id)
                    .is_some_and(|at| *at > Instant::now())
            })
            .unwrap_or(false)
    }

    fn defer_promotion(&self, connection_id: ConnectionId, delay: Duration) {
        if let Ok(mut retry) = self.promotion_retry_at.lock() {
            retry.insert(connection_id, Instant::now() + delay);
        }
    }
}
