//! Saved connection feature composition.

mod adapters;
mod application;
mod demo;
mod domain;
mod ports;
pub(crate) mod transport;

use std::sync::Arc;

use crate::connection::ConnectionManager;
use crate::store::Store;

pub(crate) use adapters::system_connection_credentials;
use adapters::{
    RuntimeConnectionAuthority, SqliteConnectionRepository, SystemAdHocConnection,
    SystemDriverRegistry,
};
pub(crate) use application::{
    ConnectionProfileTestRequest, ConnectionUpsertRequest, ConnectionUseCases,
};
#[cfg(test)]
pub(crate) use domain::assert_connection_test_failure_contract;
pub(crate) use domain::{
    AgentConnectionSummary, CliConnectionResolutionError, ConnectionTestReceipt, DriverCapability,
    DriverDescriptor, DriverInstallMode, DriverInstallState, MAX_CONNECTION_CREDENTIAL_BYTES,
};
pub(crate) use ports::ConnectionCredentialVault;

pub(crate) type ConnectionsFeature = ConnectionUseCases<
    SqliteConnectionRepository,
    RuntimeConnectionAuthority,
    SystemDriverRegistry,
    SystemAdHocConnection,
    dyn ConnectionCredentialVault,
>;

pub(crate) fn compose(
    store: Store,
    connections: ConnectionManager,
    credentials: Arc<dyn ConnectionCredentialVault>,
) -> ConnectionsFeature {
    let ad_hoc = SystemAdHocConnection::new(connections.clone());
    ConnectionUseCases::new(
        SqliteConnectionRepository::new(store),
        RuntimeConnectionAuthority::new(connections),
        SystemDriverRegistry,
        ad_hoc,
        credentials,
    )
}
