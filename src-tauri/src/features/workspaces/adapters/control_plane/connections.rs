//! Redacted shared-connection and managed-lease HTTP exchanges.

use super::*;

fn safe_neon_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
}

fn safe_provider_display_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 256
        && !value.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '\u{202a}'
                        | '\u{202b}'
                        | '\u{202c}'
                        | '\u{202d}'
                        | '\u{202e}'
                        | '\u{2066}'
                        | '\u{2067}'
                        | '\u{2068}'
                        | '\u{2069}'
                )
        })
}

fn valid_provider_target(provider: &str, target: &ConnectionProviderTarget) -> bool {
    match target {
        ConnectionProviderTarget::Neon {
            project_id,
            branch_id,
            branch_name,
            ..
        } => {
            provider == "neon"
                && safe_neon_segment(project_id)
                && safe_neon_segment(branch_id)
                && branch_name
                    .as_deref()
                    .is_none_or(safe_provider_display_name)
        }
    }
}

fn remote_connection(value: RemoteConnectionResponse) -> AppResult<(ConnectionProfile, i64)> {
    let id = Uuid::parse_str(&value.id)
        .map_err(|_| AppError::Network("shared connection returned an invalid id".into()))?;
    if value.name.trim().is_empty()
        || value.name.len() > 120
        || value.host.len() > 512
        || !value.readonly_default
    {
        return Err(AppError::Network(
            "shared connection returned an unsafe template".into(),
        ));
    }
    let access = crate::store::parse_workspace_access(value.access_mode)?;
    if matches!(access, WorkspaceConnectionAccess::Local) {
        return Err(AppError::Network(
            "shared connection returned invalid access".into(),
        ));
    }
    let credential_mode = crate::store::parse_credential_mode(value.credential_mode)?;
    if credential_mode == WorkspaceCredentialMode::Local {
        return Err(AppError::Network(
            "shared connection returned invalid credential mode".into(),
        ));
    }
    if (credential_mode == WorkspaceCredentialMode::MemberLocal && value.allow_writes)
        || (value.allow_writes && !access.can_write())
    {
        return Err(AppError::Network(
            "shared connection returned invalid write authority".into(),
        ));
    }
    if value.provider_target.as_ref().is_some_and(|target| {
        credential_mode != WorkspaceCredentialMode::Managed
            || !valid_provider_target(&value.provider, target)
    }) {
        return Err(AppError::Network(
            "shared connection returned an invalid provider target".into(),
        ));
    }
    let revision = value.revision;
    if revision < 1 {
        return Err(AppError::Network(
            "shared connection returned invalid revision".into(),
        ));
    }
    Ok((
        ConnectionProfile {
            id,
            name: value.name,
            engine: crate::store::parse_engine(value.engine)?,
            provider: crate::store::parse_provider(value.provider)?,
            driver_id: value.driver_id,
            host: value.host,
            port: value.port,
            database: value.database,
            // Managed usernames and passwords are supplied only by the lease route.
            username: String::new(),
            sslmode: value.sslmode,
            extra_params: Default::default(),
            readonly_default: value.readonly_default,
            // Managed write authority is an effective server projection of the
            // live role, per-connection grant, and administrator policy.
            allow_writes: value.allow_writes && access.can_write(),
            secret_ref: None,
            env: value.env,
            schema_group: value.schema_group,
            workspace_access: access,
            credential_mode,
            provider_target: value.provider_target,
            schema_access_available: credential_mode == WorkspaceCredentialMode::Managed
                && value.schema_access_available,
        },
        revision,
    ))
}

/// Fetch redacted shared templates for a workspace using the OS-stored session.
pub(super) async fn remote_connections(
    user_id: &str,
    workspace_id: Uuid,
) -> AppResult<Option<Vec<(ConnectionProfile, i64)>>> {
    let token = fetch_workspace_session(user_id)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            AppError::Config("shared connections require an authenticated session".into())
        })?;
    let origin = origin()?;
    let response = client()?
        .get(format!(
            "{origin}/api/v1/workspaces/{workspace_id}/connections"
        ))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading shared connections", error))?;
    // An updated desktop can briefly reach the previous control-plane deployment.
    // Preserve the local cache instead of interpreting a missing route as no data.
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if response.status() == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
    }
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let payload: RemoteConnectionsResponse = crate::hosted_control_plane::bounded_json_response(
        response,
        "reading shared connections",
        MAX_CONNECTION_LIST_RESPONSE_BYTES,
    )
    .await?;
    require_response_item_count(
        payload.connections.len(),
        MAX_CONNECTIONS_PER_WORKSPACE,
        "shared connections",
    )?;
    let mut connections = Vec::with_capacity(payload.connections.len());
    for connection in payload.connections {
        connections.push(remote_connection(connection)?);
    }
    Ok(Some(connections))
}

/// Publish only the non-secret portion of a local connection. The request type has
/// no credential fields, making accidental serialization of `secret_ref` impossible.
pub(super) async fn share_connection(
    user_id: &str,
    workspace_id: Uuid,
    profile: &ConnectionProfile,
) -> AppResult<(ConnectionProfile, i64)> {
    let token = fetch_workspace_session(user_id)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            AppError::Config("sharing a connection requires an authenticated session".into())
        })?;
    let request = SharedConnectionRequest {
        name: &profile.name,
        engine: crate::store::engine_str(profile.engine),
        provider: crate::store::provider_str(profile.provider),
        driver_id: &profile.driver_id,
        host: &profile.host,
        port: profile.port,
        database: &profile.database,
        sslmode: &profile.sslmode,
        // Do not let a local write preference cross the shared-template boundary.
        readonly_default: true,
        allow_writes: false,
        env: &profile.env,
        schema_group: &profile.schema_group,
    };
    let origin = origin()?;
    let response = client()?
        .post(format!(
            "{origin}/api/v1/workspaces/{workspace_id}/connections"
        ))
        .bearer_auth(token.as_str())
        .header(crate::hosted_control_plane::EXPECTED_REVISION_HEADER, "0")
        .json(&request)
        .send()
        .await
        .map_err(|error| request_error("sharing connection", error))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
    }
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let payload: CreatedConnectionResponse = crate::hosted_control_plane::bounded_json_response(
        response,
        "reading shared connection",
        MAX_CONNECTION_RESPONSE_BYTES,
    )
    .await?;
    remote_connection(payload.connection)
}

/// Replace one redacted template using the content revision returned by the last
/// workspace sync. Member-local credentials are absent from the request type.
pub(super) async fn update_connection(
    user_id: &str,
    workspace_id: Uuid,
    profile: &ConnectionProfile,
    expected_revision: i64,
) -> AppResult<(ConnectionProfile, i64)> {
    let token = fetch_workspace_session(user_id)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            AppError::Config(
                "updating a shared connection requires an authenticated session".into(),
            )
        })?;
    let request = SharedConnectionRequest {
        name: &profile.name,
        engine: crate::store::engine_str(profile.engine),
        provider: crate::store::provider_str(profile.provider),
        driver_id: &profile.driver_id,
        host: &profile.host,
        port: profile.port,
        database: &profile.database,
        sslmode: &profile.sslmode,
        readonly_default: true,
        allow_writes: profile.credential_mode == WorkspaceCredentialMode::Managed
            && profile.allow_writes,
        env: &profile.env,
        schema_group: &profile.schema_group,
    };
    let origin = origin()?;
    let response = client()?
        .patch(format!(
            "{origin}/api/v1/workspaces/{workspace_id}/connections/{}",
            profile.id
        ))
        .bearer_auth(token.as_str())
        .header(
            crate::hosted_control_plane::EXPECTED_REVISION_HEADER,
            expected_revision,
        )
        .json(&request)
        .send()
        .await
        .map_err(|error| request_error("updating shared connection", error))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
    }
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let payload: CreatedConnectionResponse = crate::hosted_control_plane::bounded_json_response(
        response,
        "reading updated shared connection",
        MAX_CONNECTION_RESPONSE_BYTES,
    )
    .await?;
    remote_connection(payload.connection)
}

/// Roll back a newly shared template when a later local credential/cache step fails.
/// The server performs the same workspace and RBAC checks as every other mutation.
pub(super) async fn delete_connection(
    user_id: &str,
    workspace_id: Uuid,
    connection_id: Uuid,
    expected_revision: i64,
) -> AppResult<()> {
    let token = fetch_workspace_session(user_id)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            AppError::Config(
                "deleting a shared connection requires an authenticated session".into(),
            )
        })?;
    let origin = origin()?;
    let response = client()?
        .delete(format!(
            "{origin}/api/v1/workspaces/{workspace_id}/connections/{connection_id}"
        ))
        .bearer_auth(token.as_str())
        .header(
            crate::hosted_control_plane::EXPECTED_REVISION_HEADER,
            expected_revision,
        )
        .send()
        .await
        .map_err(|error| request_error("deleting shared connection", error))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
    }
    if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
        return Ok(());
    }
    Err(oauth_error(response).await)
}

/// Revalidate a shared connection action against the current Better Auth session,
/// membership, role, and resource scope immediately before local DB access.
pub(super) async fn authorize_connection(
    user_id: &str,
    workspace_id: Uuid,
    connection_id: Uuid,
    access: crate::connection::ConnectionAccess,
) -> AppResult<RemoteConnectionAuthority> {
    let token = fetch_workspace_session(user_id)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            AppError::Config("shared connection access requires an authenticated session".into())
        })?;
    let origin = origin()?;
    let response = client()?
        .post(format!(
            "{origin}/api/v1/workspaces/{workspace_id}/connections/{connection_id}"
        ))
        .bearer_auth(token.as_str())
        .json(&json!({ "action": match access {
            crate::connection::ConnectionAccess::Read => "read",
            crate::connection::ConnectionAccess::Write => "write",
            crate::connection::ConnectionAccess::Schema => "schema",
        } }))
        .send()
        .await
        .map_err(|error| request_error("authorizing shared connection", error))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
    }
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let authority: AuthorizedConnectionResponse =
        crate::hosted_control_plane::bounded_json_response(
            response,
            "reading shared connection authorization",
            MAX_AUTH_RESPONSE_BYTES,
        )
        .await?;
    let expected_action = match access {
        crate::connection::ConnectionAccess::Read => "read",
        crate::connection::ConnectionAccess::Write => "write",
        crate::connection::ConnectionAccess::Schema => "schema",
    };
    let workspace_access = crate::store::parse_workspace_access(authority.access_mode)?;
    if !authority.allowed
        || authority.action != expected_action
        || authority.revision < 1
        || workspace_access == WorkspaceConnectionAccess::Local
        || (access == crate::connection::ConnectionAccess::Schema && !workspace_access.can_manage())
        || (access == crate::connection::ConnectionAccess::Write && !workspace_access.can_write())
        || (access == crate::connection::ConnectionAccess::Read && !workspace_access.can_read())
    {
        return Err(AppError::Network(
            "shared connection authorization returned invalid authority".into(),
        ));
    }
    Ok(RemoteConnectionAuthority {
        revision: authority.revision,
    })
}

/// Obtain one provider-issued database credential for a managed shared connection.
/// The response password is moved into a zeroizing buffer immediately and never
/// touches the local store; the driver may retain it only inside the lease-bound pool.
pub(super) async fn issue_managed_connection_lease(
    user_id: &str,
    workspace_id: Uuid,
    profile: &ConnectionProfile,
    access: crate::connection::ConnectionAccess,
) -> AppResult<ManagedConnectionLease> {
    if profile.credential_mode != WorkspaceCredentialMode::Managed {
        return Err(AppError::Config(
            "managed credentials were requested for a local binding".into(),
        ));
    }
    let token = fetch_workspace_session(user_id)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            AppError::Config("managed database access requires an authenticated session".into())
        })?;
    let origin = origin()?;
    let requested_access = match access {
        crate::connection::ConnectionAccess::Read => ManagedAccessMode::Read,
        crate::connection::ConnectionAccess::Write => ManagedAccessMode::Write,
        crate::connection::ConnectionAccess::Schema => ManagedAccessMode::Schema,
    };
    let lease_request = ManagedLeaseRequest {
        access_mode: requested_access,
    };
    if !lease_request.validate() {
        return Err(AppError::Config(
            "managed database access request is incompatible".into(),
        ));
    }
    let response = client()?
        .post(format!(
            "{origin}/api/v1/workspaces/{workspace_id}/connections/{}/lease",
            profile.id
        ))
        .bearer_auth(token.as_str())
        .header(
            "x-dopedb-managed-lease-contract",
            MANAGED_LEASE_CONTRACT_VERSION,
        )
        .json(&lease_request)
        .send()
        .await
        .map_err(|error| request_error("requesting managed database access", error))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
    }
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let payload: ManagedLeaseResponse = crate::hosted_control_plane::bounded_json_response(
        response,
        "reading managed database access",
        MAX_MANAGED_LEASE_RESPONSE_BYTES,
    )
    .await?;
    if !payload.validate() {
        return Err(AppError::Network(
            "managed database access returned invalid connection material".into(),
        ));
    }
    let lease = payload.lease;
    let lease_id = Uuid::parse_str(&lease.id)
        .map_err(|_| AppError::Network("managed database access returned an invalid id".into()))?;
    let provider = crate::store::parse_provider(lease.provider.clone())?;
    let engine = crate::store::parse_engine(lease.engine.clone())?;
    if engine != profile.engine
        || provider != profile.provider
        || lease.access_mode != requested_access
        || (requested_access == ManagedAccessMode::Schema && !profile.workspace_access.can_manage())
        || (requested_access == ManagedAccessMode::Write && !profile.workspace_access.can_write())
    {
        return Err(AppError::Network(
            "managed database access returned invalid connection material".into(),
        ));
    }
    let expires_at = chrono::DateTime::parse_from_rfc3339(&lease.expires_at)
        .map_err(|_| AppError::Network("managed database access returned invalid expiry".into()))?
        .with_timezone(&chrono::Utc);
    let valid_seconds = expires_at
        .signed_duration_since(chrono::Utc::now())
        .num_seconds();
    if !(30..=20 * 60).contains(&valid_seconds) {
        return Err(AppError::Network(
            "managed database access returned an unsafe expiry".into(),
        ));
    }
    let dopedb_protocol::ManagedLeasePayload {
        host,
        port,
        database,
        username,
        password: secret,
        sslmode,
        tls_server_ca_pem,
        schema_owner,
        connector,
        ..
    } = lease;
    let mut leased_profile = profile.clone();
    leased_profile.provider = provider;
    leased_profile.host = host;
    leased_profile.port = port;
    leased_profile.database = database;
    leased_profile.username = username;
    leased_profile.sslmode = sslmode;
    leased_profile.extra_params.clear();
    if requested_access == ManagedAccessMode::Schema && provider == Provider::GcpCloudSql {
        leased_profile.extra_params.insert(
            "dopedb.schemaOwner".into(),
            schema_owner.unwrap_or_default(),
        );
    }
    if let Some(ca) = tls_server_ca_pem {
        leased_profile
            .extra_params
            .insert("sslrootcert_pem".into(), ca);
    }
    leased_profile.secret_ref = None;
    let cloud_sql_proxy = connector.map(|connector| {
        let network_mode = match connector.network_mode.as_str() {
            "PUBLIC" => GcpCloudSqlNetworkMode::Public,
            "PRIVATE_SERVICES_ACCESS" => GcpCloudSqlNetworkMode::PrivateServicesAccess,
            "PRIVATE_SERVICE_CONNECT" => GcpCloudSqlNetworkMode::PrivateServiceConnect,
            _ => unreachable!("managed connector network mode was validated"),
        };
        crate::connection::CloudSqlProxyConfig {
            instance_connection_name: connector.instance_connection_name,
            access_token: connector.access_token,
            network_mode,
        }
    });
    tracing::debug!(
        connection_id = %profile.id,
        lease_id = %lease_id,
        valid_seconds,
        "opened short-lived managed database access"
    );
    Ok(ManagedConnectionLease {
        lease_id,
        profile: leased_profile,
        secret,
        valid_for: Duration::from_secs(valid_seconds as u64),
        cloud_sql_proxy,
    })
}

/// Release a provider credential before its natural expiry when the owning desktop
/// pool is retired. Failure is surfaced to the caller for logging, but never blocks
/// local pool closure.
pub(super) async fn release_managed_connection_lease(
    user_id: &str,
    workspace_id: Uuid,
    connection_id: Uuid,
    lease_id: Uuid,
) -> AppResult<()> {
    let Some(token) = fetch_workspace_session(user_id).await?.map(Zeroizing::new) else {
        return Ok(());
    };
    let origin = origin()?;
    let response = client()?
        .delete(format!(
            "{origin}/api/v1/workspaces/{workspace_id}/connections/{connection_id}/lease"
        ))
        .bearer_auth(token.as_str())
        .json(&json!({ "leaseId": lease_id }))
        .send()
        .await
        .map_err(|error| request_error("releasing managed database access", error))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
    }
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    Ok(())
}
