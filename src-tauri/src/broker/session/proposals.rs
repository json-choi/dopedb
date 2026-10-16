//! Proposal ledger and liveness for Broker sessions. Each Agent or Terminal
//! session remembers the operations it proposed; when the session is revoked,
//! closed, or expires, the Desktop's revocation sink learns the session and
//! those ids, and approving or executing a proposal first asks whether its
//! proposing session is still live.

use chrono::Utc;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::kernel::identity::TerminalSessionId;
use crate::kernel::sync::lock_unpoisoned;

use super::BrokerSessionRegistry;

/// Proposals expire within minutes; this only bounds a long-lived session's ledger.
const MAX_TRACKED_PROPOSALS_PER_SESSION: usize = 256;

/// One Broker session that was revoked, closed, or expired, with the operations
/// it proposed. The Desktop cancels those operations and releases anything else
/// it kept for the session, such as an external Agent's approval queue.
#[derive(Debug)]
pub(crate) struct SessionRevocation {
    pub(crate) terminal_session_id: TerminalSessionId,
    pub(crate) operations: Vec<Uuid>,
}

impl BrokerSessionRegistry {
    /// Install the Desktop consumer that releases what removed sessions left behind.
    pub(crate) fn install_revocation_sink(&self, sender: UnboundedSender<SessionRevocation>) {
        *lock_unpoisoned(&self.revocation_sink) = Some(sender);
    }

    /// Remember that `operation_id` was proposed under this exact session. If the
    /// session is already gone, the proposal is handed to cancellation at once.
    pub(crate) fn track_proposal(
        &self,
        terminal_session_id: TerminalSessionId,
        operation_id: Uuid,
    ) {
        // Holding the session entry keeps a concurrent revocation from draining
        // the ledger between the liveness check and the insertion.
        let Some(record) = self.sessions.get(&terminal_session_id) else {
            self.notify_revoked(terminal_session_id, vec![operation_id]);
            return;
        };
        {
            let mut tracked = self.proposals.entry(terminal_session_id).or_default();
            tracked.push(operation_id);
            if tracked.len() > MAX_TRACKED_PROPOSALS_PER_SESSION {
                let overflow = tracked.len() - MAX_TRACKED_PROPOSALS_PER_SESSION;
                tracked.drain(..overflow);
            }
        }
        drop(record);
    }

    /// True while the session that created a proposal may still be approved for.
    pub(crate) fn is_live(&self, terminal_session_id: TerminalSessionId) -> bool {
        self.sessions
            .get(&terminal_session_id)
            .is_some_and(|record| {
                record.metadata.runtime_id == self.runtime_id
                    && record.metadata.expires_at > Utc::now()
            })
    }

    /// Report a removed session with every proposal it made, even when it made
    /// none, so the Desktop releases all state it kept for that session.
    pub(super) fn drain_proposals(&self, terminal_session_id: TerminalSessionId) {
        let operations = self
            .proposals
            .remove(&terminal_session_id)
            .map(|(_, operations)| operations)
            .unwrap_or_default();
        self.notify_revoked(terminal_session_id, operations);
    }

    fn notify_revoked(&self, terminal_session_id: TerminalSessionId, operations: Vec<Uuid>) {
        if let Some(sender) = lock_unpoisoned(&self.revocation_sink).as_ref() {
            let _ = sender.send(SessionRevocation {
                terminal_session_id,
                operations,
            });
        }
    }
}

impl crate::operations::AgentSessionLiveness for BrokerSessionRegistry {
    fn is_live(&self, terminal_session_id: Uuid) -> bool {
        BrokerSessionRegistry::is_live(self, TerminalSessionId::from(terminal_session_id))
    }
}
