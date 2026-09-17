//! Desktop PKCE, session, and membership HTTP exchanges.

use super::*;

#[derive(Serialize)]
struct DesktopTokenRequest<'a> {
    grant_type: &'a str,
    code: &'a str,
    client_id: &'a str,
    redirect_uri: &'a str,
    code_verifier: &'a str,
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

/// Redeem the code with the native-only verifier and persist a verified session.
pub(super) async fn exchange_desktop_code(
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> AppResult<WorkspaceLoginResult> {
    let origin = origin()?;
    let response = client()?
        .post(format!("{origin}/api/auth/desktop/token"))
        .json(&DesktopTokenRequest {
            grant_type: "authorization_code",
            code,
            client_id: DESKTOP_CLIENT_ID,
            redirect_uri,
            code_verifier: verifier,
        })
        .send()
        .await
        .map_err(|_| AppError::Network("exchanging workspace login code failed".into()))?;
    if !response.status().is_success() {
        // Never reflect an upstream error that might contain the submitted code.
        return Err(AppError::Network(
            "workspace login code was rejected or expired".into(),
        ));
    }
    let payload: DesktopTokenResponse = crate::hosted_control_plane::bounded_json_response(
        response,
        "reading workspace session token",
        MAX_AUTH_RESPONSE_BYTES,
    )
    .await?;
    if payload.token_type != "Bearer" || !(1..=2_592_000).contains(&payload.expires_in) {
        return Err(AppError::Network(
            "workspace login returned an invalid token contract".into(),
        ));
    }
    accept_token(payload.access_token).await
}

async fn accept_token(token: Zeroizing<String>) -> AppResult<WorkspaceLoginResult> {
    if token.len() < 20 || token.len() > 4096 || token.chars().any(char::is_whitespace) {
        return Err(AppError::Network(
            "workspace login returned an invalid session token".into(),
        ));
    }
    let user = session_for_token(token.as_str())
        .await?
        .ok_or_else(|| AppError::Network("workspace login returned an inactive session".into()))?;
    store_workspace_session(&user.id, token.as_str()).await?;
    Ok(WorkspaceLoginResult {
        status: WorkspaceLoginStatus::SignedIn,
        user: Some(user),
    })
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
