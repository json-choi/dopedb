//! Platform contract required by catalog use cases.

use std::future::Future;

use dopedb_protocol::catalog::CatalogSnapshot;

use crate::error::AppResult;
use crate::kernel::identity::ConnectionId;
use crate::kernel::TerminalAuthority;

use super::domain::{CatalogOverview, CatalogReadPolicy, DatabaseSummary};

pub(crate) trait CatalogGatewayPort: Clone + Send + Sync + 'static {
    fn load_snapshot(
        &self,
        connection_id: ConnectionId,
        policy: CatalogReadPolicy,
    ) -> impl Future<Output = AppResult<CatalogSnapshot>> + Send;

    fn load_overview(
        &self,
        connection_id: ConnectionId,
    ) -> impl Future<Output = AppResult<CatalogOverview>> + Send;

    fn list_databases(
        &self,
        connection_id: ConnectionId,
    ) -> impl Future<Output = AppResult<Vec<DatabaseSummary>>> + Send;

    fn load_database_snapshot(
        &self,
        connection_id: ConnectionId,
        database: String,
    ) -> impl Future<Output = AppResult<CatalogSnapshot>> + Send;

    fn load_database_overview(
        &self,
        connection_id: ConnectionId,
        database: String,
    ) -> impl Future<Output = AppResult<CatalogOverview>> + Send;

    fn load_terminal_snapshot(
        &self,
        authority: &TerminalAuthority,
        policy: CatalogReadPolicy,
    ) -> impl Future<Output = AppResult<CatalogSnapshot>> + Send;

    fn list_terminal_databases(
        &self,
        authority: &TerminalAuthority,
    ) -> impl Future<Output = AppResult<Vec<DatabaseSummary>>> + Send;

    fn load_terminal_database_snapshot(
        &self,
        authority: &TerminalAuthority,
        database: String,
    ) -> impl Future<Output = AppResult<CatalogSnapshot>> + Send;

    fn table_ddl(
        &self,
        connection_id: ConnectionId,
        schema: Option<&str>,
        table: &str,
    ) -> impl Future<Output = AppResult<String>> + Send;

    fn database_table_ddl(
        &self,
        connection_id: ConnectionId,
        database: String,
        schema: Option<&str>,
        table: &str,
    ) -> impl Future<Output = AppResult<String>> + Send;
}
