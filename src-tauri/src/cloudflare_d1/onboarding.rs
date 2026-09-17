//! Workspace/member-scoped Wrangler browser OAuth and D1 resource discovery.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{process, CloudflareD1AuthScope};
use crate::error::{AppError, AppResult};
use crate::model::{
    ConnectionProfile, Engine, Provider, WorkspaceConnectionAccess, WorkspaceCredentialMode,
};

const AUTH_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_RESOURCES: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudflareD1AuthState {
    authenticated: bool,
    email: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudflareD1AccountSummary {
    id: String,
    name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudflareD1DatabaseSummary {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhoAmI {
    #[serde(default)]
    logged_in: bool,
    email: Option<String>,
    #[serde(default)]
    accounts: Vec<Account>,
}

#[derive(Deserialize)]
struct Account {
    id: String,
    name: String,
}

pub(crate) async fn auth_state(
    profile: ConnectionProfile,
    scope: &CloudflareD1AuthScope,
) -> AppResult<CloudflareD1AuthState> {
    validate_onboarding_profile(&profile)?;
    let root = auth_root(scope)?;
    if !root.is_dir() {
        return Ok(CloudflareD1AuthState {
            authenticated: false,
            email: None,
        });
    }
    let runtime = process::discover_runtime().await?;
    process::verify_version(&runtime, &root).await?;
    let value = process::run_json(
        &runtime,
        &["whoami".into(), "--json".into()],
        &root,
        None,
        DISCOVERY_TIMEOUT,
    )
    .await?;
    let whoami = parse_whoami(value)?;
    Ok(CloudflareD1AuthState {
        authenticated: whoami.logged_in,
        email: whoami.email.filter(|email| email.len() <= 320),
    })
}

pub(crate) async fn authenticate_account(
    profile: ConnectionProfile,
    scope: &CloudflareD1AuthScope,
) -> AppResult<CloudflareD1AuthState> {
    validate_onboarding_profile(&profile)?;
    let root = auth_root(scope)?;
    prepare_auth_directory(&root)?;
    let runtime = process::discover_runtime().await?;
    process::verify_version(&runtime, &root).await?;
    process::run_checked(
        &runtime,
        &[
            "login".into(),
            "--browser=true".into(),
            "--callback-host=localhost".into(),
            "--scopes".into(),
            "account:read".into(),
            "user:read".into(),
            "d1:write".into(),
        ],
        &root,
        None,
        AUTH_TIMEOUT,
    )
    .await?;
    auth_state(profile, scope).await
}

pub(crate) async fn discover_accounts(
    profile: ConnectionProfile,
    scope: &CloudflareD1AuthScope,
) -> AppResult<Vec<CloudflareD1AccountSummary>> {
    validate_onboarding_profile(&profile)?;
    let root = auth_root(scope)?;
    let runtime = process::discover_runtime().await?;
    process::verify_version(&runtime, &root).await?;
    let value = process::run_json(
        &runtime,
        &["whoami".into(), "--json".into()],
        &root,
        None,
        DISCOVERY_TIMEOUT,
    )
    .await?;
    let whoami = parse_whoami(value)?;
    if !whoami.logged_in {
        return Err(AppError::Config(
            "Cloudflare account is not connected; connect it and retry".into(),
        ));
    }
    Ok(whoami
        .accounts
        .into_iter()
        .take(MAX_RESOURCES)
        .filter(|account| valid_account_id(&account.id) && bounded_label(&account.name))
        .map(|account| CloudflareD1AccountSummary {
            id: account.id,
            name: account.name,
        })
        .collect())
}

pub(crate) async fn discover_databases(
    profile: ConnectionProfile,
    account_id: String,
    scope: &CloudflareD1AuthScope,
) -> AppResult<Vec<CloudflareD1DatabaseSummary>> {
    validate_onboarding_profile(&profile)?;
    let account_id = account_id.trim();
    if !valid_account_id(account_id) {
        return Err(AppError::Config("Cloudflare account id is invalid".into()));
    }
    let root = auth_root(scope)?;
    let runtime = process::discover_runtime().await?;
    process::verify_version(&runtime, &root).await?;
    let value = process::run_json(
        &runtime,
        &["d1".into(), "list".into(), "--json".into()],
        &root,
        Some(account_id),
        DISCOVERY_TIMEOUT,
    )
    .await?;
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= MAX_RESOURCES)
        .ok_or_else(|| AppError::Config("Wrangler returned an invalid D1 database list".into()))?;
    rows.iter()
        .map(|row| {
            let id = exact_string(row, "uuid")
                .filter(|id| uuid::Uuid::parse_str(id).is_ok())
                .ok_or_else(|| {
                    AppError::Config("Wrangler returned an invalid D1 database id".into())
                })?;
            let name = exact_string(row, "name")
                .filter(|name| bounded_label(name))
                .ok_or_else(|| {
                    AppError::Config("Wrangler returned an invalid D1 database name".into())
                })?;
            Ok(CloudflareD1DatabaseSummary {
                id: id.to_owned(),
                name: name.to_owned(),
            })
        })
        .collect()
}

pub(crate) fn auth_root(scope: &CloudflareD1AuthScope) -> AppResult<PathBuf> {
    Ok(crate::app_paths::local_data_root()?
        .join("cloudflare-wrangler-scoped")
        .join(scope.key()))
}

pub(crate) async fn cleanup_connection_auth(scope: &CloudflareD1AuthScope) -> AppResult<()> {
    let root = auth_root(scope)?;
    match tokio::fs::remove_dir_all(root).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn validate_onboarding_profile(profile: &ConnectionProfile) -> AppResult<()> {
    if profile.engine != Engine::Sqlite || profile.provider != Provider::CloudflareD1 {
        return Err(AppError::Config(
            "Cloudflare D1 onboarding requires a Cloudflare D1 profile".into(),
        ));
    }
    let owns_local_auth = matches!(
        (profile.workspace_access, profile.credential_mode),
        (
            WorkspaceConnectionAccess::Local,
            WorkspaceCredentialMode::Local
        )
    ) || (profile.workspace_access != WorkspaceConnectionAccess::Local
        && profile.workspace_access.can_read()
        && profile.credential_mode == WorkspaceCredentialMode::MemberLocal);
    if !owns_local_auth {
        return Err(AppError::Blocked {
            reason: "Cloudflare authentication requires a local profile or readable member-local workspace binding".into(),
        });
    }
    Ok(())
}

fn parse_whoami(value: Value) -> AppResult<WhoAmI> {
    let whoami: WhoAmI = serde_json::from_value(value)
        .map_err(|_| AppError::Config("Wrangler returned invalid account status".into()))?;
    if whoami.accounts.len() > MAX_RESOURCES {
        return Err(AppError::Blocked {
            reason: "Wrangler returned too many Cloudflare accounts".into(),
        });
    }
    Ok(whoami)
}

fn valid_account_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn bounded_label(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

fn exact_string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str()
}

fn prepare_auth_directory(path: &Path) -> AppResult<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
