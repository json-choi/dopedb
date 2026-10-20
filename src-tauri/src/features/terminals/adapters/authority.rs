//! Projection and comparison of scope-pinned connection authority.

use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::{ConnectionId, WorkspaceId};

use super::super::domain::{TerminalConnectionPin, TerminalDatabasePolicy};

pub(super) fn connection_pin(pin: &PinnedConnection) -> TerminalConnectionPin {
    let policy = if pin.profile.readonly_default
        || !pin.profile.allow_writes
        || !pin.profile.workspace_access.can_write()
    {
        TerminalDatabasePolicy::ReadOnly
    } else {
        TerminalDatabasePolicy::ApprovalRequired
    };
    TerminalConnectionPin {
        workspace_id: WorkspaceId::from(pin.scope.workspace_id),
        account_scope: pin.scope.account_scope.storage_key().into(),
        scope_generation: pin.scope.generation,
        connection_id: ConnectionId::from(pin.connection_id),
        connection_revision: pin.connection_revision,
        connection_name: pin.profile.name.clone(),
        database: pin.profile.database.clone(),
        environment: pin
            .profile
            .effective_env
            .map(|kind| kind.as_str().to_owned()),
        engine: pin.profile.engine,
        policy,
    }
}
