//! Better Auth device grant, session, and membership HTTP exchanges.

use super::*;

#[derive(Debug, Deserialize)]
struct OAuthErrorResponse {
    error: Option<String>,
    error_description: Option<String>,
    message: Option<String>,
}

/// Start a single-use ten-minute device authorization request.
pub(super) async fn begin_login() -> AppResult<WorkspaceDeviceAuthorization> {
    let origin = origin()?;
    let response = client()?
        .post(format!("{origin}/api/auth/device/code"))
        .json(&json!({ "client_id": DESKTOP_CLIENT_ID }))
        .send()
        .await
        .map_err(|error| request_error("starting workspace login", error))?;
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let value: DeviceCodeResponse = crate::hosted_control_plane::bounded_json_response(
        response,
        "reading workspace login response",
        MAX_AUTH_RESPONSE_BYTES,
    )
    .await?;
    let expected_verification_prefix = format!("{origin}/auth/device?user_code=");
    if !valid_device_code(&value.device_code)
        || !value
            .verification_uri_complete
            .starts_with(&expected_verification_prefix)
        || !(1..=60).contains(&value.interval)
        || !(1..=3600).contains(&value.expires_in)
    {
        return Err(AppError::Network(
            "workspace login returned an invalid device authorization response".into(),
        ));
    }
    Ok(WorkspaceDeviceAuthorization {
        device_code: value.device_code,
        user_code: value.user_code,
        verification_uri_complete: value.verification_uri_complete,
        expires_in: value.expires_in,
        interval: value.interval,
    })
}

async fn session_for_token(token: &str) -> AppResult<Option<WorkspaceAuthUser>> {
    let origin = origin()?;
    let response = client()?
        .get(format!("{origin}/api/v1/session"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| request_error("checking workspace session", error))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let session: SessionResponse = crate::hosted_control_plane::bounded_json_response(
        response,
        "reading workspace session",
        MAX_AUTH_RESPONSE_BYTES,
    )
    .await?;
    if Uuid::parse_str(&session.user.id).is_err()
        || session.user.email.trim().is_empty()
        || session.user.email.len() > 320
        || session.user.display_name.trim().is_empty()
        || session.user.display_name.len() > 120
    {
        return Err(AppError::Network(
            "workspace session returned an invalid user identity".into(),
        ));
    }
    Ok(Some(session.user))
}

/// Validate one account-specific session already stored in the OS credential store.
pub(super) async fn auth_user(user_id: &str) -> AppResult<Option<WorkspaceAuthUser>> {
    let Some(token) = fetch_workspace_session(user_id).await?.map(Zeroizing::new) else {
        return Ok(None);
    };
    let user = session_for_token(token.as_str()).await?;
    if user.as_ref().map(|user| user.id.as_str()) != Some(user_id) {
        delete_workspace_session(user_id).await?;
        return Ok(None);
    }
    Ok(user)
}

/// Revoke the current Better Auth session when the control plane is reachable, then
/// always remove the native client's credential. Remote revocation is best-effort so
/// losing the network cannot trap someone in a locally signed-in desktop session.
pub(super) async fn sign_out(user_id: &str) -> AppResult<()> {
    let token = fetch_workspace_session(user_id).await?.map(Zeroizing::new);
    if let Some(token) = token.as_deref() {
        let remote_result = async {
            let origin = origin()?;
            let response = client()?
                .post(format!("{origin}/api/auth/sign-out"))
                .bearer_auth(token)
                .json(&json!({}))
                .send()
                .await
                .map_err(|error| request_error("revoking workspace session", error))?;
            if response.status().is_success() || response.status() == StatusCode::UNAUTHORIZED {
                Ok(())
            } else {
                Err(oauth_error(response).await)
            }
        }
        .await;
        if let Err(error) = remote_result {
            tracing::warn!(
                %error,
                "workspace session could not be revoked remotely; deleting local credential"
            );
        }
    }
    delete_workspace_session(user_id).await
}

/// Fetch organization memberships for the stored Bearer session. Only identifiers
/// and display names enter the local store; Better Auth remains membership authority.
pub(super) async fn remote_workspaces(user_id: &str) -> AppResult<Vec<RemoteWorkspace>> {
    let token = fetch_workspace_session(user_id)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            AppError::Config("workspace memberships require an authenticated session".into())
        })?;
    let origin = origin()?;
    let response = client()?
        .get(format!("{origin}/api/v1/workspaces"))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|error| request_error("loading workspace memberships", error))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        delete_workspace_session(user_id).await?;
        return Err(AppError::Network(
            "workspace session is no longer active".into(),
        ));
    }
    if !response.status().is_success() {
        return Err(oauth_error(response).await);
    }
    let payload: WorkspacesResponse = crate::hosted_control_plane::bounded_json_response(
        response,
        "reading workspace memberships",
        MAX_WORKSPACE_LIST_RESPONSE_BYTES,
    )
    .await?;
    require_response_item_count(
        payload.workspaces.len(),
        MAX_WORKSPACES_PER_ACCOUNT,
        "workspace memberships",
    )?;
    let mut workspaces = Vec::with_capacity(payload.workspaces.len());
    for workspace in payload.workspaces {
        let id = Uuid::parse_str(&workspace.id)
            .map(WorkspaceId::from)
            .map_err(|_| AppError::Network("workspace membership returned an invalid id".into()))?;
        let name = workspace.name.trim().to_string();
        if name.is_empty() || name.len() > 120 {
            return Err(AppError::Network(
                "workspace membership returned an invalid name".into(),
            ));
        }
        let role = parse_workspace_role(workspace.role.as_deref())?;
        workspaces.push(RemoteWorkspace { id, name, role });
    }
    Ok(workspaces)
}

/// Poll once at the server-provided interval. A successful token is validated and
/// committed directly to the OS credential store before signed-in state is returned.
pub(super) async fn poll_login(device_code: &str) -> AppResult<WorkspaceLoginPoll> {
    if !valid_device_code(device_code) {
        return Err(AppError::Config("invalid workspace device code".into()));
    }
    let origin = origin()?;
    let response = client()?
        .post(format!("{origin}/api/auth/device/token"))
        .json(&json!({
            "grant_type": DEVICE_GRANT,
            "device_code": device_code,
            "client_id": DESKTOP_CLIENT_ID,
        }))
        .send()
        .await
        .map_err(|error| request_error("polling workspace login", error))?;

    if response.status().is_success() {
        let payload: TokenResponse = crate::hosted_control_plane::bounded_json_response(
            response,
            "reading workspace session token",
            MAX_AUTH_RESPONSE_BYTES,
        )
        .await?;
        let token = payload.access_token;
        if token.len() < 20 || token.len() > 4096 || token.chars().any(char::is_whitespace) {
            return Err(AppError::Network(
                "workspace login returned an invalid session token".into(),
            ));
        }
        let user = session_for_token(token.as_str()).await?.ok_or_else(|| {
            AppError::Network("workspace login returned an inactive session".into())
        })?;
        store_workspace_session(&user.id, token.as_str()).await?;
        return Ok(WorkspaceLoginPoll {
            status: WorkspaceLoginPollStatus::SignedIn,
            user: Some(user),
        });
    }

    let status = response.status();
    let body: OAuthErrorResponse = crate::hosted_control_plane::bounded_json_response(
        response,
        "reading workspace login status",
        MAX_AUTH_RESPONSE_BYTES,
    )
    .await?;
    let poll_status = match body.error.as_deref() {
        Some("authorization_pending") => WorkspaceLoginPollStatus::Pending,
        Some("slow_down") => WorkspaceLoginPollStatus::SlowDown,
        Some("access_denied") => WorkspaceLoginPollStatus::Denied,
        Some("expired_token") | Some("invalid_grant") => WorkspaceLoginPollStatus::Expired,
        _ => {
            let detail = body
                .error_description
                .or(body.message)
                .unwrap_or_else(|| "the control plane rejected the request".into());
            return Err(AppError::Network(format!(
                "workspace login returned {status}: {detail}"
            )));
        }
    };
    Ok(WorkspaceLoginPoll {
        status: poll_status,
        user: None,
    })
}
