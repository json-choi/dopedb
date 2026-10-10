//! Shared HTTP mechanics for authenticated DopeDB hosted adapters.
//!
//! Feature adapters own their routes, request contracts, and response DTOs. This
//! module owns only the validated origin, pooled client, and bounded common error
//! decoding so no feature has to reach through another feature's adapter.

use std::net::IpAddr;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::{redirect::Policy, Client, Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

const DEFAULT_CONTROL_PLANE_ORIGIN: &str = "https://app.dopedb.dev";
pub(crate) const EXPECTED_REVISION_HEADER: &str = "x-dopedb-expected-revision";
const MANAGED_CONNECTION_RECOVERY_REQUIRED_CODE: &str = "managed_connection_recovery_required";
/// A lease raced a concurrent authority change. Unlike every other lease
/// conflict, retrying with current access can succeed without any repair.
const MANAGED_LEASE_AUTHORITY_CHANGED_CODE: &str = "managed_lease_authority_changed";
/// The authority named by `AppError::AuthenticationRequired` when this device's
/// workspace session is missing or was rejected: the member signs in again.
pub(crate) const WORKSPACE_AUTHENTICATION: &str = "Workspace";

static CONTROL_PLANE_CLIENT: OnceLock<Client> = OnceLock::new();

#[derive(Debug, Deserialize)]
struct ControlPlaneErrorResponse {
    code: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    message: Option<String>,
}

fn is_loopback_host(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .trim_start_matches('[')
                .trim_end_matches(']')
                .parse::<IpAddr>()
                .is_ok_and(|address| address.is_loopback())
    })
}

pub(crate) fn origin() -> AppResult<String> {
    let raw = std::env::var("DOPEDB_WORKSPACE_ORIGIN")
        .unwrap_or_else(|_| DEFAULT_CONTROL_PLANE_ORIGIN.to_string())
        .trim_end_matches('/')
        .to_string();
    let url = Url::parse(&raw)
        .map_err(|_| AppError::Config("workspace control-plane origin is invalid".into()))?;
    let local_debug_origin =
        cfg!(debug_assertions) && url.scheme() == "http" && is_loopback_host(&url);
    if (url.scheme() != "https" && !local_debug_origin)
        || url.username() != ""
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::Config(
            "workspace control-plane origin must be an HTTPS origin".into(),
        ));
    }
    Ok(raw)
}

pub(crate) fn client() -> AppResult<&'static Client> {
    if let Some(client) = CONTROL_PLANE_CLIENT.get() {
        return Ok(client);
    }
    // Shared connections authorize every database operation with the control plane.
    // Keeping the TLS connection warm across reading pauses avoids paying a fresh
    // handshake (hundreds of milliseconds) on the next page, sort, or filter.
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(300))
        .tcp_keepalive(Duration::from_secs(60))
        .redirect(Policy::none())
        .https_only(!cfg!(debug_assertions))
        .user_agent(concat!("DopeDB/", env!("CARGO_PKG_VERSION"), " desktop"))
        .build()
        .map_err(|error| AppError::Network(format!("could not create HTTP client: {error}")))?;
    let _ = CONTROL_PLANE_CLIENT.set(client);
    CONTROL_PLANE_CLIENT
        .get()
        .ok_or_else(|| AppError::Network("could not initialize the shared HTTP client".into()))
}

pub(crate) fn request_error(action: &str, error: reqwest::Error) -> AppError {
    AppError::Network(format!("{action} failed: {error}"))
}

fn response_source(status: StatusCode) -> &'static str {
    if status == StatusCode::UNAUTHORIZED {
        "workspace authentication"
    } else {
        "workspace service"
    }
}

fn control_plane_response_error(status: StatusCode, code: Option<&str>, detail: &str) -> AppError {
    if status == StatusCode::CONFLICT && code == Some(MANAGED_CONNECTION_RECOVERY_REQUIRED_CODE) {
        return AppError::ManagedConnectionRecoveryRequired;
    }
    let source = response_source(status);
    AppError::Network(format!("{source} returned {status}: {detail}"))
}

/// Classify a failed managed-lease issuance.
///
/// The lease endpoint marks a provider integration, canonical resource, or
/// brokered target that no longer matches the connection with the recovery code.
/// Repeating the request cannot fix that; a Workspace manager must repair it.
/// Workspace services that predate the code answer such failures with 404 (the
/// integration is gone) or 424 (the provider rejected its credential), so those
/// statuses classify the same way. A code-less 409 can also be a transient race
/// there, so it stays retryable. Session (401), permission (403), admission
/// (429), and upstream (5xx) failures keep their generic meaning, and the
/// explicit authority-race code stays retryable.
fn managed_lease_error(status: StatusCode, code: Option<&str>, detail: &str) -> AppError {
    let repairable_status = matches!(
        status,
        StatusCode::NOT_FOUND | StatusCode::FAILED_DEPENDENCY
    );
    if code == Some(MANAGED_LEASE_AUTHORITY_CHANGED_CODE) {
        return AppError::Network(format!(
            "workspace service returned {status}: workspace database access changed concurrently"
        ));
    }
    if (code == Some(MANAGED_CONNECTION_RECOVERY_REQUIRED_CODE)
        && status.is_client_error()
        && !matches!(
            status,
            StatusCode::UNAUTHORIZED | StatusCode::TOO_MANY_REQUESTS
        ))
        || (code.is_none() && repairable_status)
    {
        return AppError::ManagedConnectionRecoveryRequired;
    }
    control_plane_response_error(status, code, detail)
}

fn is_json_media_type(value: Option<&str>) -> bool {
    value
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .is_some_and(|media_type| {
            media_type.eq_ignore_ascii_case("application/json")
                || media_type.to_ascii_lowercase().ends_with("+json")
        })
}

pub(crate) fn require_json_response(response: &Response, action: &str) -> AppResult<()> {
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    if is_json_media_type(content_type) {
        return Ok(());
    }
    Err(AppError::Network(format!(
        "{action} returned an unexpected {} response; the connected workspace service does not support this app feature yet",
        response.status()
    )))
}

pub(crate) async fn bounded_json_response<T: DeserializeOwned>(
    mut response: Response,
    action: &str,
    maximum: usize,
) -> AppResult<T> {
    require_json_response(&response, action)?;
    if response
        .content_length()
        .is_some_and(|length| length > maximum as u64)
    {
        return Err(AppError::Network(format!(
            "{action} returned an oversized response"
        )));
    }

    let initial_capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or(0)
        .min(maximum);
    // This is the application-owned copy of the bounded response. It can carry
    // managed lease/provider credentials, so wipe it on every success or error
    // path. reqwest and TLS implementation buffers are not owned here.
    let mut body = Zeroizing::new(Vec::with_capacity(initial_capacity));
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| request_error(action, error))?
    {
        if chunk.len() > maximum.saturating_sub(body.len()) {
            return Err(AppError::Network(format!(
                "{action} returned an oversized response"
            )));
        }
        body.extend_from_slice(&chunk);
    }
    if body.is_empty() {
        return Err(AppError::Network(format!(
            "{action} returned an empty response"
        )));
    }
    serde_json::from_slice(body.as_slice())
        .map_err(|_| AppError::Network(format!("{action} returned an incompatible response")))
}

/// Status, optional machine code, and bounded printable detail of one failure.
async fn decoded_response_error(response: Response) -> (StatusCode, Option<String>, String) {
    let status = response.status();
    let body = bounded_json_response::<ControlPlaneErrorResponse>(
        response,
        "reading the workspace error",
        64 * 1024,
    )
    .await
    .ok();
    let detail = body
        .as_ref()
        .and_then(|value| {
            value
                .error_description
                .as_deref()
                .or(value.message.as_deref())
                .or(value.error.as_deref())
        })
        .filter(|value| {
            !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
        })
        .unwrap_or("the control plane rejected the request")
        .to_owned();
    let code = body.and_then(|value| value.code);
    (status, code, detail)
}

pub(crate) async fn response_error(response: Response) -> AppError {
    let (status, code, detail) = decoded_response_error(response).await;
    control_plane_response_error(status, code.as_deref(), &detail)
}

/// Decode a failed managed-lease issuance with [`managed_lease_error`] semantics.
pub(crate) async fn managed_lease_response_error(response: Response) -> AppError {
    let (status, code, detail) = decoded_response_error(response).await;
    managed_lease_error(status, code.as_deref(), &detail)
}

#[cfg(test)]
pub(crate) fn assert_shared_http_client_contract() {
    let first = client().expect("the control-plane HTTP client is available");
    let second = client().expect("the control-plane HTTP client remains available");
    assert!(std::ptr::eq(first, second));
    assert!(is_json_media_type(Some("application/json")));
    assert!(is_json_media_type(Some(
        "application/problem+json; charset=utf-8"
    )));
    assert!(!is_json_media_type(Some("text/html; charset=utf-8")));
    assert_eq!(
        response_source(StatusCode::UNAUTHORIZED),
        "workspace authentication"
    );
    assert_eq!(
        response_source(StatusCode::BAD_REQUEST),
        "workspace service"
    );
    let recovery = control_plane_response_error(
        StatusCode::CONFLICT,
        Some(MANAGED_CONNECTION_RECOVERY_REQUIRED_CODE),
        "untrusted upstream detail",
    );
    assert_eq!(recovery.kind(), "managedConnectionRecoveryRequired");
    assert_eq!(
        recovery.to_string(),
        "managed workspace connection repair is required"
    );
    assert!(matches!(
        control_plane_response_error(
            StatusCode::BAD_REQUEST,
            Some(MANAGED_CONNECTION_RECOVERY_REQUIRED_CODE),
            "invalid request",
        ),
        AppError::Network(_)
    ));
    // Lease issuance: provider/target mismatches need repair even from a workspace
    // service that predates the code; session, admission, and races stay generic.
    for (status, code) in [
        (StatusCode::NOT_FOUND, None),
        (StatusCode::FAILED_DEPENDENCY, None),
        (
            StatusCode::CONFLICT,
            Some(MANAGED_CONNECTION_RECOVERY_REQUIRED_CODE),
        ),
        (
            StatusCode::FORBIDDEN,
            Some(MANAGED_CONNECTION_RECOVERY_REQUIRED_CODE),
        ),
    ] {
        assert_eq!(
            managed_lease_error(status, code, "untrusted upstream detail").kind(),
            "managedConnectionRecoveryRequired",
        );
    }
    for (status, code) in [
        (StatusCode::UNAUTHORIZED, None),
        (StatusCode::FORBIDDEN, None),
        (StatusCode::CONFLICT, None),
        (
            StatusCode::TOO_MANY_REQUESTS,
            Some(MANAGED_CONNECTION_RECOVERY_REQUIRED_CODE),
        ),
        (StatusCode::BAD_GATEWAY, None),
        (
            StatusCode::CONFLICT,
            Some(MANAGED_LEASE_AUTHORITY_CHANGED_CODE),
        ),
    ] {
        assert!(matches!(
            managed_lease_error(status, code, "detail"),
            AppError::Network(_)
        ));
    }
}
