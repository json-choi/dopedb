//! Platform ports required by connection use cases.

use std::future::Future;

use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::AppResult;
use crate::features::catalog::DatabaseSummary;
use crate::kernel::identity::ConnectionId;
use crate::kernel::TerminalAuthority;
use crate::model::ConnectionProfile;

use super::domain::{DriverDescriptor, LocalDatabaseListener, LocalListenerTarget};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConnectionPermission {
    Read,
}

pub(crate) trait ConnectionCredentialVault: Send + Sync {
    fn fetch_profile(&self, profile: &ConnectionProfile) -> AppResult<Zeroizing<String>>;
    fn store(&self, id: &Uuid, secret: &str) -> AppResult<()>;
    fn delete(&self, id: &Uuid) -> AppResult<()>;
}

pub(crate) trait ConnectionRepositoryPort: Clone + Send + Sync + 'static {
    fn list(&self) -> impl Future<Output = AppResult<Vec<ConnectionProfile>>> + Send;

    fn ensure_write_scope(&self, id: ConnectionId) -> impl Future<Output = AppResult<()>> + Send;

    fn upsert(
        &self,
        profile: &ConnectionProfile,
    ) -> impl Future<Output = AppResult<ConnectionProfile>> + Send;

    fn clear_schema_cache(&self, id: ConnectionId) -> impl Future<Output = AppResult<()>> + Send;

    fn set_schema_group(
        &self,
        ids: &[ConnectionId],
        schema_group: Option<String>,
    ) -> impl Future<Output = AppResult<()>> + Send;

    fn delete(&self, id: ConnectionId) -> impl Future<Output = AppResult<()>> + Send;

    fn get(&self, id: ConnectionId) -> impl Future<Output = AppResult<ConnectionProfile>> + Send;
}

pub(crate) trait ProfileMutationPort: Send {
    fn retire_connection(self, id: ConnectionId) -> impl Future<Output = ()> + Send;
}

pub(crate) trait ScopeMutationPort: Send {
    fn retire_connections(self, ids: &[ConnectionId]) -> impl Future<Output = ()> + Send;
}

pub(crate) trait ConnectionMutationPort: Send {
    fn profile(&self) -> &ConnectionProfile;

    fn retire_connection(self, id: ConnectionId) -> impl Future<Output = ()> + Send;
}

pub(crate) trait AuthorizedConnectionPort: Send {
    fn profile(&self) -> &ConnectionProfile;
    fn test_fresh(self) -> impl Future<Output = AppResult<()>> + Send;
}

pub(crate) trait ConnectionRuntimePort: Clone + Send + Sync + 'static {
    type ProfileMutation: ProfileMutationPort;
    type ScopeMutation: ScopeMutationPort;
    type ConnectionMutation: ConnectionMutationPort;
    type AuthorizedConnection: AuthorizedConnectionPort;

    fn begin_profile_mutation(
        &self,
        id: ConnectionId,
    ) -> impl Future<Output = Self::ProfileMutation> + Send;

    fn begin_scope_mutation(&self) -> impl Future<Output = Self::ScopeMutation> + Send;

    fn begin_connection_mutation(
        &self,
        id: ConnectionId,
        permission: ConnectionPermission,
    ) -> impl Future<Output = AppResult<Self::ConnectionMutation>> + Send;

    fn authorize(
        &self,
        id: ConnectionId,
        permission: ConnectionPermission,
    ) -> impl Future<Output = AppResult<Self::AuthorizedConnection>> + Send;

    fn authorize_terminal(
        &self,
        authority: &TerminalAuthority,
        permission: ConnectionPermission,
    ) -> impl Future<Output = AppResult<Self::AuthorizedConnection>> + Send;
}

pub(crate) trait DriverRegistryPort: Clone + Send + Sync + 'static {
    fn list(&self) -> Vec<DriverDescriptor>;
    fn install(&self, id: &str) -> AppResult<DriverDescriptor>;
    fn validate(&self, profile: &ConnectionProfile) -> AppResult<()>;
}

pub(crate) trait AdHocConnectionPort: Clone + Send + Sync + 'static {
    fn test(
        &self,
        profile: &ConnectionProfile,
        password: Zeroizing<String>,
    ) -> impl Future<Output = AppResult<()>> + Send;

    fn discover_databases(
        &self,
        profile: &ConnectionProfile,
        password: Zeroizing<String>,
    ) -> impl Future<Output = AppResult<Vec<DatabaseSummary>>> + Send;
}

/// Credential-free loopback reachability probe used by local listener
/// discovery. Implementations may only open the exact candidate they are
/// handed, identify the protocol, and close; they never authenticate, run a
/// query, or read a client configuration or credential file.
pub(crate) trait LocalListenerProbePort: Clone + Send + Sync + 'static {
    fn probe(
        &self,
        target: LocalListenerTarget,
    ) -> impl Future<Output = Option<LocalDatabaseListener>> + Send;
}
