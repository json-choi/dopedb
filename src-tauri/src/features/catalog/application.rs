//! Typed catalog use cases.

use dopedb_protocol::catalog::CatalogSnapshot;

use crate::error::AppResult;
use crate::kernel::identity::ConnectionId;
use crate::kernel::TerminalAuthority;

use super::domain::{CatalogOverview, CatalogReadPolicy, DatabaseSummary};
use super::ports::CatalogGatewayPort;

#[derive(Clone)]
pub(crate) struct CatalogUseCases<G> {
    gateway: G,
}

impl<G> CatalogUseCases<G>
where
    G: CatalogGatewayPort,
{
    pub(crate) fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub(crate) async fn load_snapshot(
        &self,
        connection_id: ConnectionId,
        policy: CatalogReadPolicy,
    ) -> AppResult<CatalogSnapshot> {
        self.gateway.load_snapshot(connection_id, policy).await
    }

    pub(crate) async fn load_overview(
        &self,
        connection_id: ConnectionId,
    ) -> AppResult<CatalogOverview> {
        self.gateway.load_overview(connection_id).await
    }

    pub(crate) async fn list_databases(
        &self,
        connection_id: ConnectionId,
    ) -> AppResult<Vec<DatabaseSummary>> {
        self.gateway.list_databases(connection_id).await
    }

    pub(crate) async fn load_database_snapshot(
        &self,
        connection_id: ConnectionId,
        database: String,
    ) -> AppResult<CatalogSnapshot> {
        self.gateway
            .load_database_snapshot(connection_id, database)
            .await
    }

    pub(crate) async fn load_database_overview(
        &self,
        connection_id: ConnectionId,
        database: String,
    ) -> AppResult<CatalogOverview> {
        self.gateway
            .load_database_overview(connection_id, database)
            .await
    }

    pub(crate) async fn load_terminal_snapshot(
        &self,
        authority: &TerminalAuthority,
        policy: CatalogReadPolicy,
    ) -> AppResult<CatalogSnapshot> {
        self.gateway.load_terminal_snapshot(authority, policy).await
    }

    pub(crate) async fn list_terminal_databases(
        &self,
        authority: &TerminalAuthority,
    ) -> AppResult<Vec<DatabaseSummary>> {
        self.gateway.list_terminal_databases(authority).await
    }

    pub(crate) async fn load_terminal_database_snapshot(
        &self,
        authority: &TerminalAuthority,
        database: String,
    ) -> AppResult<CatalogSnapshot> {
        self.gateway
            .load_terminal_database_snapshot(authority, database)
            .await
    }

    pub(crate) async fn table_ddl(
        &self,
        connection_id: ConnectionId,
        schema: Option<&str>,
        table: &str,
    ) -> AppResult<String> {
        self.gateway.table_ddl(connection_id, schema, table).await
    }

    pub(crate) async fn database_table_ddl(
        &self,
        connection_id: ConnectionId,
        database: String,
        schema: Option<&str>,
        table: &str,
    ) -> AppResult<String> {
        self.gateway
            .database_table_ddl(connection_id, database, schema, table)
            .await
    }
}
