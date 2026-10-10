//! Scope-pinned connection authority adapter for Job use cases and workers.

use crate::connection::{ConnectionAccess, ConnectionContext, ConnectionManager};
use crate::error::{AppError, AppResult};
use crate::kernel::identity::{AccountScopeId, ConnectionId, WorkspaceConnectionId, WorkspaceId};
use crate::operations::{actor_for_pin, capture_policy};
use crate::store::Store;

use super::super::ports::{
    JobAuthority, JobAuthorityGuard, JobAuthorityPort, JobOperationContext, JobPermission,
};

#[derive(Clone)]
pub(in crate::features::jobs) struct RuntimeJobAuthority {
    store: Store,
    connections: ConnectionManager,
}

pub(in crate::features::jobs) struct RuntimeJobAuthorityGuard {
    context: ConnectionContext,
    authority: JobAuthority,
}

impl RuntimeJobAuthority {
    pub(in crate::features::jobs) fn new(store: Store, connections: ConnectionManager) -> Self {
        Self { store, connections }
    }
}

impl RuntimeJobAuthorityGuard {
    pub(in crate::features::jobs) async fn connect(
        self,
    ) -> AppResult<crate::connection::ConnectionLease> {
        self.context.connect().await
    }
}

impl JobAuthorityGuard for RuntimeJobAuthorityGuard {
    fn authority(&self) -> &JobAuthority {
        &self.authority
    }
}

impl JobAuthorityPort for RuntimeJobAuthority {
    type Guard = RuntimeJobAuthorityGuard;

    async fn authorize(
        &self,
        connection_id: ConnectionId,
        permission: JobPermission,
    ) -> AppResult<Self::Guard> {
        let access = match permission {
            JobPermission::Read => ConnectionAccess::Read,
            JobPermission::Write => ConnectionAccess::Write,
            JobPermission::Schema => ConnectionAccess::Schema,
        };
        let context = self.connections.pin(connection_id.into(), access).await?;
        let pin = context.pin();
        let account_scope = AccountScopeId::new(pin.scope.account_scope.storage_key())
            .ok_or_else(|| AppError::Config("active Job account scope is invalid".into()))?;
        let authority = JobAuthority {
            resource: WorkspaceConnectionId {
                workspace_id: WorkspaceId::from(pin.scope.workspace_id),
                connection_id,
            },
            account_scope,
            connection_revision: pin.connection_revision,
            engine: pin.profile.engine,
            workspace_access: pin.profile.workspace_access,
        };
        Ok(RuntimeJobAuthorityGuard { context, authority })
    }

    async fn operation_context(
        &self,
        guard: &Self::Guard,
        origin_surface: &'static str,
    ) -> AppResult<JobOperationContext> {
        let pin = guard.context.pin();
        let safety = self.store.get_safety(pin.connection_id).await?;
        let policy = capture_policy(pin, &safety)?;
        Ok(JobOperationContext {
            safety,
            actor: actor_for_pin(pin, origin_surface.into()),
            policy_snapshot: policy.snapshot,
            policy_revision: policy.revision,
        })
    }

    async fn safety(&self, guard: &Self::Guard) -> AppResult<crate::model::SafetySettings> {
        self.store
            .get_safety(guard.context.pin().connection_id)
            .await
    }
}
