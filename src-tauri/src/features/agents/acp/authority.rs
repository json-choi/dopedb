//! Immediate ACP revocation when a connection, Project, or workspace authority changes.

use std::collections::HashSet;

use uuid::Uuid;

use super::{AcpRuntime, AcpSessionLifecycle};
use crate::kernel::identity::ConnectionId;

const WORKSPACE_AUTHORITY_CHANGED: &str = "workspace_authority_changed";
const CONNECTION_AUTHORITY_CHANGED: &str = "connection_authority_changed";
const PROJECT_AUTHORITY_CHANGED: &str = "project_authority_changed";

impl AcpRuntime {
    pub(crate) fn stop_connection(&self, connection_id: ConnectionId) -> usize {
        let sessions = self
            .sessions
            .iter()
            .filter_map(|entry| {
                let summary = entry.value().summary();
                let connection_selected = summary.knowledge_scopes.iter().any(|scope| {
                    ConnectionId::from(scope.authority_connection_id) == connection_id
                        || scope.connections.iter().any(|connection| {
                            ConnectionId::from(connection.connection_id) == connection_id
                        })
                });
                ((entry.value().connection_id == connection_id
                    || summary.write_connection_id.map(ConnectionId::from) == Some(connection_id)
                    || connection_selected)
                    && !matches!(
                        summary.lifecycle,
                        AcpSessionLifecycle::Closed | AcpSessionLifecycle::Failed
                    ))
                .then_some(*entry.key())
            })
            .collect::<Vec<_>>();
        for id in &sessions {
            self.interrupt(*id, CONNECTION_AUTHORITY_CHANGED);
        }
        sessions.len()
    }

    pub(crate) fn stop_project_environments(
        &self,
        project_environment_ids: &HashSet<Uuid>,
    ) -> usize {
        let sessions =
            self.sessions
                .iter()
                .filter_map(|entry| {
                    let summary = entry.value().summary();
                    (summary.knowledge_scopes.iter().any(|scope| {
                        project_environment_ids.contains(&scope.project_environment_id)
                    }) && !matches!(
                        summary.lifecycle,
                        AcpSessionLifecycle::Closed | AcpSessionLifecycle::Failed
                    ))
                    .then_some(*entry.key())
                })
                .collect::<Vec<_>>();
        for id in &sessions {
            self.interrupt(*id, PROJECT_AUTHORITY_CHANGED);
        }
        sessions.len()
    }

    /// Stop only after a proven active workspace/account authority transition.
    /// Routine refreshes use the Broker verification gate and never call this.
    pub(crate) fn interrupt_all_for_workspace_authority_change(&self) {
        let ids = self
            .sessions
            .iter()
            .filter_map(|entry| {
                (!matches!(
                    entry.value().summary().lifecycle,
                    AcpSessionLifecycle::Closed | AcpSessionLifecycle::Failed
                ))
                .then_some(*entry.key())
            })
            .collect::<Vec<_>>();
        for id in ids {
            self.interrupt(id, WORKSPACE_AUTHORITY_CHANGED);
        }
    }
}
