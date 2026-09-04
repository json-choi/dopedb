//! Connection management: live sqlx pools (a separate read-only pool per
//! connection), OS credential-store secret storage, and per-provider connection-string
//! tuning. Long-lived local credentials live only in the OS credential store; managed
//! credentials are short-lived process-memory leases. The CLI sees connection ids only.

mod cloud_sql_proxy;
pub mod keychain;
pub mod pool;
mod provider_local;
pub mod providers;
mod remote_authority;
mod runtime;
#[cfg(test)]
pub(crate) use runtime::{
    assert_gcp_mysql_grant_contract, assert_warm_cache_authorization_contract,
};
pub(crate) mod ssh;

pub(crate) use cloud_sql_proxy::CloudSqlProxyConfig;
pub use keychain::{delete_secret, fetch_secret, store_secret};
pub use pool::{DbPool, LiveConnection};
pub(crate) use provider_local::{
    GcpCloudSqlNetworkMode, ProviderLocalBindingPin, ProviderLocalConnectionPort,
    ProviderLocalPinRequest, ProviderLocalResolveRequest, ProviderLocalResource,
    ProviderLocalSecret, ProviderLocalTarget,
};
pub(crate) use provider_local::{ProviderLocalFuture, ResolvedProviderLocalConnection};
pub(crate) use remote_authority::{
    ManagedConnectionLease, RemoteAuthorityFuture, RemoteConnectionAuthority,
    RemoteConnectionAuthorityPort,
};
pub(crate) use runtime::{
    ConnectionAccess, ConnectionContext, ConnectionLease, ConnectionManager, ConnectionMutation,
    ConnectionOperationScope, ConnectionSessionRevocationPort,
};

/// The executor module refers to the engine-tagged pool enum as `Pool`; keep a
/// single definition (`DbPool`) and expose this alias so both names resolve.
pub use pool::DbPool as Pool;

use crate::error::{AppError, AppResult};
use crate::kernel::access::PinnedConnection;
use crate::kernel::TerminalAuthority;
use crate::model::{ConnectionProfile, Engine, WorkspaceConnectionAccess, WorkspaceCredentialMode};
use uuid::Uuid;

/// Validate a Terminal capability against the exact scope-pinned connection snapshot.
pub(crate) fn ensure_terminal_pin(
    authority: &TerminalAuthority,
    pin: &PinnedConnection,
) -> AppResult<()> {
    let matches = pin.scope.workspace_id == Uuid::from(authority.workspace_id)
        && pin.scope.account_scope.storage_key() == authority.account_scope.as_str()
        && pin.scope.generation == authority.scope_generation
        && pin.connection_id == Uuid::from(authority.connection_id)
        && pin.connection_revision == authority.connection_revision;
    if matches {
        Ok(())
    } else {
        Err(AppError::Blocked {
            reason: "Terminal connection authority is no longer current".into(),
        })
    }
}

/// Resolve the credential item referenced by a profile. Shared templates must carry
/// an account-specific binding; they never fall back to the connection UUID where a
/// different signed-in account's stale credential could exist.
pub fn fetch_profile_secret(profile: &ConnectionProfile) -> AppResult<String> {
    if profile.credential_mode == WorkspaceCredentialMode::Managed {
        return Err(AppError::Config(
            "managed credentials must be obtained from a short-lived lease".into(),
        ));
    }
    if profile.engine == Engine::Bigquery {
        return Ok(String::new());
    }
    let secret_id = match profile.secret_ref.as_deref() {
        Some(secret_ref) => Uuid::parse_str(secret_ref)
            .map_err(|_| AppError::Config("connection secret reference is invalid".into()))?,
        // A local profile without a reference intentionally uses socket/trust/no
        // password authentication. A referenced-but-missing item still fails.
        None if profile.workspace_access == WorkspaceConnectionAccess::Local => {
            return Ok(String::new())
        }
        None => return Err(AppError::CredentialBindingRequired),
    };
    fetch_secret(&secret_id)
}

/// One open connection of either family: the sqlx SQL stack or the MongoDB
/// document adapter. Callers pull this out of the shared connection map and
/// downcast with [`Live::sql`]/[`Live::mongo`] — a family mismatch is a hard,
/// fail-closed error, never a silent fallthrough.
#[derive(Clone)]
pub enum Live {
    Sql(LiveConnection),
    Mongo(crate::mongo::MongoConnection),
}

impl Live {
    /// The sqlx side of this connection; clear error for document databases.
    pub fn sql(&self) -> AppResult<&LiveConnection> {
        match self {
            Live::Sql(live) => Ok(live),
            Live::Mongo(_) => Err(AppError::Config(
                "this is a MongoDB document connection — SQL operations are not available on it"
                    .into(),
            )),
        }
    }

    /// The MongoDB side of this connection; clear error for SQL engines.
    pub fn mongo(&self) -> AppResult<&crate::mongo::MongoConnection> {
        match self {
            Live::Mongo(conn) => Ok(conn),
            Live::Sql(_) => Err(AppError::Config(
                "this is a SQL connection — document operations are not available on it".into(),
            )),
        }
    }

    /// Liveness probe against the live server.
    pub async fn test(&self) -> AppResult<()> {
        match self {
            Live::Sql(live) => live.test().await,
            Live::Mongo(conn) => conn.ping().await,
        }
    }

    /// Close provider-backed pools when their lease expires. Mongo clients have no
    /// asynchronous close primitive; dropping their final handle closes the client.
    pub async fn close(&self) {
        if let Live::Sql(live) = self {
            live.close().await;
        }
    }
}
