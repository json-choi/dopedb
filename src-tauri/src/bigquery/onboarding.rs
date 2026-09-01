//! BigQuery connection onboarding through the official Google Cloud CLI.
//!
//! Browser OAuth and service-account credential import stay inside `gcloud`.
//! Desktop receives only authentication availability and bounded resource
//! identifiers, while `bq` remains the sole process that talks to BigQuery.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::{BigQueryAuthScope, MAX_LIST_RESULTS};
use crate::error::{AppError, AppResult};
use crate::model::{
    ConnectionProfile, Engine, Provider, WorkspaceConnectionAccess, WorkspaceCredentialMode,
};

mod auth_storage;
mod process;

use auth_storage::{audited_credential_path, prepare_auth_directory};
pub(crate) use auth_storage::{cleanup_connection_auth, cleanup_service_account_auth};
#[cfg(test)]
use auth_storage::{google_account_config, service_account_config};
use process::{run_checked, run_json, SdkExecutable};

const AUTH_MODE_PARAMETER: &str = "authMode";
const GOOGLE_ACCOUNT_MODE: &str = "googleAccount";
const SERVICE_ACCOUNT_MODE: &str = "serviceAccount";
const MAX_PROJECT_RESULTS: usize = 500;
const AUTH_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum BigQueryAuthMode {
    GoogleAccount,
    ServiceAccount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BigQueryAuthState {
    mode: BigQueryAuthMode,
    authenticated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BigQueryProjectSummary {
    id: String,
    name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BigQueryDatasetSummary {
    id: String,
}

pub(super) fn validate_auth_mode(profile: &ConnectionProfile) -> AppResult<()> {
    auth_mode(profile).map(|_| ())
}

pub(super) fn cloudsdk_config(
    profile: &ConnectionProfile,
    scope: &BigQueryAuthScope,
) -> AppResult<std::path::PathBuf> {
    auth_storage::cloudsdk_config(profile, scope)
}

pub(crate) fn uses_service_account_auth(profile: &ConnectionProfile) -> AppResult<bool> {
    Ok(auth_mode(profile)? == BigQueryAuthMode::ServiceAccount)
}

pub(crate) async fn auth_state(
    profile: ConnectionProfile,
    scope: &BigQueryAuthScope,
) -> AppResult<BigQueryAuthState> {
    validate_onboarding_profile(&profile)?;
    let mode = auth_mode(&profile)?;
    let config = cloudsdk_config(&profile, scope)?;
    if !config.is_dir() {
        return Ok(BigQueryAuthState {
            mode,
            authenticated: false,
        });
    }
    let value = run_json(
        SdkExecutable::Gcloud,
        &[
            "--quiet".into(),
            "--format=json(status)".into(),
            "auth".into(),
            "list".into(),
            "--filter=status:ACTIVE".into(),
        ],
        &config,
        DISCOVERY_TIMEOUT,
    )
    .await?;
    parse_auth_state(mode, &value)
}

pub(crate) async fn authenticate_google_account(
    profile: ConnectionProfile,
    scope: &BigQueryAuthScope,
) -> AppResult<BigQueryAuthState> {
    validate_onboarding_profile(&profile)?;
    if auth_mode(&profile)? != BigQueryAuthMode::GoogleAccount {
        return Err(AppError::Config(
            "select Google account authentication before starting browser login".into(),
        ));
    }
    let config = cloudsdk_config(&profile, scope)?;
    prepare_auth_directory(&config)?;
    run_checked(
        SdkExecutable::Gcloud,
        &[
            "--quiet".into(),
            "auth".into(),
            "login".into(),
            "--brief".into(),
            "--force".into(),
            "--launch-browser".into(),
        ],
        &config,
        AUTH_TIMEOUT,
    )
    .await?;
    auth_state(profile, scope).await
}

pub(crate) async fn authenticate_service_account(
    profile: ConnectionProfile,
    credential_file: String,
    scope: &BigQueryAuthScope,
) -> AppResult<BigQueryAuthState> {
    validate_onboarding_profile(&profile)?;
    if auth_mode(&profile)? != BigQueryAuthMode::ServiceAccount {
        return Err(AppError::Config(
            "select service account authentication before choosing a key file".into(),
        ));
    }
    let credential = audited_credential_path(Path::new(&credential_file))?;
    let config = cloudsdk_config(&profile, scope)?;
    prepare_auth_directory(&config)?;
    run_checked(
        SdkExecutable::Gcloud,
        &[
            "--quiet".into(),
            "auth".into(),
            "login".into(),
            format!("--cred-file={}", credential.to_string_lossy()),
            "--brief".into(),
        ],
        &config,
        AUTH_TIMEOUT,
    )
    .await?;
    auth_state(profile, scope).await
}

pub(crate) async fn discover_projects(
    profile: ConnectionProfile,
    scope: &BigQueryAuthScope,
) -> AppResult<Vec<BigQueryProjectSummary>> {
    validate_onboarding_profile(&profile)?;
    let config = cloudsdk_config(&profile, scope)?;
    let value = run_json(
        SdkExecutable::Gcloud,
        &[
            "--quiet".into(),
            "--format=json".into(),
            "projects".into(),
            "list".into(),
            format!("--limit={MAX_PROJECT_RESULTS}"),
            "--sort-by=projectId".into(),
        ],
        &config,
        DISCOVERY_TIMEOUT,
    )
    .await?;
    parse_projects(&value)
}

pub(crate) async fn discover_datasets(
    profile: ConnectionProfile,
    project_id: String,
    scope: &BigQueryAuthScope,
) -> AppResult<Vec<BigQueryDatasetSummary>> {
    validate_onboarding_profile(&profile)?;
    let project_id = project_id.trim();
    if !super::valid_project_id(project_id) {
        return Err(AppError::Config("BigQuery project ID is invalid".into()));
    }
    let config = cloudsdk_config(&profile, scope)?;
    let value = run_json(
        SdkExecutable::Bq,
        &[
            format!("--bigqueryrc={}", super::null_device()),
            "--api=https://bigquery.googleapis.com".into(),
            "--format=json".into(),
            "--headless=true".into(),
            "--quiet=true".into(),
            "--debug_mode=false".into(),
            "--disable_ssl_validation=false".into(),
            "--httplib2_debuglevel=0".into(),
            format!("--project_id={project_id}"),
            "ls".into(),
            "--datasets=true".into(),
            format!("--max_results={MAX_LIST_RESULTS}"),
            project_id.into(),
        ],
        &config,
        DISCOVERY_TIMEOUT,
    )
    .await?;
    parse_datasets(&value, project_id)
}

fn auth_mode(profile: &ConnectionProfile) -> AppResult<BigQueryAuthMode> {
    match profile
        .extra_params
        .get(AUTH_MODE_PARAMETER)
        .map(String::as_str)
    {
        None | Some(GOOGLE_ACCOUNT_MODE) => Ok(BigQueryAuthMode::GoogleAccount),
        Some(SERVICE_ACCOUNT_MODE) => Ok(BigQueryAuthMode::ServiceAccount),
        Some(_) => Err(AppError::Config(
            "BigQuery authMode must be googleAccount or serviceAccount".into(),
        )),
    }
}

fn validate_onboarding_profile(profile: &ConnectionProfile) -> AppResult<()> {
    if profile.engine != Engine::Bigquery || profile.provider != Provider::Generic {
        return Err(AppError::Config(
            "BigQuery onboarding requires a generic BigQuery profile".into(),
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
            reason:
                "BigQuery authentication requires a local profile or a readable member-local workspace binding"
                    .into(),
        });
    }
    validate_auth_mode(profile)
}

fn parse_auth_state(mode: BigQueryAuthMode, value: &Value) -> AppResult<BigQueryAuthState> {
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= 4)
        .ok_or_else(|| {
            AppError::Config("Google Cloud returned an invalid authentication status".into())
        })?;
    let authenticated = rows.iter().any(|row| {
        row.get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| status.eq_ignore_ascii_case("ACTIVE"))
    });
    Ok(BigQueryAuthState {
        mode,
        authenticated,
    })
}

fn parse_projects(value: &Value) -> AppResult<Vec<BigQueryProjectSummary>> {
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= MAX_PROJECT_RESULTS)
        .ok_or_else(|| AppError::Config("Google Cloud returned an invalid project list".into()))?;
    let mut projects = Vec::with_capacity(rows.len());
    for row in rows {
        if row
            .get("lifecycleState")
            .and_then(Value::as_str)
            .is_some_and(|state| state != "ACTIVE")
        {
            continue;
        }
        let id = row
            .get("projectId")
            .and_then(Value::as_str)
            .filter(|id| super::valid_project_id(id))
            .ok_or_else(|| {
                AppError::Config("Google Cloud returned an invalid project ID".into())
            })?;
        let name = row
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| valid_label(name, 256))
            .unwrap_or(id);
        projects.push(BigQueryProjectSummary {
            id: id.into(),
            name: name.into(),
        });
    }
    projects.sort_by(|left, right| left.id.cmp(&right.id));
    projects.dedup_by(|left, right| left.id == right.id);
    Ok(projects)
}

fn parse_datasets(value: &Value, expected_project: &str) -> AppResult<Vec<BigQueryDatasetSummary>> {
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= MAX_LIST_RESULTS as usize)
        .ok_or_else(|| AppError::Config("BigQuery returned an invalid dataset list".into()))?;
    let mut datasets = Vec::with_capacity(rows.len());
    for row in rows {
        let reference = row
            .get("datasetReference")
            .and_then(Value::as_object)
            .ok_or_else(|| AppError::Config("BigQuery dataset reference is missing".into()))?;
        let project = reference
            .get("projectId")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Config("BigQuery dataset project is missing".into()))?;
        if project != expected_project {
            return Err(AppError::Blocked {
                reason: "BigQuery returned a dataset outside the selected project".into(),
            });
        }
        let id = reference
            .get("datasetId")
            .and_then(Value::as_str)
            .filter(|id| super::valid_dataset_id(id))
            .ok_or_else(|| AppError::Config("BigQuery returned an invalid dataset ID".into()))?;
        datasets.push(BigQueryDatasetSummary { id: id.into() });
    }
    datasets.sort_by(|left, right| left.id.cmp(&right.id));
    datasets.dedup_by(|left, right| left.id == right.id);
    Ok(datasets)
}

fn valid_label(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.chars().count() <= maximum && !value.chars().any(char::is_control)
}

#[cfg(test)]
pub(super) fn assert_onboarding_contract() {
    let mut profile = ConnectionProfile {
        id: uuid::Uuid::new_v4(),
        name: "BigQuery onboarding".into(),
        engine: Engine::Bigquery,
        provider: Provider::Generic,
        driver_id: Some("google-bq-cli".into()),
        host: "sample-analytics-2026".into(),
        port: 443,
        database: "analytics_2026".into(),
        username: String::new(),
        sslmode: "require".into(),
        extra_params: Default::default(),
        readonly_default: true,
        allow_writes: false,
        secret_ref: None,
        env: None,
        schema_group: None,
        workspace_access: WorkspaceConnectionAccess::Local,
        credential_mode: crate::model::WorkspaceCredentialMode::Local,
        provider_target: None,
    };
    assert_eq!(
        auth_mode(&profile).unwrap(),
        BigQueryAuthMode::GoogleAccount
    );
    profile
        .extra_params
        .insert(AUTH_MODE_PARAMETER.into(), SERVICE_ACCOUNT_MODE.into());
    assert_eq!(
        auth_mode(&profile).unwrap(),
        BigQueryAuthMode::ServiceAccount
    );
    assert!(uses_service_account_auth(&profile).unwrap());

    profile.workspace_access = WorkspaceConnectionAccess::Read;
    profile.credential_mode = WorkspaceCredentialMode::MemberLocal;
    assert!(validate_onboarding_profile(&profile).is_ok());
    profile.workspace_access = WorkspaceConnectionAccess::View;
    assert!(matches!(
        validate_onboarding_profile(&profile),
        Err(AppError::Blocked { .. })
    ));
    profile.workspace_access = WorkspaceConnectionAccess::Manage;
    profile.credential_mode = WorkspaceCredentialMode::Managed;
    assert!(matches!(
        validate_onboarding_profile(&profile),
        Err(AppError::Blocked { .. })
    ));
    profile.workspace_access = WorkspaceConnectionAccess::Local;
    profile.credential_mode = WorkspaceCredentialMode::Local;

    let workspace_id = uuid::Uuid::parse_str("11111111-1111-4111-8111-111111111111")
        .expect("workspace fixture UUID");
    let first_connection = uuid::Uuid::parse_str("22222222-2222-4222-8222-222222222222")
        .expect("connection fixture UUID");
    let second_connection = uuid::Uuid::parse_str("33333333-3333-4333-8333-333333333333")
        .expect("connection fixture UUID");
    let member_scope = crate::kernel::access::ActiveResourceScope {
        workspace_id,
        workspace_kind: crate::kernel::access::WorkspaceKind::Team,
        selected_account_id: Some("member-alpha".into()),
        account_scope: crate::kernel::access::AccountScope::WorkspaceUser("member-alpha".into()),
        generation: 7,
    };
    let first_auth_scope = BigQueryAuthScope::from_active_scope(&member_scope, first_connection);
    let second_auth_scope = BigQueryAuthScope::from_active_scope(&member_scope, second_connection);
    let other_member_auth_scope = BigQueryAuthScope::from_active_scope(
        &crate::kernel::access::ActiveResourceScope {
            selected_account_id: Some("member-beta".into()),
            account_scope: crate::kernel::access::AccountScope::WorkspaceUser("member-beta".into()),
            ..member_scope.clone()
        },
        first_connection,
    );
    let other_workspace_auth_scope = BigQueryAuthScope::from_active_scope(
        &crate::kernel::access::ActiveResourceScope {
            workspace_id: uuid::Uuid::parse_str("44444444-4444-4444-8444-444444444444")
                .expect("workspace fixture UUID"),
            ..member_scope.clone()
        },
        first_connection,
    );
    assert_eq!(
        google_account_config(&first_auth_scope).unwrap(),
        google_account_config(&second_auth_scope).unwrap(),
        "Google authentication is reused only by the same Workspace member",
    );
    assert_ne!(
        service_account_config(&first_auth_scope).unwrap(),
        service_account_config(&second_auth_scope).unwrap(),
        "service-account authentication is isolated per connection binding",
    );
    assert_ne!(
        google_account_config(&first_auth_scope).unwrap(),
        google_account_config(&other_member_auth_scope).unwrap(),
    );
    assert_ne!(
        google_account_config(&first_auth_scope).unwrap(),
        google_account_config(&other_workspace_auth_scope).unwrap(),
    );
    for key in [
        first_auth_scope.workspace_member_key(),
        first_auth_scope.connection_binding_key(),
    ] {
        assert_eq!(key.len(), 64);
        assert!(key.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert!(!key.contains("member-alpha"));
    }

    let auth = parse_auth_state(
        BigQueryAuthMode::GoogleAccount,
        &serde_json::json!([{"status":"ACTIVE"}]),
    )
    .unwrap();
    assert!(auth.authenticated);
    assert_eq!(
        serde_json::to_value(&auth).expect("BigQuery auth-state contract"),
        serde_json::json!({
            "mode": "googleAccount",
            "authenticated": true,
        }),
        "the Desktop auth-state response must not contain an external identity",
    );
    assert_eq!(
        parse_projects(&serde_json::json!([
            {"projectId":"sample-analytics-2026","name":"Sample analytics","lifecycleState":"ACTIVE"}
        ]))
        .unwrap()[0]
            .id,
        "sample-analytics-2026"
    );
    assert_eq!(
        parse_datasets(
            &serde_json::json!([
                {"datasetReference":{"projectId":"sample-analytics-2026","datasetId":"analytics_2026"}}
            ]),
            "sample-analytics-2026",
        )
        .unwrap()[0]
            .id,
        "analytics_2026"
    );
}
