//! In-memory handoff between owner-local Broker requests and the Desktop approval UI.
//!
//! Besides blocking configure/start requests, it queues the SQL proposals made
//! by approved external Agent processes: those processes have no Desktop
//! transcript, so the same approval gate is their only decision surface.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use dashmap::DashMap;
use dopedb_protocol::{ExternalAgentConfig, ExternalAgentProvider, OperationState};
use serde::Serialize;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::identity::TerminalSessionId;
use crate::kernel::sync::lock_unpoisoned;

const MAX_PENDING_REQUESTS: usize = 4;
const MAX_QUEUED_PROPOSALS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ExternalAgentRequestKind {
    Configure,
    Start,
    Proposal,
}

/// Redacted reference to one Broker-created operation. The Desktop reloads the
/// trusted SQL by this exact id and hash before showing any decision.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalAgentProposalReference {
    pub(crate) operation_id: Uuid,
    pub(crate) connection_id: Uuid,
    pub(crate) payload_hash: String,
    pub(crate) state: OperationState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalAgentRequestSummary {
    pub(crate) id: Uuid,
    pub(crate) kind: ExternalAgentRequestKind,
    pub(crate) provider: ExternalAgentProvider,
    pub(crate) working_directory: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) config: Option<ExternalAgentConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) proposal: Option<ExternalAgentProposalReference>,
}

#[derive(Clone)]
struct ExternalAgentIdentity {
    terminal_session_id: TerminalSessionId,
    provider: ExternalAgentProvider,
    working_directory: String,
}

pub(crate) enum ExternalAgentRequestDecision {
    Approved(Option<ExternalAgentConfig>),
    Rejected,
}

struct PendingExternalAgentRequest {
    summary: ExternalAgentRequestSummary,
    response: Mutex<Option<oneshot::Sender<ExternalAgentRequestDecision>>>,
}

/// A queued proposal remembers its session so a revoked or expired session
/// releases exactly its own entries.
struct QueuedProposal {
    terminal_session_id: TerminalSessionId,
    summary: ExternalAgentRequestSummary,
}

#[derive(Clone, Default)]
pub(crate) struct ExternalAgentRequestRegistry {
    pending: Arc<DashMap<Uuid, Arc<PendingExternalAgentRequest>>>,
    admission: Arc<Mutex<()>>,
    external_sessions: Arc<Mutex<VecDeque<ExternalAgentIdentity>>>,
    proposals: Arc<Mutex<VecDeque<QueuedProposal>>>,
}

impl ExternalAgentRequestRegistry {
    pub(crate) fn begin(
        &self,
        summary: ExternalAgentRequestSummary,
    ) -> AppResult<oneshot::Receiver<ExternalAgentRequestDecision>> {
        // Keep the limit exact even when several local CLI processes ask for
        // approval at the same time. DashMap protects each operation, but a
        // separate admission lock is required around the count-and-insert pair.
        let _admission = lock_unpoisoned(&self.admission);
        if self.pending.len() >= MAX_PENDING_REQUESTS {
            return Err(AppError::Blocked {
                reason: "too many external Agent approval requests are already pending".into(),
            });
        }
        let (sender, receiver) = oneshot::channel();
        let id = summary.id;
        if self
            .pending
            .insert(
                id,
                Arc::new(PendingExternalAgentRequest {
                    summary,
                    response: Mutex::new(Some(sender)),
                }),
            )
            .is_some()
        {
            self.pending.remove(&id);
            return Err(AppError::Config(
                "external Agent approval request identifier collision".into(),
            ));
        }
        Ok(receiver)
    }

    /// Blocking configure/start requests first, then queued proposals in arrival order.
    pub(crate) fn list(&self) -> Vec<ExternalAgentRequestSummary> {
        let mut requests = self
            .pending
            .iter()
            .map(|entry| entry.summary.clone())
            .collect::<Vec<_>>();
        requests.sort_by_key(|request| request.id);
        requests.extend(
            lock_unpoisoned(&self.proposals)
                .iter()
                .map(|queued| queued.summary.clone()),
        );
        requests
    }

    /// Remember the identity of one Desktop-approved external Agent process so
    /// its later SQL proposals can be shown with the same provider and directory.
    /// No live identity is ever evicted: an evicted session would look like an
    /// in-app one and its proposals would reach no approval surface. The list is
    /// bounded by live sessions, each approved by a person, because every
    /// Broker session removal (revoke, connection revoke, revoke-all, expiry
    /// sweep) reports through the revocation sink to `forget_external_session`.
    pub(crate) fn register_external_session(
        &self,
        terminal_session_id: TerminalSessionId,
        provider: ExternalAgentProvider,
        working_directory: String,
    ) {
        let mut sessions = lock_unpoisoned(&self.external_sessions);
        sessions.retain(|identity| identity.terminal_session_id != terminal_session_id);
        sessions.push_back(ExternalAgentIdentity {
            terminal_session_id,
            provider,
            working_directory,
        });
    }

    /// Forget a revoked, closed, or expired external session and release the
    /// proposals it queued. Returns the released entry ids for the approval UI.
    pub(crate) fn forget_external_session(
        &self,
        terminal_session_id: TerminalSessionId,
    ) -> Vec<Uuid> {
        lock_unpoisoned(&self.external_sessions)
            .retain(|identity| identity.terminal_session_id != terminal_session_id);
        let mut released = Vec::new();
        lock_unpoisoned(&self.proposals).retain(|queued| {
            let keep = queued.terminal_session_id != terminal_session_id;
            if !keep {
                released.push(queued.summary.id);
            }
            keep
        });
        released
    }

    /// Whether a new proposal from this session can still be shown. An external
    /// Agent's proposals have no transcript, so none is created that the bounded
    /// approval queue could not show; in-app sessions are never limited here.
    pub(crate) fn accepts_proposal(&self, terminal_session_id: TerminalSessionId) -> bool {
        let external = lock_unpoisoned(&self.external_sessions)
            .iter()
            .any(|identity| identity.terminal_session_id == terminal_session_id);
        !external || lock_unpoisoned(&self.proposals).len() < MAX_QUEUED_PROPOSALS
    }

    /// Queue a pending proposal from an external Agent process. Returns the
    /// entry to announce, or `None` for sessions that already have an in-app
    /// transcript approval card. Nothing pending is ever dropped to make room:
    /// `accepts_proposal` refuses new proposals before the queue is full.
    pub(crate) fn enqueue_proposal(
        &self,
        terminal_session_id: TerminalSessionId,
        proposal: ExternalAgentProposalReference,
    ) -> Option<ExternalAgentRequestSummary> {
        let identity = lock_unpoisoned(&self.external_sessions)
            .iter()
            .find(|identity| identity.terminal_session_id == terminal_session_id)
            .cloned()?;
        let entry = ExternalAgentRequestSummary {
            id: proposal.operation_id,
            kind: ExternalAgentRequestKind::Proposal,
            provider: identity.provider,
            working_directory: identity.working_directory,
            config: None,
            proposal: Some(proposal),
        };
        let mut proposals = lock_unpoisoned(&self.proposals);
        proposals.retain(|queued| queued.summary.id != entry.id);
        proposals.push_back(QueuedProposal {
            terminal_session_id,
            summary: entry.clone(),
        });
        Some(entry)
    }

    /// Remove a decided or withdrawn proposal from the approval queue. This never
    /// decides the operation; approval and rejection stay exact operation commands.
    pub(crate) fn dismiss_proposal(&self, id: Uuid) -> bool {
        let mut proposals = lock_unpoisoned(&self.proposals);
        let before = proposals.len();
        proposals.retain(|queued| queued.summary.id != id);
        proposals.len() != before
    }

    pub(crate) fn respond(
        &self,
        id: Uuid,
        decision: ExternalAgentRequestDecision,
    ) -> AppResult<()> {
        let pending = self.pending.get(&id).ok_or_else(|| AppError::Blocked {
            reason: "the external Agent approval request is no longer pending".into(),
        })?;
        let sender =
            lock_unpoisoned(&pending.response)
                .take()
                .ok_or_else(|| AppError::Blocked {
                    reason: "the external Agent approval request was already answered".into(),
                })?;
        // The requesting process stopped before the decision reached it.
        sender.send(decision).map_err(|_| AppError::Blocked {
            reason: crate::features::agents::domain::agent_error::SESSION_UNAVAILABLE.into(),
        })
    }

    pub(crate) fn finish(&self, id: Uuid) {
        self.pending.remove(&id);
    }

    pub(crate) fn reject_all(&self) {
        let ids = self
            .pending
            .iter()
            .map(|entry| *entry.key())
            .collect::<Vec<_>>();
        for id in ids {
            if let Some((_, pending)) = self.pending.remove(&id) {
                if let Some(sender) = lock_unpoisoned(&pending.response).take() {
                    let _ = sender.send(ExternalAgentRequestDecision::Rejected);
                }
            }
        }
    }
}
