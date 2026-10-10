//! Catalog refresh adapter used by Job planning and execution, and the schema-change
//! announcement an import that ran DDL makes through the catalog cache.

use dopedb_protocol::catalog::CatalogSnapshot;

use crate::error::AppResult;
use crate::features::catalog::{CatalogFeature, CatalogReadPolicy};
use crate::kernel::identity::ConnectionId;
use crate::store::Store;

use super::super::ports::JobCatalogPort;

#[derive(Clone)]
pub(in crate::features::jobs) struct JobCatalogAdapter {
    catalog: CatalogFeature,
    store: Store,
}

impl JobCatalogAdapter {
    pub(in crate::features::jobs) fn new(catalog: CatalogFeature, store: Store) -> Self {
        Self { catalog, store }
    }
}

impl JobCatalogPort for JobCatalogAdapter {
    async fn refresh(&self, connection_id: ConnectionId) -> AppResult<CatalogSnapshot> {
        self.catalog
            .load_snapshot(connection_id, CatalogReadPolicy::Refresh)
            .await
    }

    async fn read_before_schema_change(
        &self,
        connection_id: ConnectionId,
    ) -> AppResult<CatalogSnapshot> {
        self.catalog
            .load_snapshot(connection_id, CatalogReadPolicy::Uncached)
            .await
    }

    async fn schema_changed(&self, connection_id: ConnectionId) -> AppResult<()> {
        self.store.clear_schema_cache(connection_id.into()).await
    }
}
