//! Connection manager lifecycle and provider revocation integration.
//!
//! Long-lived sessions (manual transactions) keep only their exact pool entry,
//! not the workspace scope gate, so a background workspace refresh never has to
//! end them merely to acquire that gate. Every scope or connection change that
//! can alter a session's authority ends the affected sessions through the
//! registered revocation ports, and a refresh ends only the sessions whose exact
//! connection authority (scope, connection revision, binding revision) changed.

use std::collections::{HashMap, HashSet};

use super::*;

/// A long-lived session's authority after admission: its exact pin, an opaque
/// retention of the authorized pool, and the admission fence.
pub(crate) struct UnscopedSessionStart {
    pub(crate) pin: PinnedConnection,
    /// Keeps the pool (and any managed credential lease) alive for the session's
    /// physical connection without holding the workspace scope gate.
    pub(crate) retention: Box<dyn std::any::Any + Send + Sync>,
    /// Drop only after the session is published in its revocation registry, so
    /// a concurrent revocation cannot miss it.
    pub(crate) admission: OwnedRwLockReadGuard<()>,
}

impl ConnectionSessionLeaseStart {
    /// Convert a newly admitted long-lived session into its exact authority pin
    /// and pool retention, releasing the workspace scope gate. The owner must be
    /// registered as a [`ConnectionSessionRevocationPort`] so scope changes end it.
    pub(crate) fn into_unscoped_session(self) -> UnscopedSessionStart {
        let Self {
            lease,
            _admission_guard: admission,
        } = self;
        let ConnectionLease { pin, entry, .. } = lease;
        UnscopedSessionStart {
            pin,
            retention: Box::new(entry),
            admission,
        }
    }
}

/// Exact authority projection compared across a background refresh so only
/// long-lived sessions whose connection authority changed are ended.
struct SessionAuthoritySnapshot {
    scope: Option<crate::kernel::access::ActiveResourceScope>,
    connections: Option<HashMap<Uuid, (i64, i64)>>,
}

impl ConnectionManager {
    async fn session_authority_snapshot(&self) -> SessionAuthoritySnapshot {
        SessionAuthoritySnapshot {
            scope: self.inner.store.active_resource_scope().await.ok(),
            connections: self
                .inner
                .store
                .active_connection_authority_fingerprint()
                .await
                .ok()
                .map(|rows| {
                    rows.into_iter()
                        .map(|(id, revision, binding_revision)| (id, (revision, binding_revision)))
                        .collect()
                }),
        }
    }

    /// Connections whose exact authority differs between two snapshots, including
    /// ones that appeared or disappeared. `None` means a snapshot was unreadable or
    /// the active scope moved, so nothing pinned before may be kept.
    fn connections_changed_between(
        before: &SessionAuthoritySnapshot,
        after: &SessionAuthoritySnapshot,
    ) -> Option<HashSet<Uuid>> {
        let (Some(before_scope), Some(before_connections), Some(after_connections)) = (
            before.scope.as_ref(),
            before.connections.as_ref(),
            after.connections.as_ref(),
        ) else {
            return None;
        };
        if after.scope.as_ref() != Some(before_scope) {
            return None;
        }
        Some(
            before_connections
                .iter()
                .filter(|(id, authority)| after_connections.get(*id) != Some(*authority))
                .map(|(id, _)| *id)
                .chain(
                    after_connections
                        .keys()
                        .filter(|id| !before_connections.contains_key(*id))
                        .copied(),
                )
                .collect(),
        )
    }

    /// Detach the pools a refresh made stale. Unchanged connections keep their warm
    /// pool, which is keyed by the exact revisions it was opened with; `None`
    /// detaches every pool.
    async fn detach_changed(&self, changed: Option<HashSet<Uuid>>) -> Vec<Arc<CacheEntry>> {
        let Some(changed) = changed else {
            return self.detach_all().await;
        };
        let keys = self
            .inner
            .slots
            .iter()
            .filter(|entry| changed.contains(&entry.key().connection_id))
            .map(|entry| entry.key().clone())
            .collect::<Vec<_>>();
        self.detach_keys(keys).await
    }

    /// End only sessions whose exact authority changed between two snapshots.
    /// An unreadable snapshot or a different active scope ends every session.
    async fn revoke_sessions_changed_between(
        &self,
        before: SessionAuthoritySnapshot,
        after: SessionAuthoritySnapshot,
        reason: &'static str,
    ) {
        let (Some(before_scope), Some(before_connections), Some(after_connections)) =
            (before.scope.as_ref(), before.connections, after.connections)
        else {
            self.revoke_sessions(None, reason).await;
            return;
        };
        if after.scope.as_ref() != Some(before_scope) {
            self.revoke_sessions(None, reason).await;
            return;
        }
        for (connection_id, authority) in before_connections {
            if after_connections.get(&connection_id) != Some(&authority) {
                self.revoke_sessions(Some(connection_id), reason).await;
            }
        }
    }

    pub(crate) fn with_authorities(
        store: Store,
        remote_authority: Arc<dyn RemoteConnectionAuthorityPort>,
        provider_local: Arc<dyn ProviderLocalConnectionPort>,
    ) -> Self {
        Self {
            inner: Arc::new(ConnectionManagerInner {
                store,
                remote_authority,
                provider_local,
                scope_gate: Arc::new(RwLock::new(())),
                session_gate: Arc::new(RwLock::new(())),
                session_revocation_ports: StdMutex::new(Vec::new()),
                profile_mutation_gates: DashMap::new(),
                slots: DashMap::new(),
                next_generation: AtomicU64::new(1),
                provider_binding_fence_epoch: AtomicU64::new(1),
            }),
        }
    }

    /// Resolve the local Google CLI profile boundary without inspecting a Google
    /// identity. Existing shared profiles must match their exact active member
    /// binding; unsaved profiles are admitted only as local records owned by the
    /// current Workspace scope.
    pub(crate) async fn bigquery_auth_scope(
        &self,
        profile: &ConnectionProfile,
    ) -> AppResult<crate::bigquery::BigQueryAuthScope> {
        if profile.engine != Engine::Bigquery || profile.provider != Provider::Generic {
            return Err(AppError::Config(
                "BigQuery authentication requires a generic BigQuery profile".into(),
            ));
        }
        let _scope_guard = self.inner.scope_gate.read().await;
        match self.inner.store.pin_connection_for_view(profile.id).await {
            Ok(pin) => {
                if pin.requires_remote_rbac {
                    if pin.profile.engine != Engine::Bigquery
                        || pin.profile.provider != Provider::Generic
                        || profile.workspace_access != pin.profile.workspace_access
                        || profile.credential_mode != pin.profile.credential_mode
                    {
                        return Err(scope_changed());
                    }
                } else if profile.workspace_access != WorkspaceConnectionAccess::Local
                    || profile.credential_mode != WorkspaceCredentialMode::Local
                {
                    return Err(scope_changed());
                }
                Ok(crate::bigquery::BigQueryAuthScope::from_active_scope(
                    &pin.scope, profile.id,
                ))
            }
            Err(AppError::NotFound(_))
                if profile.workspace_access == WorkspaceConnectionAccess::Local
                    && profile.credential_mode == WorkspaceCredentialMode::Local =>
            {
                self.inner
                    .store
                    .ensure_connection_write_scope(profile.id)
                    .await?;
                let scope = self.inner.store.active_resource_scope().await?;
                Ok(crate::bigquery::BigQueryAuthScope::from_active_scope(
                    &scope, profile.id,
                ))
            }
            Err(error) => Err(error),
        }
    }

    /// Resolve the app-owned Wrangler profile boundary for one exact
    /// Workspace/member/connection selection without reading Cloudflare identity data.
    pub(crate) async fn cloudflare_d1_auth_scope(
        &self,
        profile: &ConnectionProfile,
    ) -> AppResult<crate::cloudflare_d1::CloudflareD1AuthScope> {
        if profile.engine != Engine::Sqlite || profile.provider != Provider::CloudflareD1 {
            return Err(AppError::Config(
                "Cloudflare authentication requires a Cloudflare D1 profile".into(),
            ));
        }
        let _scope_guard = self.inner.scope_gate.read().await;
        match self.inner.store.pin_connection_for_view(profile.id).await {
            Ok(pin) => {
                if pin.requires_remote_rbac {
                    if pin.profile.engine != Engine::Sqlite
                        || pin.profile.provider != Provider::CloudflareD1
                        || profile.workspace_access != pin.profile.workspace_access
                        || profile.credential_mode != pin.profile.credential_mode
                    {
                        return Err(scope_changed());
                    }
                } else if profile.workspace_access != WorkspaceConnectionAccess::Local
                    || profile.credential_mode != WorkspaceCredentialMode::Local
                {
                    return Err(scope_changed());
                }
                Ok(
                    crate::cloudflare_d1::CloudflareD1AuthScope::from_active_scope(
                        &pin.scope, profile.id,
                    ),
                )
            }
            Err(AppError::NotFound(_))
                if profile.workspace_access == WorkspaceConnectionAccess::Local
                    && profile.credential_mode == WorkspaceCredentialMode::Local =>
            {
                self.inner
                    .store
                    .ensure_connection_write_scope(profile.id)
                    .await?;
                let scope = self.inner.store.active_resource_scope().await?;
                Ok(
                    crate::cloudflare_d1::CloudflareD1AuthScope::from_active_scope(
                        &scope, profile.id,
                    ),
                )
            }
            Err(error) => Err(error),
        }
    }

    /// Capture deletion cleanup authority before the connection row disappears.
    pub(crate) async fn existing_bigquery_auth_scope(
        &self,
        connection_id: Uuid,
    ) -> AppResult<Option<crate::bigquery::BigQueryAuthScope>> {
        let _scope_guard = self.inner.scope_gate.read().await;
        let pin = self
            .inner
            .store
            .pin_connection_for_view(connection_id)
            .await?;
        Ok((pin.profile.engine == Engine::Bigquery).then(|| {
            crate::bigquery::BigQueryAuthScope::from_active_scope(&pin.scope, connection_id)
        }))
    }

    pub(crate) async fn existing_cloudflare_d1_auth_scope(
        &self,
        connection_id: Uuid,
    ) -> AppResult<Option<crate::cloudflare_d1::CloudflareD1AuthScope>> {
        let _scope_guard = self.inner.scope_gate.read().await;
        let pin = self
            .inner
            .store
            .pin_connection_for_view(connection_id)
            .await?;
        Ok(
            (pin.profile.engine == Engine::Sqlite
                && pin.profile.provider == Provider::CloudflareD1)
                .then(|| {
                    crate::cloudflare_d1::CloudflareD1AuthScope::from_active_scope(
                        &pin.scope,
                        connection_id,
                    )
                }),
        )
    }

    pub(super) async fn pin_is_current(&self, pin: &PinnedConnection) -> AppResult<bool> {
        self.inner.store.is_pin_current(pin).await
    }

    pub(super) fn provider_binding_fence_epoch(&self) -> u64 {
        self.inner
            .provider_binding_fence_epoch
            .load(Ordering::Acquire)
    }

    pub(crate) fn register_session_revocation_port(
        &self,
        port: Arc<dyn ConnectionSessionRevocationPort>,
    ) {
        self.inner
            .session_revocation_ports
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(Arc::downgrade(&port));
    }

    async fn revoke_sessions(&self, connection_id: Option<Uuid>, reason: &'static str) {
        let ports = {
            let mut ports = self
                .inner
                .session_revocation_ports
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let live = ports.iter().filter_map(Weak::upgrade).collect::<Vec<_>>();
            ports.retain(|port| port.strong_count() > 0);
            live
        };
        for port in ports {
            port.revoke(connection_id, reason).await;
        }
    }

    /// Fence every live cache entry carrying this exact durable binding id.
    /// This deliberately does not wait on `scope_gate`: active leases hold a
    /// scope read guard, while revocation must close their pool immediately.
    pub(crate) async fn force_fence_provider_binding(&self, binding_id: ProviderBindingId) {
        let _session_gate = self.inner.session_gate.write().await;
        self.revoke_sessions(None, "provider credential binding revoked")
            .await;
        self.inner
            .provider_binding_fence_epoch
            .fetch_add(1, Ordering::AcqRel);
        let binding_id = Uuid::from(binding_id);
        let slots = self
            .inner
            .slots
            .iter()
            .filter(|entry| entry.key().provider_binding_id == Some(binding_id))
            .map(|entry| Arc::clone(entry.value()))
            .collect::<Vec<_>>();
        let mut entries = Vec::new();
        for slot in slots {
            if let Some(entry) = slot.lock().await.entry.take() {
                entries.push(entry);
            }
        }
        for entry in entries {
            entry.force_close_and_release().await;
        }
    }

    /// Stops every process-local connection resource before the Tauri runtime exits.
    /// Relying on `Drop` here is insufficient: the runtime can stop before its spawned
    /// cleanup futures run, leaving SSH or Cloud SQL helper processes orphaned.
    pub(crate) async fn shutdown_all(&self) {
        let _session_gate = self.inner.session_gate.write().await;
        self.revoke_sessions(None, "application exiting").await;
        let scope_gate = self.inner.scope_gate.write().await;
        let entries = self.detach_all().await;
        drop(scope_gate);
        join_all(entries.into_iter().map(|entry| async move {
            entry.force_close_and_release().await;
        }))
        .await;
    }

    pub(crate) async fn pin(
        &self,
        id: Uuid,
        access: ConnectionAccess,
    ) -> AppResult<ConnectionContext> {
        let scope_guard = Arc::clone(&self.inner.scope_gate).read_owned().await;
        let pin = self.inner.store.pin_connection_for_read(id).await?;
        let authorization = authorize_pin(
            self.inner.remote_authority.as_ref(),
            self.inner.provider_local.as_ref(),
            &pin,
            access,
        )
        .await?;
        if !self.pin_is_current(&pin).await? {
            return Err(scope_changed());
        }
        Ok(ConnectionContext {
            manager: self.clone(),
            pin,
            access,
            authorization,
            provider_binding_fence_epoch: self.provider_binding_fence_epoch(),
            scope_guard: Some(scope_guard),
        })
    }

    pub(crate) async fn begin_operation_scope(&self) -> ConnectionOperationScope {
        ConnectionOperationScope {
            manager: self.clone(),
            _scope_guard: Arc::clone(&self.inner.scope_gate).read_owned().await,
            _profile_mutation_guard: None,
            _session_mutation_guard: None,
        }
    }

    pub(crate) async fn begin_profile_mutation(
        &self,
        connection_id: Uuid,
    ) -> ConnectionOperationScope {
        let session_mutation_guard = Arc::clone(&self.inner.session_gate).write_owned().await;
        self.revoke_sessions(Some(connection_id), "connection profile changed")
            .await;
        let scope_guard = Arc::clone(&self.inner.scope_gate).read_owned().await;
        let mutation_gate = Arc::clone(
            self.inner
                .profile_mutation_gates
                .entry(connection_id)
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .value(),
        );
        ConnectionOperationScope {
            manager: self.clone(),
            _scope_guard: scope_guard,
            _profile_mutation_guard: Some(mutation_gate.lock_owned().await),
            _session_mutation_guard: Some(session_mutation_guard),
        }
    }

    pub(crate) async fn begin_session_admission(&self) -> ConnectionSessionAdmission {
        let admission_guard = Arc::clone(&self.inner.session_gate).read_owned().await;
        ConnectionSessionAdmission {
            operation_scope: self.begin_operation_scope().await,
            admission_guard,
        }
    }

    /// Exclusive gate for local catalog metadata changes (schema groups). Such a
    /// change neither alters credentials nor access, and long-lived sessions do
    /// not hold the scope gate, so open manual transactions stay open.
    pub(crate) async fn begin_scope_mutation(&self) -> ConnectionMutation {
        let session_mutation_guard = Arc::clone(&self.inner.session_gate).write_owned().await;
        ConnectionMutation {
            manager: self.clone(),
            pin: None,
            scope_guard: Some(Arc::clone(&self.inner.scope_gate).write_owned().await),
            _session_mutation_guard: Some(session_mutation_guard),
        }
    }

    pub(crate) async fn begin_connection_mutation(
        &self,
        id: Uuid,
        access: ConnectionAccess,
    ) -> AppResult<ConnectionMutation> {
        let session_mutation_guard = Arc::clone(&self.inner.session_gate).write_owned().await;
        self.revoke_sessions(Some(id), "connection authority changed")
            .await;
        let scope_guard = Arc::clone(&self.inner.scope_gate).write_owned().await;
        let pin = self.inner.store.pin_connection_for_read(id).await?;
        authorize_pin(
            self.inner.remote_authority.as_ref(),
            self.inner.provider_local.as_ref(),
            &pin,
            access,
        )
        .await?;
        if !self.pin_is_current(&pin).await? {
            return Err(scope_changed());
        }
        Ok(ConnectionMutation {
            manager: self.clone(),
            pin: Some(pin),
            scope_guard: Some(scope_guard),
            _session_mutation_guard: Some(session_mutation_guard),
        })
    }

    pub(crate) async fn activate_workspace(
        &self,
        id: Uuid,
        account_user_id: Option<&str>,
    ) -> AppResult<Workspace> {
        let _session_gate = self.inner.session_gate.write().await;
        self.revoke_sessions(None, "workspace changed").await;
        let _gate = self.inner.scope_gate.write().await;
        let workspace = self
            .inner
            .store
            .activate_workspace(id, account_user_id)
            .await?;
        let retired = self.detach_all().await;
        drop(_gate);
        retire_entries(retired).await;
        Ok(workspace)
    }

    pub(crate) async fn activate_workspace_account(&self, user_id: &str) -> AppResult<Workspace> {
        let _session_gate = self.inner.session_gate.write().await;
        self.revoke_sessions(None, "workspace account changed")
            .await;
        let _gate = self.inner.scope_gate.write().await;
        let workspace = self.inner.store.activate_workspace_account(user_id).await?;
        let retired = self.detach_all().await;
        drop(_gate);
        retire_entries(retired).await;
        Ok(workspace)
    }

    pub(crate) async fn remove_workspace_account(&self, user_id: &str) -> AppResult<()> {
        let _session_gate = self.inner.session_gate.write().await;
        self.revoke_sessions(None, "workspace account removed")
            .await;
        let _gate = self.inner.scope_gate.write().await;
        self.inner.store.remove_workspace_account(user_id).await?;
        let retired = self.detach_all().await;
        drop(_gate);
        retire_entries(retired).await;
        Ok(())
    }

    /// Refresh memberships. Runs on window focus and reconnects, so it ends only
    /// the long-lived sessions whose exact authority the refresh changed.
    pub(crate) async fn sync_account_workspaces(
        &self,
        user: &WorkspaceAuthUser,
        workspaces: &[(Uuid, String, WorkspaceRole)],
    ) -> AppResult<()> {
        let _session_gate = self.inner.session_gate.write().await;
        let gate = self.inner.scope_gate.write().await;
        let before = self.session_authority_snapshot().await;
        let synced = self
            .inner
            .store
            .sync_account_workspaces(user, workspaces)
            .await;
        let after = self.session_authority_snapshot().await;
        let changed = Self::connections_changed_between(&before, &after);
        // Sessions are ended before the gate opens so no statement can run in a
        // session whose authority the refresh just removed.
        self.revoke_sessions_changed_between(before, after, "workspace memberships changed")
            .await;
        synced?;
        let retired = self.detach_changed(changed).await;
        drop(gate);
        retire_entries(retired).await;
        Ok(())
    }

    /// Reconcile control-plane connection templates while excluding concurrent
    /// scope-pinned operations. Any material or binding revision change gets a fresh
    /// pool on the next acquisition and ends only that connection's sessions.
    pub(crate) async fn sync_remote_connections(
        &self,
        workspace_id: Uuid,
        account_user_id: &str,
        connections: &[(ConnectionProfile, i64)],
    ) -> AppResult<Vec<Uuid>> {
        let _session_gate = self.inner.session_gate.write().await;
        let gate = self.inner.scope_gate.write().await;
        let before = self.session_authority_snapshot().await;
        let synced = self
            .inner
            .store
            .sync_remote_connections(workspace_id, account_user_id, connections)
            .await;
        let after = self.session_authority_snapshot().await;
        let changed = Self::connections_changed_between(&before, &after);
        self.revoke_sessions_changed_between(before, after, "workspace connections changed")
            .await;
        let removed_credential_ids = synced?;
        let retired = self.detach_changed(changed).await;
        drop(gate);
        retire_entries(retired).await;
        Ok(removed_credential_ids)
    }

    async fn detach_all(&self) -> Vec<Arc<CacheEntry>> {
        let keys = self
            .inner
            .slots
            .iter()
            .map(|entry| entry.key().clone())
            .collect::<Vec<_>>();
        self.detach_keys(keys).await
    }

    pub(super) async fn detach_keys(&self, keys: Vec<ConnectionCacheKey>) -> Vec<Arc<CacheEntry>> {
        let mut retired = Vec::new();
        for key in keys {
            if let Some((_, slot)) = self.inner.slots.remove(&key) {
                if let Some(entry) = slot.lock().await.entry.take() {
                    retired.push(entry);
                }
            }
        }
        retired
    }
}

impl crate::features::providers::ports::ProviderBindingRevocationPort for ConnectionManager {
    fn force_fence<'a>(
        &'a self,
        binding_id: ProviderBindingId,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<()>> + Send + 'a>> {
        Box::pin(async move {
            self.force_fence_provider_binding(binding_id).await;
            Ok(())
        })
    }
}

impl crate::features::providers::ports::ProvisioningRuntimePort for ConnectionManager {
    fn smoke<'a>(
        &'a self,
        connection_id: Uuid,
        connection_revision: i64,
        provider: crate::features::providers::LocalProvider,
        engine: Engine,
        access: crate::features::providers::ProvisioningAccessMode,
    ) -> Pin<Box<dyn Future<Output = AppResult<()>> + Send + 'a>> {
        Box::pin(async move {
            let access = match access {
                crate::features::providers::ProvisioningAccessMode::Read => ConnectionAccess::Read,
                crate::features::providers::ProvisioningAccessMode::Write => {
                    ConnectionAccess::Write
                }
            };
            let context = self.pin(connection_id, access).await?;
            let pin = context.pin();
            let expected_provider = match provider {
                crate::features::providers::LocalProvider::PlanetScale => Provider::PlanetScale,
                crate::features::providers::LocalProvider::Neon => Provider::Neon,
                crate::features::providers::LocalProvider::GcpCloudSql => Provider::GcpCloudSql,
            };
            if pin.connection_revision != connection_revision
                || pin.profile.provider != expected_provider
                || pin.profile.engine != engine
                || pin.profile.credential_mode != WorkspaceCredentialMode::Managed
            {
                return Err(scope_changed());
            }
            context.test_fresh().await
        })
    }

    fn force_fence<'a>(
        &'a self,
        connection_id: Uuid,
    ) -> Pin<Box<dyn Future<Output = AppResult<()>> + Send + 'a>> {
        Box::pin(async move {
            let _session_gate = self.inner.session_gate.write().await;
            self.revoke_sessions(Some(connection_id), "managed access provisioning destroyed")
                .await;
            let keys = self
                .inner
                .slots
                .iter()
                .filter(|entry| entry.key().connection_id == connection_id)
                .map(|entry| entry.key().clone())
                .collect::<Vec<_>>();
            let retired = self.detach_keys(keys).await;
            retire_entries(retired).await;
            Ok(())
        })
    }
}
