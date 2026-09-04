//! Hosted Better Auth RFC 8628 device authorization adapter. Network exchange
//! and credential persistence stay in Rust so Bearer sessions never cross into the
//! webview, logs, local SQLite, or frontend query caches.

mod authentication;
mod connections;
mod provider_local_target;
mod sync;

use std::time::Duration;

use dopedb_protocol::{
    valid_workspace_sync_cursor, ManagedAccessMode, ManagedLeaseRequest, ManagedLeaseResponse,
    WorkspaceSyncPageResponse, MANAGED_LEASE_CONTRACT_VERSION,
};
use reqwest::{Client, Response, StatusCode, Url};
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::connection::keychain::{
    delete_workspace_session, fetch_workspace_session, store_workspace_session,
};
use crate::connection::{
    ConnectionAccess, GcpCloudSqlNetworkMode,
    ManagedConnectionLease as RuntimeManagedConnectionLease, ProviderLocalResource,
    ProviderLocalTarget as RuntimeProviderLocalTarget, RemoteAuthorityFuture,
    RemoteConnectionAuthority as RuntimeRemoteConnectionAuthority, RemoteConnectionAuthorityPort,
};
use crate::error::{AppError, AppResult};
use crate::features::workspaces::{
    domain::{parse_workspace_role, valid_device_code},
    RemoteWorkspace, WorkspaceAuthUser, WorkspaceDeviceAuthorization, WorkspaceLoginPoll,
    WorkspaceLoginPollStatus, WorkspacePullPage,
};
use crate::kernel::identity::{AccountId, ConnectionId, ProviderIntegrationId, WorkspaceId};
use crate::model::{
    ConnectionProfile, ConnectionProviderTarget, Provider, WorkspaceConnectionAccess,
    WorkspaceCredentialMode,
};

use super::super::ports::WorkspaceControlPlanePort;
use authentication::{auth_user, begin_login, poll_login, remote_workspaces, sign_out};
use connections::{
    authorize_connection, delete_connection, issue_managed_connection_lease,
    release_managed_connection_lease, remote_connections, share_connection, update_connection,
};
use provider_local_target::provider_local_target;
use sync::workspace_pull_page;

const DESKTOP_CLIENT_ID: &str = "dopedb-desktop";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
const MAX_AUTH_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_WORKSPACE_LIST_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_CONNECTION_RESPONSE_BYTES: usize = 128 * 1024;
const MAX_CONNECTION_LIST_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_MANAGED_LEASE_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_WORKSPACE_SYNC_RESPONSE_BYTES: usize = 16 * 1024;
const MAX_WORKSPACES_PER_ACCOUNT: usize = 512;
const MAX_CONNECTIONS_PER_WORKSPACE: usize = 10_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri_complete: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Zeroizing<String>,
}

#[derive(Debug, Deserialize)]
struct SessionResponse {
    user: WorkspaceAuthUser,
}

#[derive(Debug, Deserialize)]
struct WorkspacesResponse {
    workspaces: Vec<RemoteWorkspaceResponse>,
}

#[derive(Debug, Deserialize)]
struct RemoteWorkspaceResponse {
    id: String,
    name: String,
    role: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteConnectionResponse {
    id: String,
    name: String,
    engine: String,
    provider: String,
    driver_id: Option<String>,
    host: String,
    port: u16,
    database: String,
    sslmode: String,
    readonly_default: bool,
    allow_writes: bool,
    env: Option<String>,
    schema_group: Option<String>,
    revision: i64,
    access_mode: String,
    credential_mode: String,
    provider_target: Option<ConnectionProviderTarget>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteConnectionsResponse {
    connections: Vec<RemoteConnectionResponse>,
}

#[derive(Debug, Deserialize)]
struct CreatedConnectionResponse {
    connection: RemoteConnectionResponse,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthorizedConnectionResponse {
    allowed: bool,
    action: String,
    access_mode: String,
    revision: i64,
}

pub(crate) struct ManagedConnectionLease {
    pub lease_id: Uuid,
    pub profile: ConnectionProfile,
    pub secret: Zeroizing<String>,
    pub valid_for: Duration,
    pub cloud_sql_proxy: Option<crate::connection::CloudSqlProxyConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RemoteConnectionAuthority {
    pub revision: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedConnectionRequest<'a> {
    name: &'a str,
    engine: &'a str,
    provider: &'a str,
    driver_id: &'a Option<String>,
    host: &'a str,
    port: u16,
    database: &'a str,
    sslmode: &'a str,
    readonly_default: bool,
    allow_writes: bool,
    env: &'a Option<String>,
    schema_group: &'a Option<String>,
}

/// The one canonical hosted-origin validator. Provider adapters reuse this
/// rather than accepting a second environment variable or a weaker fallback.
pub(crate) fn validated_control_plane_origin() -> AppResult<String> {
    crate::hosted_control_plane::origin()
}

// Child HTTP adapter modules retain this private spelling; cross-feature users
// must call the explicit validated export above.
fn origin() -> AppResult<String> {
    validated_control_plane_origin()
}

/// Build the hosted workspace console URL from the same validated origin used by
/// the auth API. Keeping this in Rust prevents the webview from opening an
/// arbitrary origin while still honoring the localhost override in debug builds.
pub(crate) fn console_url(workspace_id: Option<Uuid>) -> AppResult<String> {
    let mut url = Url::parse(&validated_control_plane_origin()?)
        .map_err(|_| AppError::Config("workspace control-plane origin is invalid".into()))?;
    url.set_path("/settings");
    if let Some(workspace_id) = workspace_id {
        let workspace_id = workspace_id.to_string();
        url.query_pairs_mut()
            .append_pair("workspace", &workspace_id);
        url.set_fragment(Some(&format!("workspace-{workspace_id}")));
    } else {
        url.set_fragment(Some("workspaces"));
    }
    Ok(url.into())
}

fn client() -> AppResult<&'static Client> {
    crate::hosted_control_plane::client()
}

fn request_error(action: &str, error: reqwest::Error) -> AppError {
    crate::hosted_control_plane::request_error(action, error)
}

fn require_response_item_count(actual: usize, maximum: usize, action: &str) -> AppResult<()> {
    if actual <= maximum {
        return Ok(());
    }
    Err(AppError::Network(format!(
        "{action} returned too many items"
    )))
}

async fn oauth_error(response: Response) -> AppError {
    crate::hosted_control_plane::response_error(response).await
}

#[cfg(test)]
pub(crate) fn assert_hosted_workspace_response_bounds_contract() {
    assert!(require_response_item_count(
        MAX_WORKSPACES_PER_ACCOUNT,
        MAX_WORKSPACES_PER_ACCOUNT,
        "workspace memberships",
    )
    .is_ok());
    assert!(require_response_item_count(
        MAX_WORKSPACES_PER_ACCOUNT + 1,
        MAX_WORKSPACES_PER_ACCOUNT,
        "workspace memberships",
    )
    .is_err());
    assert!(require_response_item_count(
        MAX_CONNECTIONS_PER_WORKSPACE,
        MAX_CONNECTIONS_PER_WORKSPACE,
        "shared connections",
    )
    .is_ok());
    assert!(require_response_item_count(
        MAX_CONNECTIONS_PER_WORKSPACE + 1,
        MAX_CONNECTIONS_PER_WORKSPACE,
        "shared connections",
    )
    .is_err());
}

/// Production bridge injected into the connection-pool runtime. Keeping this
/// implementation beside the HTTP client prevents the pool from reaching into a
/// global workspace module.
#[derive(Clone, Copy)]
pub(crate) struct HostedWorkspaceControlPlane;

impl RemoteConnectionAuthorityPort for HostedWorkspaceControlPlane {
    fn authorize<'a>(
        &'a self,
        account_id: &'a AccountId,
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
        access: ConnectionAccess,
    ) -> RemoteAuthorityFuture<'a, RuntimeRemoteConnectionAuthority> {
        Box::pin(async move {
            let authority = authorize_connection(
                account_id.as_str(),
                workspace_id.into(),
                connection_id.into(),
                access,
            )
            .await?;
            Ok(RuntimeRemoteConnectionAuthority {
                revision: authority.revision,
            })
        })
    }

    fn issue_managed_lease<'a>(
        &'a self,
        account_id: &'a AccountId,
        workspace_id: WorkspaceId,
        profile: &'a ConnectionProfile,
        access: ConnectionAccess,
    ) -> RemoteAuthorityFuture<'a, RuntimeManagedConnectionLease> {
        Box::pin(async move {
            let lease = issue_managed_connection_lease(
                account_id.as_str(),
                workspace_id.into(),
                profile,
                access,
            )
            .await?;
            Ok(RuntimeManagedConnectionLease {
                lease_id: lease.lease_id,
                profile: lease.profile,
                secret: lease.secret,
                valid_for: lease.valid_for,
                cloud_sql_proxy: lease.cloud_sql_proxy,
            })
        })
    }

    fn release_managed_lease<'a>(
        &'a self,
        account_id: &'a AccountId,
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
        lease_id: Uuid,
    ) -> RemoteAuthorityFuture<'a, ()> {
        Box::pin(release_managed_connection_lease(
            account_id.as_str(),
            workspace_id.into(),
            connection_id.into(),
            lease_id,
        ))
    }

    fn provider_local_target<'a>(
        &'a self,
        account_id: &'a AccountId,
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
    ) -> RemoteAuthorityFuture<'a, RuntimeProviderLocalTarget> {
        Box::pin(provider_local_target(
            account_id.as_str(),
            workspace_id.into(),
            connection_id,
        ))
    }
}

impl WorkspaceControlPlanePort for HostedWorkspaceControlPlane {
    async fn begin_login(&self) -> AppResult<WorkspaceDeviceAuthorization> {
        begin_login().await
    }

    async fn poll_login(&self, device_code: &str) -> AppResult<WorkspaceLoginPoll> {
        poll_login(device_code).await
    }

    async fn auth_user(&self, account_id: &AccountId) -> AppResult<Option<WorkspaceAuthUser>> {
        auth_user(account_id.as_str()).await
    }

    async fn sign_out(&self, account_id: &AccountId) -> AppResult<()> {
        sign_out(account_id.as_str()).await
    }

    async fn remote_workspaces(&self, account_id: &AccountId) -> AppResult<Vec<RemoteWorkspace>> {
        remote_workspaces(account_id.as_str()).await
    }

    async fn workspace_pull_page(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        cursor: Option<i64>,
    ) -> AppResult<Option<WorkspacePullPage>> {
        workspace_pull_page(account_id.as_str(), workspace_id.into(), cursor).await
    }

    async fn remote_connections(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
    ) -> AppResult<Option<Vec<(ConnectionProfile, i64)>>> {
        remote_connections(account_id.as_str(), workspace_id.into()).await
    }

    async fn share_connection(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        profile: &ConnectionProfile,
    ) -> AppResult<(ConnectionProfile, i64)> {
        share_connection(account_id.as_str(), workspace_id.into(), profile).await
    }

    async fn update_connection(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        profile: &ConnectionProfile,
        expected_revision: i64,
    ) -> AppResult<(ConnectionProfile, i64)> {
        update_connection(
            account_id.as_str(),
            workspace_id.into(),
            profile,
            expected_revision,
        )
        .await
    }

    async fn delete_connection(
        &self,
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        connection_id: ConnectionId,
        expected_revision: i64,
    ) -> AppResult<()> {
        delete_connection(
            account_id.as_str(),
            workspace_id.into(),
            connection_id.into(),
            expected_revision,
        )
        .await
    }

    fn console_url(&self, workspace_id: Option<WorkspaceId>) -> AppResult<String> {
        console_url(workspace_id.map(Into::into))
    }
}
