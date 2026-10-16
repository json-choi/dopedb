//! Closed catalog of workspace administration operations.
//!
//! The webview names one operation; this module validates its identifiers and
//! bounded text and projects it onto exactly one hosted control-plane route. Every
//! path segment is a literal or a UUID, so no request can reach an arbitrary route.
//! The control plane stays the authority for membership, grants, provider payload
//! fields and every other decision; this layer only bounds what Desktop may send.

mod operation;
mod routes;
mod values;

use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::kernel::identity::{AccountId, WorkspaceId};

pub(crate) use operation::WorkspaceAdminOperation;
use routes::workspace_path;
use values::OAuthProvider;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(60);
// Matches the control plane's own `maxDuration` for provider mutations so Desktop
// never abandons a still-running server step and retries into a busy claim.
const PROVIDER_MUTATION_TIMEOUT: Duration = Duration::from_secs(300);
// Key rotation holds a 70 second server claim per request.
const KEY_ROTATION_TIMEOUT: Duration = Duration::from_secs(75);

const DEFAULT_RESPONSE_BYTES: usize = 1024 * 1024;
const LARGE_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const CONNECTION_LIST_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

const MAX_QUERY_VALUE_CHARS: usize = 512;
const MAX_CANDIDATE_PAYLOAD_BYTES: usize = 16 * 1024;
const MAX_NEON_PLAN_REQUEST_BYTES: usize = 12 * 1024;

/// The account that authorizes an operation travels beside it so a background
/// account switch can never redirect an in-flight administration request.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceAdminRequest {
    pub(crate) account_id: AccountId,
    pub(crate) operation: WorkspaceAdminOperation,
}

/// Starts a provider OAuth authorization. Desktop opens the returned start page
/// itself so the one-use state never reaches the webview.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProviderAuthorizationRequest {
    pub(crate) account_id: AccountId,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) provider: OAuthProvider,
}

impl ProviderAuthorizationRequest {
    pub(crate) fn route(&self) -> AppResult<AdminRoute> {
        Ok(AdminRoute::post(
            workspace_path(self.workspace_id, &["provider-integrations"]),
            json!({ "provider": self.provider.as_str() }),
        )?
        .with_timeout(DEFAULT_TIMEOUT))
    }
}

/// The HTTP status and bounded JSON body of one control-plane response. Error
/// bodies are returned as data so the screen can show the server's reason and
/// branch on documented conflict codes without parsing transport text.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceAdminResponse {
    pub(crate) status: u16,
    pub(crate) body: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AdminMethod {
    Get,
    Post,
    Patch,
    Delete,
}

/// One fully validated control-plane request. Path segments are encoded by the
/// adapter one segment at a time; literals and UUIDs are the only values used.
pub(crate) struct AdminRoute {
    pub(crate) method: AdminMethod,
    pub(crate) segments: Vec<String>,
    pub(crate) query: Vec<(&'static str, String)>,
    pub(crate) body: Option<Zeroizing<Vec<u8>>>,
    pub(crate) expected_revision: Option<i64>,
    pub(crate) timeout: Duration,
    pub(crate) max_response_bytes: usize,
}

impl fmt::Debug for AdminRoute {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AdminRoute")
            .field("method", &self.method)
            .field("segments", &self.segments)
            .field(
                "query_keys",
                &self.query.iter().map(|(key, _)| *key).collect::<Vec<_>>(),
            )
            .field("has_body", &self.body.is_some())
            .field("expected_revision", &self.expected_revision)
            .finish()
    }
}

impl AdminRoute {
    fn new(method: AdminMethod, segments: Vec<String>) -> Self {
        Self {
            method,
            segments,
            query: Vec::new(),
            body: None,
            expected_revision: None,
            timeout: DEFAULT_TIMEOUT,
            max_response_bytes: DEFAULT_RESPONSE_BYTES,
        }
    }

    fn get(segments: Vec<String>) -> Self {
        Self::new(AdminMethod::Get, segments)
    }

    fn post(segments: Vec<String>, body: Value) -> AppResult<Self> {
        Self::new(AdminMethod::Post, segments).with_body(&body)
    }

    fn post_empty(segments: Vec<String>) -> Self {
        Self::new(AdminMethod::Post, segments)
    }

    fn patch(segments: Vec<String>, body: Value) -> AppResult<Self> {
        Self::new(AdminMethod::Patch, segments).with_body(&body)
    }

    fn delete(segments: Vec<String>) -> Self {
        Self::new(AdminMethod::Delete, segments)
    }

    fn delete_with_body(segments: Vec<String>, body: Value) -> AppResult<Self> {
        Self::new(AdminMethod::Delete, segments).with_body(&body)
    }

    fn with_body(mut self, body: &Value) -> AppResult<Self> {
        self.body = Some(Zeroizing::new(serde_json::to_vec(body)?));
        Ok(self)
    }

    fn with_query(mut self, key: &'static str, value: String) -> Self {
        self.query.push((key, value));
        self
    }

    fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    fn with_max_response_bytes(mut self, maximum: usize) -> Self {
        self.max_response_bytes = maximum;
        self
    }

    fn with_expected_revision(mut self, revision: i64) -> AppResult<Self> {
        if revision < 0 {
            return Err(invalid("expected revision"));
        }
        self.expected_revision = Some(revision);
        Ok(self)
    }
}

fn invalid(field: &str) -> AppError {
    AppError::Config(format!("workspace administration {field} is invalid"))
}

/// The start page is the only browser destination Desktop opens for a provider
/// authorization: same validated origin, exact path, and a single opaque state.
pub(crate) fn validated_provider_start_url(
    origin: &str,
    body: Option<&Value>,
) -> AppResult<String> {
    let start_url = body
        .and_then(|body| body.get("startUrl"))
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("provider authorization start"))?;
    let expected = Url::parse(origin).map_err(|_| invalid("control-plane origin"))?;
    let url = Url::parse(start_url).map_err(|_| invalid("provider authorization start"))?;
    let state_ok = {
        let mut pairs = url.query_pairs();
        match (pairs.next(), pairs.next()) {
            (Some((key, value)), None) => {
                key == "state"
                    && (32..=256).contains(&value.len())
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            }
            _ => false,
        }
    };
    if url.scheme() != expected.scheme()
        || url.host_str() != expected.host_str()
        || url.port_or_known_default() != expected.port_or_known_default()
        || url.path() != "/auth/provider/start"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !state_ok
    {
        return Err(invalid("provider authorization start"));
    }
    Ok(url.into())
}

/// Ensures the account named by the webview is one this device has signed in.
pub(crate) fn require_signed_in_account(
    signed_in: &[AccountId],
    account_id: &AccountId,
) -> AppResult<()> {
    if signed_in.iter().any(|account| account == account_id) {
        Ok(())
    } else {
        Err(AppError::AuthenticationRequired("workspace".into()))
    }
}

#[cfg(test)]
pub(crate) fn assert_workspace_admin_route_contract() {
    use uuid::Uuid;

    let workspace_id = WorkspaceId::from(Uuid::nil());
    let operation: WorkspaceAdminOperation = serde_json::from_value(json!({
        "kind": "changeMemberRole",
        "workspaceId": workspace_id,
        "memberId": Uuid::nil(),
        "role": "editor",
    }))
    .expect("member role operation decodes");
    let route = operation.route().expect("member role route");
    assert_eq!(route.method, AdminMethod::Patch);
    assert_eq!(
        route.segments,
        vec![
            "api",
            "v1",
            "workspaces",
            &Uuid::nil().to_string(),
            "members"
        ]
    );
    // Unknown operations, unknown fields and the non-assignable owner role fail closed.
    assert!(serde_json::from_value::<WorkspaceAdminOperation>(json!({
        "kind": "proxy", "path": "/api/auth/desktop/token",
    }))
    .is_err());
    assert!(serde_json::from_value::<WorkspaceAdminOperation>(json!({
        "kind": "listMembers", "workspaceId": workspace_id, "path": "../internal",
    }))
    .is_err());
    assert!(serde_json::from_value::<WorkspaceAdminOperation>(json!({
        "kind": "changeMemberRole", "workspaceId": workspace_id,
        "memberId": Uuid::nil(), "role": "owner",
    }))
    .is_err());
    assert!(serde_json::from_value::<WorkspaceAdminOperation>(json!({
        "kind": "listConnectionGrants", "workspaceId": workspace_id,
        "connectionId": "../../account/sessions",
    }))
    .is_err());
    // A deletion confirmation is compared exactly and is never trimmed.
    let deletion: WorkspaceAdminOperation = serde_json::from_value(json!({
        "kind": "scheduleWorkspaceDeletion", "workspaceId": workspace_id,
        "requestId": Uuid::nil(), "confirmation": " Team ",
    }))
    .expect("deletion operation decodes");
    let body: Value = serde_json::from_slice(
        deletion
            .route()
            .expect("deletion route")
            .body
            .as_deref()
            .expect("body"),
    )
    .expect("deletion body");
    assert_eq!(body["confirmation"], " Team ");
    // Workspace names follow the control plane's UTF-16 limit, not UTF-8 bytes.
    let korean = "가".repeat(120);
    assert!(WorkspaceAdminOperation::CreateWorkspace { name: korean }
        .route()
        .is_ok());
    assert!(WorkspaceAdminOperation::CreateWorkspace {
        name: "가".repeat(121)
    }
    .route()
    .is_err());
    // Provider start pages must stay on the control-plane origin.
    let origin = "https://app.example.test";
    let state = "s".repeat(43);
    let accepted = json!({ "startUrl": format!("{origin}/auth/provider/start?state={state}") });
    assert!(validated_provider_start_url(origin, Some(&accepted)).is_ok());
    for rejected in [
        format!("https://evil.example.test/auth/provider/start?state={state}"),
        format!("{origin}/settings?state={state}"),
        format!("{origin}/auth/provider/start?state={state}&next=https://evil.example.test"),
        format!("{origin}/auth/provider/start?state=short"),
    ] {
        assert!(
            validated_provider_start_url(origin, Some(&json!({ "startUrl": rejected }))).is_err()
        );
    }
}
