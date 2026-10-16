//! Hosted control-plane adapter for workspace administration.
//!
//! The account's Bearer session is read from the OS credential store for one
//! request and never leaves Rust. Responses are returned as status plus bounded
//! JSON; a 401 is reported to the screen instead of deleting the stored session,
//! because some routes relay upstream authorization failures with that status.

use reqwest::header::CONTENT_TYPE;
use reqwest::{Method, Response, StatusCode};
use serde_json::Value;
use url::Url;
use zeroize::Zeroizing;

use crate::connection::keychain::fetch_workspace_session;
use crate::error::{AppError, AppResult};
use crate::hosted_control_plane::{self, EXPECTED_REVISION_HEADER};
use crate::kernel::identity::AccountId;

use super::domain::{AdminMethod, AdminRoute, WorkspaceAdminResponse};
use super::ports::WorkspaceAdminControlPlanePort;

const ACTION: &str = "workspace administration request";

#[derive(Clone, Copy)]
pub(crate) struct HostedWorkspaceAdmin;

fn route_url(origin: &str, route: &AdminRoute) -> AppResult<Url> {
    let mut url = Url::parse(origin)
        .map_err(|_| AppError::Config("workspace control-plane origin is invalid".into()))?;
    {
        let mut path = url
            .path_segments_mut()
            .map_err(|_| AppError::Config("workspace control-plane origin is invalid".into()))?;
        path.clear();
        for segment in &route.segments {
            path.push(segment);
        }
    }
    if !route.query.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in &route.query {
            pairs.append_pair(key, value);
        }
    }
    Ok(url)
}

async fn optional_json_body(response: Response, maximum: usize) -> AppResult<Option<Value>> {
    let status = response.status();
    if status == StatusCode::NO_CONTENT
        || response.content_length() == Some(0)
        || hosted_control_plane::require_json_response(&response, ACTION).is_err()
    {
        return Ok(None);
    }
    match hosted_control_plane::bounded_json_response::<Value>(response, ACTION, maximum).await {
        Ok(body) => Ok(Some(body)),
        // A malformed error body still leaves a usable status for the screen.
        Err(_) if !status.is_success() => Ok(None),
        Err(error) => Err(error),
    }
}

impl WorkspaceAdminControlPlanePort for HostedWorkspaceAdmin {
    async fn execute(
        &self,
        account_id: &AccountId,
        route: AdminRoute,
    ) -> AppResult<WorkspaceAdminResponse> {
        let token = fetch_workspace_session(account_id.as_str())
            .await?
            .map(Zeroizing::new)
            .ok_or_else(|| AppError::AuthenticationRequired("workspace".into()))?;
        let url = route_url(&hosted_control_plane::origin()?, &route)?;
        let method = match route.method {
            AdminMethod::Get => Method::GET,
            AdminMethod::Post => Method::POST,
            AdminMethod::Patch => Method::PATCH,
            AdminMethod::Delete => Method::DELETE,
        };
        let mut builder = hosted_control_plane::client()?
            .request(method, url)
            .bearer_auth(token.as_str())
            .timeout(route.timeout);
        if let Some(revision) = route.expected_revision {
            builder = builder.header(EXPECTED_REVISION_HEADER, revision.to_string());
        }
        if let Some(mut body) = route.body {
            // Move the bytes into the request instead of leaving a second copy.
            let bytes = std::mem::take(&mut *body);
            builder = builder.header(CONTENT_TYPE, "application/json").body(bytes);
        }
        let response = builder.send().await.map_err(|error| {
            if error.is_timeout() {
                AppError::Timeout(format!("{ACTION} did not finish in time"))
            } else {
                hosted_control_plane::request_error(ACTION, error)
            }
        })?;
        let status = response.status().as_u16();
        let body = optional_json_body(response, route.max_response_bytes).await?;
        Ok(WorkspaceAdminResponse { status, body })
    }

    fn origin(&self) -> AppResult<String> {
        hosted_control_plane::origin()
    }
}

#[cfg(test)]
pub(crate) fn assert_workspace_admin_url_contract() {
    use super::domain::WorkspaceAdminOperation;
    use crate::kernel::identity::WorkspaceId;
    use uuid::Uuid;

    let workspace_id = WorkspaceId::from(Uuid::nil());
    let route = serde_json::from_value::<WorkspaceAdminOperation>(serde_json::json!({
        "kind": "listProviderResources",
        "workspaceId": workspace_id,
        "integrationId": Uuid::nil(),
        "resourceKind": "databases",
        "selection": { "project": "a b&c=d/../x", "networkMode": "public" },
    }))
    .expect("resource listing decodes")
    .route()
    .expect("resource listing route");
    let url = route_url("https://app.example.test", &route).expect("route url");
    // Query values are percent-encoded pairs and can never add path segments.
    assert_eq!(
        url.path(),
        format!(
            "/api/v1/workspaces/{}/provider-integrations/{}/resources",
            Uuid::nil(),
            Uuid::nil()
        )
    );
    let pairs = url.query_pairs().collect::<Vec<_>>();
    assert!(pairs
        .iter()
        .any(|(key, value)| key == "project" && value == "a b&c=d/../x"));
    assert!(pairs
        .iter()
        .any(|(key, value)| key == "kind" && value == "databases"));
}
