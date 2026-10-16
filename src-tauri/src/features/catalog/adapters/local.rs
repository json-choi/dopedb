//! Scope-pinned catalog and DDL adapter.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Weak};
use std::time::Duration;

use dopedb_protocol::catalog::CatalogSnapshot;
use tokio::sync::{broadcast, Mutex, OwnedMutexGuard, OwnedSemaphorePermit, Semaphore};

use crate::connection::{
    ensure_terminal_pin, ConnectionAccess, ConnectionContext, ConnectionManager,
};
use crate::error::{AppError, AppResult};
use crate::introspect::{self, CatalogReadMode};
use crate::kernel::identity::ConnectionId;
use crate::kernel::TerminalAuthority;
use crate::model::{Engine, Provider, WorkspaceCredentialMode};
use crate::store::{CacheWriteOutcome, Store};

use super::super::domain::{CatalogChanged, CatalogOverview, CatalogReadPolicy, DatabaseSummary};
use super::super::ports::CatalogGatewayPort;

const CATALOG_OVERVIEW_TIMEOUT: Duration = Duration::from_secs(20);
const CATALOG_DETAIL_TIMEOUT: Duration = Duration::from_secs(60);
const CATALOG_DDL_TIMEOUT: Duration = Duration::from_secs(30);
/// One logical server connection may run one foreground overview alongside one
/// detail scan. Further catalog reads wait inside the request deadline instead
/// of exhausting a small driver pool or a remote database connection quota.
const MAX_CONCURRENT_CATALOG_READS_PER_CONNECTION: usize = 2;

fn database_bound_authority(pin: &crate::kernel::access::PinnedConnection) -> bool {
    let profile = &pin.profile;
    profile.credential_mode == WorkspaceCredentialMode::Managed
        || (pin.requires_remote_rbac
            && profile.credential_mode == WorkspaceCredentialMode::MemberLocal
            && matches!(profile.provider, Provider::Neon | Provider::GcpCloudSql))
}

async fn bounded_catalog_read<T>(
    label: &'static str,
    limit: Duration,
    operation: impl Future<Output = AppResult<T>>,
) -> AppResult<T> {
    tokio::time::timeout(limit, operation).await.map_err(|_| {
        AppError::Timeout(format!(
            "{label} exceeded its {} second foreground limit; retry schema loading",
            limit.as_secs()
        ))
    })?
}

impl From<CatalogReadPolicy> for CatalogReadMode {
    fn from(policy: CatalogReadPolicy) -> Self {
        match policy {
            CatalogReadPolicy::CacheFirst => Self::CacheFirst,
            CatalogReadPolicy::Refresh => Self::Refresh,
            CatalogReadPolicy::Uncached => Self::Uncached,
        }
    }
}

#[derive(Clone)]
pub(crate) struct ScopedCatalogGateway {
    store: Store,
    connections: ConnectionManager,
    loads: CatalogLoadCoordinator,
    reads: CatalogReadCoordinator,
}

/// Serializes cache misses and refreshes per connection. The bounded and full
/// catalog projections share one persisted snapshot, so concurrent live scans only
/// duplicate target-database work and can exhaust a small read pool.
#[derive(Clone, Default)]
struct CatalogLoadCoordinator {
    locks: Arc<Mutex<HashMap<ConnectionId, Weak<Mutex<()>>>>>,
}

impl CatalogLoadCoordinator {
    async fn acquire(&self, connection_id: ConnectionId) -> OwnedMutexGuard<()> {
        let lock = {
            let mut locks = self.locks.lock().await;
            locks.retain(|_, lock| lock.strong_count() > 0);
            if let Some(lock) = locks.get(&connection_id).and_then(Weak::upgrade) {
                lock
            } else {
                let lock = Arc::new(Mutex::new(()));
                locks.insert(connection_id, Arc::downgrade(&lock));
                lock
            }
        };
        lock.lock_owned().await
    }
}

/// Applies the documented per-server catalog read cap to overview, detail,
/// database discovery, snapshot and DDL introspection paths.
#[derive(Clone, Default)]
struct CatalogReadCoordinator {
    gates: Arc<Mutex<HashMap<ConnectionId, Weak<Semaphore>>>>,
}

impl CatalogReadCoordinator {
    async fn acquire(&self, connection_id: ConnectionId) -> AppResult<OwnedSemaphorePermit> {
        let gate = {
            let mut gates = self.gates.lock().await;
            gates.retain(|_, gate| gate.strong_count() > 0);
            if let Some(gate) = gates.get(&connection_id).and_then(Weak::upgrade) {
                gate
            } else {
                let gate = Arc::new(Semaphore::new(MAX_CONCURRENT_CATALOG_READS_PER_CONNECTION));
                gates.insert(connection_id, Arc::downgrade(&gate));
                gate
            }
        };
        gate.acquire_owned().await.map_err(|_| {
            AppError::Config("catalog read coordinator closed unexpectedly".to_owned())
        })
    }
}

impl ScopedCatalogGateway {
    async fn prepare_runtime(&self, connection_id: ConnectionId) -> AppResult<()> {
        // Tool preparation has its own download deadline. It must complete before
        // the foreground database deadline starts; the read then re-pins authority.
        let pin = self
            .store
            .pin_connection_for_read(connection_id.into())
            .await?;
        if pin.profile.engine == Engine::Bigquery {
            crate::bigquery::install_managed_cli().await?;
        }
        Ok(())
    }

    pub(crate) fn new(store: Store, connections: ConnectionManager) -> Self {
        Self {
            store,
            connections,
            loads: CatalogLoadCoordinator::default(),
            reads: CatalogReadCoordinator::default(),
        }
    }

    /// Introspect one exact database live inside an already pinned scope. Reading the
    /// configured database also replaces the persisted snapshot, so CLI cache-first
    /// readers never keep serving a catalog older than the one Desktop shows.
    async fn live_snapshot(
        &self,
        context: ConnectionContext,
        connection_id: ConnectionId,
        database: Option<String>,
    ) -> AppResult<CatalogSnapshot> {
        let configured = context.pin().profile.database.clone();
        let database = database.unwrap_or_else(|| configured.clone());
        if database.trim().is_empty() {
            return Err(AppError::Config(
                "Catalog V2 requires an explicit database name".into(),
            ));
        }
        let configured_database = database == configured;
        let _load = if configured_database {
            // The configured database shares the persisted snapshot with cache-first
            // and refresh readers; serialize with them instead of scanning twice.
            Some(self.loads.acquire(connection_id).await)
        } else {
            None
        };
        let _read = self.reads.acquire(connection_id).await?;
        // Taken before the scan: a schema change committed during it retires the write.
        let epoch = self.store.catalog_epoch(connection_id.into()).await;
        let lease = context.connect_to_database(Some(database.clone())).await?;
        let catalog = introspect::introspect(lease.live()).await?;
        let mut profile = lease.pin().profile.clone();
        profile.database = database;
        let snapshot = introspect::snapshot_from_catalog(&profile, &catalog)?;
        if configured_database {
            match self
                .store
                .put_catalog_if_current(lease.pin(), &snapshot, epoch)
                .await?
            {
                CacheWriteOutcome::Stored
                | CacheWriteOutcome::NotPersisted
                | CacheWriteOutcome::Superseded => {}
                CacheWriteOutcome::Stale => {
                    return Err(AppError::Blocked {
                        reason: "workspace or connection access changed; retry schema loading"
                            .into(),
                    });
                }
            }
        }
        Ok(snapshot)
    }
}

impl CatalogGatewayPort for ScopedCatalogGateway {
    async fn load_snapshot(
        &self,
        connection_id: ConnectionId,
        policy: CatalogReadPolicy,
    ) -> AppResult<CatalogSnapshot> {
        self.prepare_runtime(connection_id).await?;
        bounded_catalog_read("catalog snapshot", CATALOG_DETAIL_TIMEOUT, async {
            let context = self
                .connections
                .pin(connection_id.into(), ConnectionAccess::Read)
                .await?;
            let _load = self.loads.acquire(connection_id).await;
            let _read = self.reads.acquire(connection_id).await?;
            introspect::load_catalog_snapshot_in_context(&self.store, context, policy.into()).await
        })
        .await
    }

    async fn load_overview(&self, connection_id: ConnectionId) -> AppResult<CatalogOverview> {
        // An overview deliberately has no Store path. It may be displayed while the
        // detailed catalog is still deferred, so persisting it as a CatalogSnapshot
        // would let a partial shape poison full-catalog consumers.
        self.prepare_runtime(connection_id).await?;
        bounded_catalog_read("catalog overview", CATALOG_OVERVIEW_TIMEOUT, async move {
            let context = self
                .connections
                .pin(connection_id.into(), ConnectionAccess::Read)
                .await?;
            let database = context.pin().profile.database.clone();
            let _read = self.reads.acquire(connection_id).await?;
            let lease = context.connect().await?;
            introspect::overview(lease.live(), &database).await
        })
        .await
    }

    async fn list_databases(&self, connection_id: ConnectionId) -> AppResult<Vec<DatabaseSummary>> {
        self.prepare_runtime(connection_id).await?;
        bounded_catalog_read("database discovery", CATALOG_OVERVIEW_TIMEOUT, async move {
            let context = self
                .connections
                .pin(connection_id.into(), ConnectionAccess::Read)
                .await?;
            let configured = context.pin().profile.database.clone();
            if database_bound_authority(context.pin()) {
                return Ok(vec![DatabaseSummary {
                    name: configured,
                    is_default: true,
                }]);
            }
            let _read = self.reads.acquire(connection_id).await?;
            let lease = context.connect().await?;
            introspect::databases(lease.live(), &configured).await
        })
        .await
    }

    async fn load_live_snapshot(
        &self,
        connection_id: ConnectionId,
        database: Option<String>,
    ) -> AppResult<CatalogSnapshot> {
        self.prepare_runtime(connection_id).await?;
        bounded_catalog_read(
            "database catalog snapshot",
            CATALOG_DETAIL_TIMEOUT,
            async move {
                let context = self
                    .connections
                    .pin(connection_id.into(), ConnectionAccess::Read)
                    .await?;
                self.live_snapshot(context, connection_id, database).await
            },
        )
        .await
    }

    async fn load_persisted_snapshot(
        &self,
        connection_id: ConnectionId,
    ) -> AppResult<Option<CatalogSnapshot>> {
        // Authorize exactly like a cache-first read, but never open a database session:
        // the renderer shows this only until the concurrent live read replaces it.
        bounded_catalog_read(
            "persisted catalog snapshot",
            CATALOG_OVERVIEW_TIMEOUT,
            async {
                let context = self
                    .connections
                    .pin(connection_id.into(), ConnectionAccess::Read)
                    .await?;
                self.store.get_catalog_if_current(context.pin()).await
            },
        )
        .await
    }

    fn subscribe_changes(&self) -> broadcast::Receiver<CatalogChanged> {
        self.store.subscribe_catalog_changes()
    }

    async fn load_database_overview(
        &self,
        connection_id: ConnectionId,
        database: String,
    ) -> AppResult<CatalogOverview> {
        self.prepare_runtime(connection_id).await?;
        bounded_catalog_read(
            "database catalog overview",
            CATALOG_OVERVIEW_TIMEOUT,
            async move {
                let context = self
                    .connections
                    .pin(connection_id.into(), ConnectionAccess::Read)
                    .await?;
                let _read = self.reads.acquire(connection_id).await?;
                let lease = context.connect_to_database(Some(database.clone())).await?;
                introspect::overview(lease.live(), &database).await
            },
        )
        .await
    }

    async fn load_terminal_snapshot(
        &self,
        authority: &TerminalAuthority,
        policy: CatalogReadPolicy,
    ) -> AppResult<CatalogSnapshot> {
        self.prepare_runtime(authority.connection_id).await?;
        bounded_catalog_read("terminal catalog snapshot", CATALOG_DETAIL_TIMEOUT, async {
            let authority_context = self
                .connections
                .pin(authority.connection_id.into(), ConnectionAccess::Read)
                .await?;
            ensure_terminal_pin(authority, authority_context.pin())?;
            let _load = self.loads.acquire(authority.connection_id).await;
            let _read = self.reads.acquire(authority.connection_id).await?;
            introspect::load_catalog_snapshot_in_context(
                &self.store,
                authority_context,
                policy.into(),
            )
            .await
        })
        .await
    }

    async fn list_terminal_databases(
        &self,
        authority: &TerminalAuthority,
    ) -> AppResult<Vec<DatabaseSummary>> {
        self.prepare_runtime(authority.connection_id).await?;
        bounded_catalog_read(
            "terminal database discovery",
            CATALOG_OVERVIEW_TIMEOUT,
            async {
                let context = self
                    .connections
                    .pin(authority.connection_id.into(), ConnectionAccess::Read)
                    .await?;
                ensure_terminal_pin(authority, context.pin())?;
                let configured = context.pin().profile.database.clone();
                if database_bound_authority(context.pin()) {
                    return Ok(vec![DatabaseSummary {
                        name: configured,
                        is_default: true,
                    }]);
                }
                let _read = self.reads.acquire(authority.connection_id).await?;
                let lease = context.connect().await?;
                introspect::databases(lease.live(), &configured).await
            },
        )
        .await
    }

    async fn load_terminal_database_snapshot(
        &self,
        authority: &TerminalAuthority,
        database: String,
    ) -> AppResult<CatalogSnapshot> {
        self.prepare_runtime(authority.connection_id).await?;
        bounded_catalog_read(
            "terminal database catalog snapshot",
            CATALOG_DETAIL_TIMEOUT,
            async {
                let context = self
                    .connections
                    .pin(authority.connection_id.into(), ConnectionAccess::Read)
                    .await?;
                ensure_terminal_pin(authority, context.pin())?;
                self.live_snapshot(context, authority.connection_id, Some(database))
                    .await
            },
        )
        .await
    }

    async fn table_ddl(
        &self,
        connection_id: ConnectionId,
        schema: Option<&str>,
        table: &str,
    ) -> AppResult<String> {
        self.prepare_runtime(connection_id).await?;
        bounded_catalog_read("table DDL", CATALOG_DDL_TIMEOUT, async move {
            let context = self
                .connections
                .pin(connection_id.into(), ConnectionAccess::Read)
                .await?;
            // DDL reads one relation and never touches the shared snapshot cache, so it
            // must not wait behind a full catalog scan holding the load lock.
            let _read = self.reads.acquire(connection_id).await?;
            let lease = context.connect().await?;
            introspect::table_ddl(lease.live(), schema, table).await
        })
        .await
    }

    async fn database_table_ddl(
        &self,
        connection_id: ConnectionId,
        database: String,
        schema: Option<&str>,
        table: &str,
    ) -> AppResult<String> {
        self.prepare_runtime(connection_id).await?;
        bounded_catalog_read("database table DDL", CATALOG_DDL_TIMEOUT, async move {
            let context = self
                .connections
                .pin(connection_id.into(), ConnectionAccess::Read)
                .await?;
            let _read = self.reads.acquire(connection_id).await?;
            let lease = context.connect_to_database(Some(database)).await?;
            introspect::table_ddl(lease.live(), schema, table).await
        })
        .await
    }
}
