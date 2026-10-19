//! Redacted shared-connection and managed-lease HTTP exchanges.

use super::*;

/// Opening a shared connection without a usable workspace session is a sign-in
/// recovery, never a connection setting the member should edit.
fn workspace_sign_in_required() -> AppError {
    AppError::AuthenticationRequired(crate::hosted_control_plane::WORKSPACE_AUTHENTICATION.into())
}

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

/// Build the redacted template body for a local profile. Only the closed MongoDB
/// options and the exact Cloudflare D1 identity are engine-specific; the shared
/// protocol boundary check runs here so an unshareable profile never leaves the
/// device, and the server applies the same rules again.
fn shared_connection_request(
    profile: &ConnectionProfile,
    allow_writes: bool,
) -> AppResult<SharedConnectionRequest<'_>> {
    let mongo_options = (profile.engine == crate::model::Engine::Mongodb)
        .then(|| crate::mongo::template_options(&profile.extra_params))
        .flatten();
    // `mongodb+srv` ignores the port; the template pins the driver default.
    let port = if mongo_options.as_ref().is_some_and(|options| options.srv) {
        dopedb_protocol::SHARED_MONGO_SRV_PORT
    } else {
        profile.port
    };
    let request = SharedConnectionRequest {
        name: &profile.name,
        engine: crate::store::engine_str(profile.engine),
        provider: crate::store::provider_str(profile.provider),
        driver_id: &profile.driver_id,
        host: &profile.host,
        port,
        database: &profile.database,
        sslmode: &profile.sslmode,
        readonly_default: true,
        allow_writes,
        env: &profile.env,
        schema_group: &profile.schema_group,
        mongo_options,
    };
    let template = dopedb_protocol::SharedConnectionTemplate {
        name: request.name.to_owned(),
        engine: request.engine.to_owned(),
        provider: request.provider.to_owned(),
        driver_id: request.driver_id.clone(),
        host: request.host.to_owned(),
        port: request.port,
        database: request.database.to_owned(),
        sslmode: request.sslmode.to_owned(),
        readonly_default: true,
        allow_writes: request.allow_writes,
        env: request.env.clone(),
        schema_group: request.schema_group.clone(),
        mongo_options: request.mongo_options.clone(),
    };
    if !template.validate_engine_boundary() {
        return Err(AppError::Config(
            "this connection cannot be shared as a workspace template".into(),
        ));
    }
    Ok(request)
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
    let mut credential_mode = crate::store::parse_credential_mode(value.credential_mode)?;
    // The wire keeps `member_local`; a provisioning status is what makes the
    // connection DopeDB-provisioned on this device.
    let mut username = String::new();
    if let Some(status) = value.provisioning.as_ref() {
        if credential_mode != WorkspaceCredentialMode::MemberLocal || !status.validate() {
            return Err(AppError::Network(
                "shared connection returned invalid provisioning".into(),
            ));
        }
        credential_mode = WorkspaceCredentialMode::Provisioned;
        // The principal name opens the connection only while it is ready with a
        // privilege level; every other state leaves it closed.
        if status.state == dopedb_protocol::DirectProvisioningState::Ready
            && status.level != dopedb_protocol::DirectLevel::None
        {
            username = status.principal_name.clone().unwrap_or_default();
        }
    }
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
    let engine = crate::store::parse_engine(value.engine.clone())?;
    let mut extra_params = std::collections::HashMap::new();
    if let Some(options) = value.mongo_options.as_ref() {
        // Options belong to MongoDB only; they become the template-owned driver
        // parameters, which a member binding can neither keep nor override.
        if engine != crate::model::Engine::Mongodb || !options.validate() {
            return Err(AppError::Network(
                "shared connection returned invalid MongoDB options".into(),
            ));
        }
        crate::mongo::apply_template_options(&mut extra_params, Some(options));
    }
    let template = dopedb_protocol::SharedConnectionTemplate {
        name: value.name.clone(),
        engine: value.engine.clone(),
        provider: value.provider.clone(),
        driver_id: value.driver_id.clone(),
        host: value.host.clone(),
        port: value.port,
        database: value.database.clone(),
        sslmode: value.sslmode.clone(),
        readonly_default: value.readonly_default,
        allow_writes: value.allow_writes,
        env: value.env.clone(),
        schema_group: value.schema_group.clone(),
        mongo_options: value.mongo_options.clone(),
    };
    // SQLite is shareable only as a member-authenticated Cloudflare D1 identity.
    if !template.validate_engine_boundary()
        || (engine == crate::model::Engine::Sqlite
            && credential_mode != WorkspaceCredentialMode::MemberLocal)
    {
        return Err(AppError::Network(
            "shared connection returned an unsafe template".into(),
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
            engine,
            provider: crate::store::parse_provider(value.provider)?,
            driver_id: value.driver_id,
            host: value.host,
            port: value.port,
            database: value.database,
            // Managed usernames and passwords are supplied only by the lease route;
            // a provisioned principal name is the only server-supplied username.
            username,
            sslmode: value.sslmode,
            extra_params,
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
    // Do not let a local write preference cross the shared-template boundary.
    let request = shared_connection_request(profile, false)?;
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
    let request = shared_connection_request(
        profile,
        profile.credential_mode == WorkspaceCredentialMode::Managed && profile.allow_writes,
    )?;
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
        .ok_or_else(workspace_sign_in_required)?;
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
        return Err(workspace_sign_in_required());
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
        .ok_or_else(workspace_sign_in_required)?;
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
        return Err(workspace_sign_in_required());
    }
    if !response.status().is_success() {
        return Err(crate::hosted_control_plane::managed_lease_response_error(response).await);
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

/// Contract assertions for the shared-template restore and request rules: MongoDB
/// options come back as template-owned driver parameters, and Cloudflare D1 is a
/// credential-less, member-authenticated identity.
#[cfg(test)]
pub(super) fn assert_shared_template_contract() {
    fn response(extra: serde_json::Value) -> RemoteConnectionResponse {
        let mut base = json!({
            "id": "11111111-1111-4111-8111-111111111111",
            "name": "Shared", "engine": "mongodb", "provider": "generic", "driverId": null,
            "host": "cluster0.example.test", "port": 27017, "database": "app",
            "sslmode": "require", "readonlyDefault": true, "allowWrites": false,
            "env": null, "schemaGroup": null, "revision": 1,
            "accessMode": "read", "credentialMode": "member_local", "providerTarget": null,
        });
        base.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value(base).expect("shared connection response decodes")
    }
    let (restored, _) = remote_connection(response(json!({
        "mongoOptions": { "srv": true, "authSource": "admin", "replicaSet": "rs0" }
    })))
    .expect("MongoDB options restore");
    let param = |name: &str| restored.extra_params.get(name).map(String::as_str);
    assert_eq!(
        (param("srv"), param("authSource"), param("replicaSet")),
        (Some("true"), Some("admin"), Some("rs0"))
    );
    assert!(restored.username.is_empty() && restored.secret_ref.is_none());
    for rejected in [
        json!({ "mongoOptions": { "srv": false, "authSource": "admin&tls=false" } }),
        json!({ "mongoOptions": { "srv": true }, "port": 27018 }),
        json!({ "engine": "postgres", "mongoOptions": { "srv": false } }),
    ] {
        assert!(remote_connection(response(rejected)).is_err());
    }
    let d1 = json!({
        "engine": "sqlite", "provider": "cloudflareD1", "driverId": "cloudflare-d1-wrangler",
        "host": "0123456789abcdef0123456789abcdef", "port": 443, "sslmode": "require",
        "database": "22222222-2222-4222-8222-222222222222",
    });
    let (profile, _) = remote_connection(response(d1.clone())).expect("D1 identity restores");
    assert!(profile.uses_cli_authentication() && profile.extra_params.is_empty());
    for rejected in [
        json!({ "database": "/tmp/app.db" }),
        json!({ "allowWrites": true }),
        json!({ "credentialMode": "managed" }),
    ] {
        let mut value = d1.clone();
        value
            .as_object_mut()
            .unwrap()
            .extend(rejected.as_object().unwrap().clone());
        assert!(remote_connection(response(value)).is_err());
    }
    // Sharing builds the closed option set and pins the SRV port; an unshareable
    // MongoDB option never leaves the device.
    let mut local = restored.clone();
    local.workspace_access = WorkspaceConnectionAccess::Local;
    local.port = 1;
    local
        .extra_params
        .insert("tlsCAFile".into(), "/ca.pem".into());
    let request = shared_connection_request(&local, false).expect("SRV profile shares");
    assert_eq!(request.port, dopedb_protocol::SHARED_MONGO_SRV_PORT);
    assert_eq!(
        request
            .mongo_options
            .as_ref()
            .and_then(|o| o.replica_set.as_deref()),
        Some("rs0")
    );
    assert!(!serde_json::to_string(&request)
        .unwrap()
        .contains("tlsCAFile"));
    local.extra_params.insert("authSource".into(), "a&b".into());
    assert!(shared_connection_request(&local, false).is_err());
}
