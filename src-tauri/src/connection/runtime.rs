//! Scope-pinned authorization, single-flight pool creation, and managed-lease
//! retirement shared by UI, introspection, and agent transports.
//!
//! A connection UUID alone is never a cache identity. Every entry is keyed by the
//! exact workspace/account selection plus connection and binding revisions. A
//! `ConnectionLease` retains the scope read gate for the operation lifetime so the
//! current adapters cannot switch scope and then write history/cache into a different
//! account while their scoped-write APIs are being extracted.

use std::collections::BTreeSet;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::time::Duration;

use dashmap::DashMap;
use futures::future::join_all;
use sqlx::Row;
use tokio::sync::{Mutex, OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};
use tokio::time::Instant;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::workspaces::{Workspace, WorkspaceAuthUser, WorkspaceRole};
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::{AccountId, ConnectionId, ProviderBindingId, WorkspaceId};
use crate::model::{
    ConnectionProfile, Engine, Provider, WorkspaceConnectionAccess, WorkspaceCredentialMode,
};
use crate::store::Store;

use super::remote_authority::RemoteConnectionAuthorityPort;
use super::Live;
use super::{ProviderLocalBindingPin, ProviderLocalConnectionPort, ProviderLocalTarget};

mod authority;
mod cache;
#[path = "runtime_context.rs"]
mod context;
#[path = "runtime_manager.rs"]
mod manager;
#[path = "runtime_policy.rs"]
mod policy;

use policy::*;

use authority::{
    authorize_pin, connect_authorized, opened_provider_target_expiry_shrank,
    provider_target_expiry_shrank, retire_opened, scope_changed, ConnectionAuthorization,
    OpenedLive,
};
use cache::{
    cache_entry_expired, retire_entries, schedule_expiry, CacheEntry, ConnectionCacheKey,
    ConnectionSlot,
};
#[cfg(test)]
pub(crate) use policy::assert_gcp_mysql_grant_contract;

const MANAGED_RELEASE_TIMEOUT: Duration = Duration::from_secs(5);
// A failed managed connection must not mint a fresh provider credential for every
// catalog observer or repeated click. Twenty seconds keeps one exact cache key below
// the hosted five-per-minute admission ceiling while still allowing explicit recovery.
const MANAGED_OPEN_RETRY_COOLDOWN: Duration = Duration::from_secs(20);
const MAX_TARGET_DATABASE_BYTES: usize = 255;
const MAX_BIGQUERY_DATASET_BYTES: usize = 1_024;

/// A shared cache hit needs another hosted authorization only when the authority
/// response crossed an asynchronous slot boundary. An uncontended slot is the
/// exact hand-off boundary: repeating the same hosted request there adds one full
/// control-plane round trip without closing a different revocation window.
fn cached_handoff_needs_remote_refresh(
    requires_remote_rbac: bool,
    authority_requires_refresh: bool,
) -> bool {
    requires_remote_rbac && authority_requires_refresh
}

#[cfg(test)]
pub(crate) fn assert_warm_cache_authorization_contract() {
    assert!(!cached_handoff_needs_remote_refresh(true, false));
    assert!(cached_handoff_needs_remote_refresh(true, true));
    assert!(!cached_handoff_needs_remote_refresh(false, false));
    assert!(!cached_handoff_needs_remote_refresh(false, true));

    let mut slot = ConnectionSlot::default();
    assert!(slot.managed_open_retry_error().is_none());
    slot.remember_managed_open_failure(&AppError::Network("provider preflight failed".into()));
    assert!(matches!(
        slot.managed_open_retry_error(),
        Some(AppError::Network(message)) if message == "provider preflight failed"
    ));
    slot.clear_managed_open_failure();
    slot.remember_managed_open_failure(&AppError::Blocked {
        reason: "grant changed".into(),
    });
    assert!(slot.managed_open_retry_error().is_none());
}

fn resolve_target_database(
    profile: &ConnectionProfile,
    requested: Option<&str>,
    authorization: &ConnectionAuthorization,
) -> AppResult<String> {
    let database = requested.unwrap_or(&profile.database);
    let maximum_bytes = if profile.engine == Engine::Bigquery {
        MAX_BIGQUERY_DATASET_BYTES
    } else {
        MAX_TARGET_DATABASE_BYTES
    };
    if database.is_empty()
        || database.len() > maximum_bytes
        || database.chars().any(char::is_control)
    {
        return Err(AppError::Config(
            "target database name is empty or invalid".into(),
        ));
    }
    if profile.engine == Engine::Sqlite && database != profile.database {
        return Err(AppError::Blocked {
            reason: "SQLite connections are bound to one database file".into(),
        });
    }
    if database != profile.database
        && (profile.credential_mode == WorkspaceCredentialMode::Managed
            || authorization.provider_local_target.is_some())
    {
        return Err(AppError::Blocked {
            reason: "this credential authority is bound to the connection's configured database"
                .into(),
        });
    }
    Ok(database.to_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ConnectionAccess {
    Read,
    Write,
    Schema,
}

impl ConnectionAccess {
    pub(crate) const fn is_mutation(self) -> bool {
        matches!(self, Self::Write | Self::Schema)
    }

    pub(crate) const fn is_schema(self) -> bool {
        matches!(self, Self::Schema)
    }
}

#[derive(Clone)]
pub(super) struct ManagedLeaseHandle {
    authority: Arc<dyn RemoteConnectionAuthorityPort>,
    account_id: AccountId,
    workspace_id: WorkspaceId,
    connection_id: ConnectionId,
    lease_id: Uuid,
}

impl ManagedLeaseHandle {
    pub(super) async fn release(self) {
        if let Err(error) = self
            .authority
            .release_managed_lease(
                &self.account_id,
                self.workspace_id,
                self.connection_id,
                self.lease_id,
            )
            .await
        {
            tracing::warn!(
                connection_id = %self.connection_id,
                %error,
                "managed database access release deferred until provider expiry"
            );
        }
    }
}

pub(super) async fn release_managed_bounded(lease: ManagedLeaseHandle) {
    let connection_id = lease.connection_id;
    if tokio::time::timeout(MANAGED_RELEASE_TIMEOUT, lease.release())
        .await
        .is_err()
    {
        tracing::warn!(
            %connection_id,
            "managed database access release timed out; provider expiry remains authoritative"
        );
    }
}

struct ConnectionManagerInner {
    store: Store,
    remote_authority: Arc<dyn RemoteConnectionAuthorityPort>,
    provider_local: Arc<dyn ProviderLocalConnectionPort>,
    scope_gate: Arc<RwLock<()>>,
    session_gate: Arc<RwLock<()>>,
    session_revocation_ports: StdMutex<Vec<Weak<dyn ConnectionSessionRevocationPort>>>,
    profile_mutation_gates: DashMap<Uuid, Arc<Mutex<()>>>,
    slots: DashMap<ConnectionCacheKey, Arc<Mutex<ConnectionSlot>>>,
    next_generation: AtomicU64,
    provider_binding_fence_epoch: AtomicU64,
}

/// Process-local owner of every database pool. Clones share the same slots and scope
/// gate, including the instances used by the local broker.
#[derive(Clone)]
pub(crate) struct ConnectionManager {
    inner: Arc<ConnectionManagerInner>,
}

/// An online-authorized connection identity without a database pool. Catalog
/// cache-first reads use this so RBAC is checked before a cache hit without opening
/// an unnecessary target connection.
pub(crate) struct ConnectionContext {
    manager: ConnectionManager,
    pin: PinnedConnection,
    access: ConnectionAccess,
    authorization: ConnectionAuthorization,
    provider_binding_fence_epoch: u64,
    scope_guard: Option<OwnedRwLockReadGuard<()>>,
}

/// A pool and its exact local authority snapshot. This type is intentionally not
/// Clone: adapters retain one lease for the complete operation.
pub(crate) struct ConnectionLease {
    pin: PinnedConnection,
    target_database: String,
    entry: Arc<CacheEntry>,
    _scope_guard: OwnedRwLockReadGuard<()>,
}

/// Local operation boundary used before a database pool is needed. It freezes the
/// active workspace/account while commands classify input, evaluate gates, and write
/// scoped artifacts, without issuing an unnecessary remote authorization request.
pub(crate) struct ConnectionOperationScope {
    manager: ConnectionManager,
    _scope_guard: OwnedRwLockReadGuard<()>,
    _profile_mutation_guard: Option<OwnedMutexGuard<()>>,
    _session_mutation_guard: Option<OwnedRwLockWriteGuard<()>>,
}

/// Admission fence for a long-lived connection session. Scope mutations take the
/// matching writer gate, revoke registered sessions, and only then wait for the
/// ordinary connection scope writer.
pub(crate) struct ConnectionSessionAdmission {
    operation_scope: ConnectionOperationScope,
    admission_guard: OwnedRwLockReadGuard<()>,
}

/// A newly connected long-lived session whose admission fence remains held until
/// the owner has published it in its revocation registry.
pub(crate) struct ConnectionSessionLeaseStart {
    lease: ConnectionLease,
    _admission_guard: OwnedRwLockReadGuard<()>,
}

/// Runtime callback used to end long-lived sessions before connection/workspace
/// authority changes. Implementations must always release their connection leases,
/// closing a poisoned physical connection when rollback cannot be acknowledged.
pub(crate) trait ConnectionSessionRevocationPort: Send + Sync + 'static {
    fn revoke<'a>(
        &'a self,
        connection_id: Option<Uuid>,
        reason: &'static str,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>>;
}

/// Exclusive keychain/material mutation boundary. Existing operations drain before
/// this is created, and no new scope pins can begin until it is released.
pub(crate) struct ConnectionMutation {
    manager: ConnectionManager,
    pin: Option<PinnedConnection>,
    scope_guard: Option<OwnedRwLockWriteGuard<()>>,
    _session_mutation_guard: Option<OwnedRwLockWriteGuard<()>>,
}

impl ConnectionLease {
    pub(crate) fn live(&self) -> &Live {
        &self.entry.live
    }

    pub(crate) fn pin(&self) -> &PinnedConnection {
        &self.pin
    }

    pub(crate) fn target_database(&self) -> &str {
        &self.target_database
    }
}

impl ConnectionSessionLeaseStart {
    pub(crate) fn live(&self) -> &Live {
        self.lease.live()
    }

    pub(crate) fn target_database(&self) -> &str {
        self.lease.target_database()
    }

    pub(crate) fn into_lease(self) -> ConnectionLease {
        self.lease
    }
}

impl ConnectionSessionAdmission {
    pub(crate) async fn pin_connection(&self, id: Uuid) -> AppResult<PinnedConnection> {
        self.operation_scope.pin_connection(id).await
    }

    pub(crate) async fn connect_to_database(
        self,
        pin: PinnedConnection,
        access: ConnectionAccess,
        database: Option<String>,
    ) -> AppResult<ConnectionSessionLeaseStart> {
        let Self {
            operation_scope,
            admission_guard,
        } = self;
        let lease = operation_scope
            .connect_to_database(pin, access, database)
            .await?;
        Ok(ConnectionSessionLeaseStart {
            lease,
            _admission_guard: admission_guard,
        })
    }
}

impl ConnectionOperationScope {
    pub(crate) async fn pin_connection(&self, id: Uuid) -> AppResult<PinnedConnection> {
        self.manager.inner.store.pin_connection_for_read(id).await
    }

    /// Pin connection metadata for local inspection without granting target-database
    /// execution. Read/Write authorization still happens if the scope is connected.
    pub(crate) async fn pin_connection_for_view(&self, id: Uuid) -> AppResult<PinnedConnection> {
        self.manager.inner.store.pin_connection_for_view(id).await
    }

    /// Upgrade this operation boundary into a live connection without reacquiring
    /// the writer-preferred scope lock. Re-entering `ConnectionManager::pin` while
    /// this scope owns a read guard can deadlock behind a queued mutation.
    pub(crate) async fn connect(
        self,
        pin: PinnedConnection,
        access: ConnectionAccess,
    ) -> AppResult<ConnectionLease> {
        self.connect_to_database(pin, access, None).await
    }

    pub(crate) async fn connect_to_database(
        self,
        pin: PinnedConnection,
        access: ConnectionAccess,
        database: Option<String>,
    ) -> AppResult<ConnectionLease> {
        let authorization = authorize_pin(
            self.manager.inner.remote_authority.as_ref(),
            self.manager.inner.provider_local.as_ref(),
            &pin,
            access,
        )
        .await?;
        if !self.manager.pin_is_current(&pin).await? {
            return Err(scope_changed());
        }
        let provider_binding_fence_epoch = self.manager.provider_binding_fence_epoch();
        let Self {
            manager,
            _scope_guard,
            _profile_mutation_guard: _,
            _session_mutation_guard: _,
        } = self;
        ConnectionContext {
            manager,
            pin,
            access,
            authorization,
            provider_binding_fence_epoch,
            scope_guard: Some(_scope_guard),
        }
        .connect_to_database(database)
        .await
    }

    /// Publish a connection-local profile change without draining unrelated
    /// database reads. The scope guard keeps the workspace/account fixed while
    /// the caller persists the new generation and detaches old pools. Reads
    /// that already hold the previous generation may finish; later admissions
    /// fail the generation check or open against the replacement profile.
    pub(crate) async fn retire_connection(self, connection_id: Uuid) {
        let keys = self
            .manager
            .inner
            .slots
            .iter()
            .filter(|entry| entry.key().connection_id == connection_id)
            .map(|entry| entry.key().clone())
            .collect::<Vec<_>>();
        let retired = self.manager.detach_keys(keys).await;
        drop(self);
        retire_entries(retired).await;
    }
}

impl ConnectionMutation {
    pub(crate) fn pin(&self) -> &PinnedConnection {
        self.pin
            .as_ref()
            .expect("connection mutation was created with an authority pin")
    }

    /// Publish a successful material change by detaching every cached pool for the
    /// resource before allowing new acquisitions.
    pub(crate) async fn retire_connection(self, connection_id: Uuid) {
        self.retire_connections(&[connection_id]).await;
    }

    /// Atomically publish a successful batch mutation while the exclusive scope
    /// gate keeps waiters from retaining a slot that is about to be detached.
    pub(crate) async fn retire_connections(mut self, connection_ids: &[Uuid]) {
        let keys = self
            .manager
            .inner
            .slots
            .iter()
            .filter(|entry| connection_ids.contains(&entry.key().connection_id))
            .map(|entry| entry.key().clone())
            .collect::<Vec<_>>();
        let retired = self.manager.detach_keys(keys).await;
        self.scope_guard.take();
        drop(self);
        retire_entries(retired).await;
    }
}
