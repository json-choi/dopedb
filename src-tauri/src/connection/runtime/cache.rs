//! Cache identity and retirement lifecycle for scope-pinned database pools.
//!
//! The runtime owns cache admission; this module owns only the immutable key,
//! generation-aware slot, expiry task, and last-lease retirement mechanics.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use futures::future::join_all;
use tokio::sync::Mutex;
use tokio::time::Instant;
use uuid::Uuid;

use crate::error::AppError;
use crate::kernel::access::{AccountScope, PinnedConnection};
use crate::kernel::sync::lock_unpoisoned;

use super::{
    release_managed_bounded, ConnectionAccess, Live, ManagedLeaseHandle, ProviderLocalBindingPin,
    ProviderLocalTarget, MANAGED_OPEN_RETRY_COOLDOWN, MANAGED_RELEASE_TIMEOUT,
};
use crate::connection::cloud_sql_proxy::CloudSqlProxy;
use crate::connection::ssh::SshTunnel;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct ConnectionCacheKey {
    workspace_id: Uuid,
    account_scope: AccountScope,
    scope_generation: i64,
    pub(super) connection_id: Uuid,
    connection_revision: i64,
    binding_revision: i64,
    binding_updated_at: String,
    provider_integration_id: Option<Uuid>,
    provider_integration_generation: Option<i64>,
    provider_resource_fingerprint: Option<String>,
    provider_resource_identity: Option<String>,
    pub(super) provider_binding_id: Option<Uuid>,
    provider_binding_revision: Option<i64>,
    target_database: String,
    access: ConnectionAccess,
}

impl ConnectionCacheKey {
    pub(super) fn new(
        pin: &PinnedConnection,
        access: ConnectionAccess,
        provider_target: Option<&ProviderLocalTarget>,
        provider_binding: Option<&ProviderLocalBindingPin>,
        target_database: &str,
    ) -> Self {
        Self {
            workspace_id: pin.scope.workspace_id,
            account_scope: pin.scope.account_scope.clone(),
            scope_generation: pin.scope.generation,
            connection_id: pin.connection_id,
            connection_revision: pin.connection_revision,
            binding_revision: pin.binding_revision,
            binding_updated_at: pin.binding_updated_at.clone(),
            provider_integration_id: provider_target.map(|target| target.integration_id.into()),
            provider_integration_generation: provider_target
                .map(|target| target.integration_generation),
            provider_resource_fingerprint: provider_target
                .map(|target| target.resource_fingerprint.clone()),
            provider_resource_identity: provider_target.map(ProviderLocalTarget::cache_identity),
            provider_binding_id: provider_binding.map(|binding| binding.binding_id.into()),
            provider_binding_revision: provider_binding.map(|binding| binding.binding_revision),
            target_database: target_database.to_owned(),
            // A read entry is constructed without a write-capable pool. It therefore
            // can never satisfy a later write request, even for local credentials.
            access,
        }
    }
}

pub(super) struct CacheEntry {
    pub(super) live: Live,
    pub(super) generation: u64,
    pub(super) retire_at: Option<Instant>,
    pub(super) managed_lease: StdMutex<Option<ManagedLeaseHandle>>,
    pub(super) ssh_tunnel: StdMutex<Option<SshTunnel>>,
    pub(super) cloud_sql_proxy: StdMutex<Option<CloudSqlProxy>>,
    pub(super) closed: AtomicBool,
}

impl CacheEntry {
    fn take_managed_lease(&self) -> Option<ManagedLeaseHandle> {
        lock_unpoisoned(&self.managed_lease).take()
    }

    fn take_ssh_tunnel(&self) -> Option<SshTunnel> {
        lock_unpoisoned(&self.ssh_tunnel).take()
    }

    fn ssh_transport_is_running(&self) -> bool {
        lock_unpoisoned(&self.ssh_tunnel)
            .as_mut()
            .is_none_or(SshTunnel::is_running)
    }

    fn take_cloud_sql_proxy(&self) -> Option<CloudSqlProxy> {
        lock_unpoisoned(&self.cloud_sql_proxy).take()
    }

    fn cloud_sql_transport_is_running(&self) -> bool {
        lock_unpoisoned(&self.cloud_sql_proxy)
            .as_mut()
            .is_none_or(CloudSqlProxy::is_running)
    }

    async fn close_once(&self) {
        if !self.closed.swap(true, Ordering::AcqRel) {
            if let Some(tunnel) = self.take_ssh_tunnel() {
                tunnel.close().await;
            }
            if let Some(proxy) = self.take_cloud_sql_proxy() {
                proxy.close().await;
            }
            // An in-flight catalog or query lease can keep `Pool::close` waiting.
            // Stop child transports first so the application-exit deadline cannot
            // expire while a Cloud SQL proxy is still reachable as an orphan.
            self.live.close().await;
        }
    }

    /// Explicit security revocation is intentionally unlike normal retirement:
    /// a retained operation lease must not keep its target pool reachable.
    pub(super) async fn force_close_and_release(&self) {
        self.close_once().await;
        if let Some(managed_lease) = self.take_managed_lease() {
            release_managed_bounded(managed_lease).await;
        }
    }
}

impl Drop for CacheEntry {
    fn drop(&mut self) {
        let should_close = !self.closed.swap(true, Ordering::AcqRel);
        let live = should_close.then(|| self.live.clone());
        let ssh_tunnel = self.take_ssh_tunnel();
        let cloud_sql_proxy = self.take_cloud_sql_proxy();
        let managed_lease = self.take_managed_lease();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Some(tunnel) = ssh_tunnel {
                    tunnel.close().await;
                }
                if let Some(proxy) = cloud_sql_proxy {
                    proxy.close().await;
                }
                if let Some(live) = live {
                    live.close().await;
                }
                if let Some(managed_lease) = managed_lease {
                    release_managed_bounded(managed_lease).await;
                }
            });
        }
    }
}

struct ManagedOpenFailure {
    retry_at: Instant,
    message: String,
}

#[derive(Default)]
pub(super) struct ConnectionSlot {
    // Empty slots deliberately remain mapped. Removing a slot after releasing this
    // mutex can orphan a waiter that has already cloned the Arc and let a second slot
    // open a duplicate pool for the same authority key.
    pub(super) entry: Option<Arc<CacheEntry>>,
    managed_open_failure: Option<ManagedOpenFailure>,
}

impl ConnectionSlot {
    pub(super) fn remember_managed_open_failure(&mut self, error: &AppError) {
        let AppError::Network(message) = error else {
            return;
        };
        self.managed_open_failure = Some(ManagedOpenFailure {
            retry_at: Instant::now() + MANAGED_OPEN_RETRY_COOLDOWN,
            message: message.clone(),
        });
    }

    pub(super) fn managed_open_retry_error(&mut self) -> Option<AppError> {
        let failure = self.managed_open_failure.as_ref()?;
        if failure.retry_at <= Instant::now() {
            self.managed_open_failure = None;
            return None;
        }
        Some(AppError::Network(failure.message.clone()))
    }

    pub(super) fn clear_managed_open_failure(&mut self) {
        self.managed_open_failure = None;
    }
}

pub(super) fn schedule_expiry(slot: Arc<Mutex<ConnectionSlot>>, generation: u64, delay: Duration) {
    tokio::spawn(async move {
        tokio::time::sleep(delay).await;
        let expired = {
            let mut state = slot.lock().await;
            if state
                .entry
                .as_ref()
                .is_some_and(|entry| entry.generation == generation)
            {
                state.entry.take()
            } else {
                None
            }
        };
        if expired.is_some() {
            retire_entries(expired.into_iter().collect()).await;
        }
    });
}

pub(super) fn cache_entry_expired(entry: &CacheEntry) -> bool {
    entry
        .retire_at
        .is_some_and(|retire_at| retire_at <= Instant::now())
        || !entry.ssh_transport_is_running()
        || !entry.cloud_sql_transport_is_running()
}

pub(super) async fn retire_entries(entries: Vec<Arc<CacheEntry>>) {
    let retirements = entries.into_iter().filter_map(|entry| {
        Arc::try_unwrap(entry).ok().map(|entry| async move {
            entry.close_once().await;
            if let Some(managed_lease) = entry.take_managed_lease() {
                release_managed_bounded(managed_lease).await;
            }
        })
    });
    if tokio::time::timeout(
        MANAGED_RELEASE_TIMEOUT + Duration::from_secs(1),
        join_all(retirements),
    )
    .await
    .is_err()
    {
        tracing::warn!(
            "connection retirement timed out; remaining pools and provider leases are dropping"
        );
    }
}
