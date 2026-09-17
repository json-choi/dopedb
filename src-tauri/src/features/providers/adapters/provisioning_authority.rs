//! Authenticated, secret-free target authority for Managed Access planning.

use std::future::Future;
use std::pin::Pin;

use chrono::{DateTime, Utc};
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::connection::keychain::{delete_workspace_session, fetch_workspace_session};
use crate::error::{AppError, AppResult};
use crate::hosted_control_plane;
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::ProviderIntegrationId;
use crate::model::{Engine, Provider, WorkspaceCredentialMode};

use super::super::domain::LocalProvider;
use super::super::provisioning::ProvisioningTarget;

const MAX_TARGET_BODY_BYTES: usize = 64 * 1024;
const MIN_AUTHORITY_SECONDS: i64 = 30;
const MAX_AUTHORITY_SECONDS: i64 = 5 * 60 + 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AuthorizedProvisioningResource {
    Neon {
        project: String,
        branch: String,
        database_id: String,
        database: String,
        schemas: Vec<String>,
    },
    GcpCloudSql {
        project: String,
        instance: String,
        database: String,
        engine: Engine,
        network_mode: String,
    },
    PlanetScale {
        organization: String,
        database: String,
        branch: String,
        engine: Engine,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AuthorizedProvisioningTarget {
    pub(crate) connection_id: Uuid,
    pub(crate) connection_revision: i64,
    pub(crate) integration_id: ProviderIntegrationId,
    pub(crate) integration_generation: i64,
    pub(crate) provider: LocalProvider,
    pub(crate) account_fingerprint: String,
    pub(crate) resource_fingerprint: String,
    pub(crate) display_name: String,
    pub(crate) resource: AuthorizedProvisioningResource,
    pub(crate) write_available: bool,
    pub(crate) production: bool,
    pub(crate) safe_migrations: Option<bool>,
    pub(crate) provider_audit_id: String,
    pub(crate) expires_at: DateTime<Utc>,
}

#[derive(Clone)]
pub(crate) struct HostedProvisioningTargetAuthority;

pub(crate) trait ProvisioningTargetAuthorityPort: Send + Sync + 'static {
    fn target<'a>(
        &'a self,
        connection: &'a PinnedConnection,
    ) -> Pin<Box<dyn Future<Output = AppResult<AuthorizedProvisioningTarget>> + Send + 'a>>;

    fn destroy<'a>(
        &'a self,
        connection: &'a PinnedConnection,
        target: &'a ProvisioningTarget,
        ownership_marker: &'a str,
    ) -> Pin<Box<dyn Future<Output = AppResult<String>> + Send + 'a>>;
}

impl HostedProvisioningTargetAuthority {
    pub(crate) fn new() -> Self {
        Self
    }

    async fn fetch_target(
        &self,
        connection: &PinnedConnection,
    ) -> AppResult<AuthorizedProvisioningTarget> {
        if connection.profile.credential_mode != WorkspaceCredentialMode::Managed {
            return Err(blocked("Managed Access requires a managed connection"));
        }
        let account_id = connection
            .scope
            .selected_account_id
            .as_deref()
            .ok_or_else(|| blocked("Managed Access requires an active workspace account"))?;
        let token = fetch_workspace_session(account_id)
            .await?
            .map(Zeroizing::new)
            .ok_or_else(|| blocked("Managed Access requires an authenticated session"))?;
        let origin = Url::parse(&hosted_control_plane::origin()?)
            .map_err(|_| AppError::Config("workspace control-plane origin is invalid".into()))?;
        let url = origin
            .join(&format!(
                "api/v1/workspaces/{}/connections/{}/managed-access-target",
                connection.scope.workspace_id, connection.connection_id
            ))
            .map_err(|_| AppError::Config("Managed Access target URL is invalid".into()))?;
        let response = hosted_control_plane::client()?
            .post(url)
            .bearer_auth(token.as_str())
            .header("x-dopedb-managed-provisioning-contract", "lifecycle-v1")
            .json(&serde_json::json!({"action": "prepare"}))
            .send()
            .await
            .map_err(|_| AppError::Network("Managed Access target is unavailable".into()))?;
        if response.status() == StatusCode::UNAUTHORIZED {
            delete_workspace_session(account_id).await?;
        }
        if !response.status().is_success() {
            return Err(blocked("Managed Access target is unavailable"));
        }
        let response = hosted_control_plane::bounded_json_response::<TargetResponse>(
            response,
            "Managed Access target",
            MAX_TARGET_BODY_BYTES,
        )
        .await
        .map_err(|_| invalid_response())?;
        parse_target_response_value(response, connection)
    }

    async fn destroy_target(
        &self,
        connection: &PinnedConnection,
        target: &ProvisioningTarget,
        ownership_marker: &str,
    ) -> AppResult<String> {
        if connection.profile.credential_mode != WorkspaceCredentialMode::Managed
            || !matches!(
                target.provider(),
                LocalProvider::PlanetScale | LocalProvider::Neon | LocalProvider::GcpCloudSql
            )
            || target.connection_id()
                != crate::kernel::identity::ConnectionId::from(connection.connection_id)
            || target.connection_revision() > connection.connection_revision
            || ownership_marker
                != format!(
                    "dopedb:{}:{}",
                    target.provider().storage_key(),
                    connection.connection_id
                )
        {
            return Err(blocked("Managed Access destroy target changed"));
        }
        let account_id = connection
            .scope
            .selected_account_id
            .as_deref()
            .ok_or_else(|| blocked("Managed Access requires an active workspace account"))?;
        let token = fetch_workspace_session(account_id)
            .await?
            .map(Zeroizing::new)
            .ok_or_else(|| blocked("Managed Access requires an authenticated session"))?;
        let origin = Url::parse(&hosted_control_plane::origin()?)
            .map_err(|_| AppError::Config("workspace control-plane origin is invalid".into()))?;
        let url = origin
            .join(&format!(
                "api/v1/workspaces/{}/connections/{}/managed-access-target",
                connection.scope.workspace_id, connection.connection_id
            ))
            .map_err(|_| AppError::Config("Managed Access target URL is invalid".into()))?;
        let response = hosted_control_plane::client()?
            .delete(url)
            .bearer_auth(token.as_str())
            .header("x-dopedb-managed-provisioning-contract", "lifecycle-v1")
            .json(&serde_json::json!({
                "action": "destroy",
                "connectionRevision": target.connection_revision().to_string(),
                "integrationId": Uuid::from(target.integration_id()),
                "integrationGeneration": target.integration_generation().to_string(),
                "resourceFingerprint": target.resource_fingerprint(),
                "providerAuditId": target.provider_audit_id(),
                "ownershipMarker": ownership_marker,
            }))
            .send()
            .await
            .map_err(|_| AppError::Network("Managed Access destroy is unavailable".into()))?;
        if response.status() == StatusCode::UNAUTHORIZED {
            delete_workspace_session(account_id).await?;
        }
        if !response.status().is_success() {
            return Err(blocked("Managed Access destroy is unavailable"));
        }
        let response = hosted_control_plane::bounded_json_response::<DestroyResponse>(
            response,
            "Managed Access destroy",
            MAX_TARGET_BODY_BYTES,
        )
        .await
        .map_err(|_| invalid_response())?;
        if !response.destroyed
            || response.revoked > 10_000
            || response.provider_audit_id != target.provider_audit_id()
        {
            return Err(invalid_response());
        }
        Ok(response.provider_audit_id)
    }
}

impl ProvisioningTargetAuthorityPort for HostedProvisioningTargetAuthority {
    fn target<'a>(
        &'a self,
        connection: &'a PinnedConnection,
    ) -> Pin<Box<dyn Future<Output = AppResult<AuthorizedProvisioningTarget>> + Send + 'a>> {
        Box::pin(async move { self.fetch_target(connection).await })
    }

    fn destroy<'a>(
        &'a self,
        connection: &'a PinnedConnection,
        target: &'a ProvisioningTarget,
        ownership_marker: &'a str,
    ) -> Pin<Box<dyn Future<Output = AppResult<String>> + Send + 'a>> {
        Box::pin(async move {
            self.destroy_target(connection, target, ownership_marker)
                .await
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TargetResponse {
    target: RemoteTarget,
    verification: RemoteVerification,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoteVerification {
    provider_audit_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DestroyResponse {
    destroyed: bool,
    revoked: u32,
    provider_audit_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoteTarget {
    connection_id: String,
    connection_revision: String,
    integration_id: String,
    integration_generation: String,
    provider: String,
    account_fingerprint: String,
    resource_fingerprint: String,
    display_name: String,
    resource: serde_json::Value,
    capability_manifest: RemoteCapabilityManifest,
    production: bool,
    safe_migrations: Option<bool>,
    authority_expires_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoteCapabilityManifest {
    discover: bool,
    import_read_only: bool,
    managed_lease: bool,
    write: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NeonResource {
    project: String,
    branch: String,
    #[serde(rename = "databaseId")]
    database_id: String,
    database: String,
    engine: String,
    schemas: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GcpResource {
    project: String,
    instance: String,
    database: String,
    engine: String,
    network_mode: String,
    production: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlanetScaleResource {
    organization: String,
    database: String,
    branch: String,
    engine: String,
}

#[cfg(test)]
fn parse_target_response(
    body: &[u8],
    connection: &PinnedConnection,
) -> AppResult<AuthorizedProvisioningTarget> {
    if body.len() > MAX_TARGET_BODY_BYTES || body.contains(&0) {
        return Err(invalid_response());
    }
    let response: TargetResponse = serde_json::from_slice(body).map_err(|_| invalid_response())?;
    parse_target_response_value(response, connection)
}

fn parse_target_response_value(
    response: TargetResponse,
    connection: &PinnedConnection,
) -> AppResult<AuthorizedProvisioningTarget> {
    parse_target(
        response.target,
        response.verification.provider_audit_id,
        connection,
    )
}

fn parse_target(
    target: RemoteTarget,
    provider_audit_id: String,
    connection: &PinnedConnection,
) -> AppResult<AuthorizedProvisioningTarget> {
    let connection_id = Uuid::parse_str(&target.connection_id).map_err(|_| invalid_response())?;
    let integration_id = Uuid::parse_str(&target.integration_id)
        .map(ProviderIntegrationId::from)
        .map_err(|_| invalid_response())?;
    let connection_revision = safe_revision(&target.connection_revision)?;
    let integration_generation = safe_revision(&target.integration_generation)?;
    let provider = LocalProvider::parse(&target.provider).ok_or_else(invalid_response)?;
    let expires_at = DateTime::parse_from_rfc3339(&target.authority_expires_at)
        .map_err(|_| invalid_response())?
        .with_timezone(&Utc);
    let valid_seconds = expires_at.signed_duration_since(Utc::now()).num_seconds();
    if connection_id.is_nil()
        || Uuid::from(integration_id).is_nil()
        || connection_id != connection.connection_id
        || connection_revision != connection.connection_revision
        || integration_generation < 1
        || !hash(&target.account_fingerprint)
        || !hash(&target.resource_fingerprint)
        || target.display_name != connection.profile.name
        || !safe_text(&target.display_name, 120)
        || !safe_text(&provider_audit_id, 512)
        || !target.capability_manifest.discover
        || !target.capability_manifest.import_read_only
        || !target.capability_manifest.managed_lease
        || !(MIN_AUTHORITY_SECONDS..=MAX_AUTHORITY_SECONDS).contains(&valid_seconds)
    {
        return Err(invalid_response());
    }
    let resource = parse_resource(provider, target.resource, target.production)?;
    let safe_migrations = match (&resource, target.safe_migrations) {
        (
            AuthorizedProvisioningResource::PlanetScale {
                engine: Engine::Mysql,
                ..
            },
            Some(value),
        ) => Some(value),
        (
            AuthorizedProvisioningResource::PlanetScale {
                engine: Engine::Postgres,
                ..
            },
            None,
        )
        | (AuthorizedProvisioningResource::Neon { .. }, None)
        | (AuthorizedProvisioningResource::GcpCloudSql { .. }, None) => None,
        _ => return Err(invalid_response()),
    };
    if target.production
        && matches!(
            &resource,
            AuthorizedProvisioningResource::PlanetScale {
                engine: Engine::Mysql,
                ..
            }
        )
        && safe_migrations != Some(true)
    {
        return Err(invalid_response());
    }
    if !resource_matches_profile(provider, &resource, connection) {
        return Err(invalid_response());
    }
    Ok(AuthorizedProvisioningTarget {
        connection_id,
        connection_revision,
        integration_id,
        integration_generation,
        provider,
        account_fingerprint: target.account_fingerprint,
        resource_fingerprint: target.resource_fingerprint,
        display_name: target.display_name,
        resource,
        write_available: target.capability_manifest.write,
        production: target.production,
        safe_migrations,
        provider_audit_id,
        expires_at,
    })
}

fn parse_resource(
    provider: LocalProvider,
    value: serde_json::Value,
    production: bool,
) -> AppResult<AuthorizedProvisioningResource> {
    match provider {
        LocalProvider::Neon => {
            let value: NeonResource =
                serde_json::from_value(value).map_err(|_| invalid_response())?;
            if value.engine != "postgres"
                || !segment(&value.project, 128)
                || !segment(&value.branch, 128)
                || !database(&value.database_id)
                || !database(&value.database)
                || value.schemas.len() > 128
                || value.schemas.iter().any(|schema| !database(schema))
            {
                return Err(invalid_response());
            }
            Ok(AuthorizedProvisioningResource::Neon {
                project: value.project,
                branch: value.branch,
                database_id: value.database_id,
                database: value.database,
                schemas: value.schemas,
            })
        }
        LocalProvider::GcpCloudSql => {
            let value: GcpResource =
                serde_json::from_value(value).map_err(|_| invalid_response())?;
            let engine = engine(&value.engine)?;
            if !project(&value.project)
                || !segment(&value.instance, 99)
                || !database(&value.database)
                || !matches!(
                    value.network_mode.as_str(),
                    "PUBLIC" | "PRIVATE_SERVICES_ACCESS" | "PRIVATE_SERVICE_CONNECT"
                )
                || value.production != production
            {
                return Err(invalid_response());
            }
            Ok(AuthorizedProvisioningResource::GcpCloudSql {
                project: value.project,
                instance: value.instance,
                database: value.database,
                engine,
                network_mode: value.network_mode,
            })
        }
        LocalProvider::PlanetScale => {
            let value: PlanetScaleResource =
                serde_json::from_value(value).map_err(|_| invalid_response())?;
            let engine = engine(&value.engine)?;
            if !segment(&value.organization, 128)
                || !segment(&value.database, 128)
                || !segment(&value.branch, 128)
            {
                return Err(invalid_response());
            }
            Ok(AuthorizedProvisioningResource::PlanetScale {
                organization: value.organization,
                database: value.database,
                branch: value.branch,
                engine,
            })
        }
    }
}

fn resource_matches_profile(
    provider: LocalProvider,
    resource: &AuthorizedProvisioningResource,
    connection: &PinnedConnection,
) -> bool {
    let expected_provider = match connection.profile.provider {
        Provider::Neon => Some(LocalProvider::Neon),
        Provider::GcpCloudSql => Some(LocalProvider::GcpCloudSql),
        Provider::PlanetScale => Some(LocalProvider::PlanetScale),
        Provider::Auto | Provider::Generic | Provider::CloudflareD1 => None,
    };
    let (engine, database) = match resource {
        AuthorizedProvisioningResource::Neon { database, .. } => {
            (Engine::Postgres, database.as_str())
        }
        AuthorizedProvisioningResource::GcpCloudSql {
            database, engine, ..
        }
        | AuthorizedProvisioningResource::PlanetScale {
            database, engine, ..
        } => (*engine, database.as_str()),
    };
    expected_provider == Some(provider)
        && connection.profile.engine == engine
        && connection.profile.database == database
}

fn safe_revision(value: &str) -> AppResult<i64> {
    if value.is_empty()
        || value.starts_with('0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(invalid_response());
    }
    value
        .parse::<i64>()
        .ok()
        .filter(|value| (1..=9_007_199_254_740_991).contains(value))
        .ok_or_else(invalid_response)
}

fn engine(value: &str) -> AppResult<Engine> {
    match value {
        "postgres" => Ok(Engine::Postgres),
        "mysql" => Ok(Engine::Mysql),
        _ => Err(invalid_response()),
    }
}

fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn safe_text(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.len() <= maximum && !value.chars().any(char::is_control)
}

fn segment(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'$'))
}

fn project(value: &str) -> bool {
    (6..=30).contains(&value.len())
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .as_bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn database(value: &str) -> bool {
    segment(value, 128)
}

fn invalid_response() -> AppError {
    AppError::Network("Managed Access target returned invalid metadata".into())
}

fn blocked(reason: &'static str) -> AppError {
    AppError::Blocked {
        reason: reason.into(),
    }
}

#[cfg(test)]
pub(crate) fn assert_target_projection_contract() {
    let connection = PinnedConnection {
        scope: crate::kernel::access::ActiveResourceScope {
            workspace_id: Uuid::from_u128(90),
            workspace_kind: crate::kernel::access::WorkspaceKind::Team,
            selected_account_id: Some("member-1".into()),
            account_scope: crate::kernel::access::AccountScope::WorkspaceUser("member-1".into()),
            generation: 1,
        },
        connection_id: Uuid::from_u128(92),
        connection_revision: 3,
        binding_revision: 0,
        binding_updated_at: "2026-08-05T00:00:00Z".into(),
        profile: crate::model::ConnectionProfile {
            id: Uuid::from_u128(92),
            name: "Neon app".into(),
            engine: Engine::Postgres,
            provider: Provider::Neon,
            driver_id: None,
            host: "neon.managed.invalid".into(),
            port: 5432,
            database: "app".into(),
            username: String::new(),
            sslmode: "verify-full".into(),
            extra_params: std::collections::HashMap::new(),
            readonly_default: true,
            allow_writes: false,
            secret_ref: None,
            env: Some("dev".into()),
            schema_group: None,
            workspace_access: crate::model::WorkspaceConnectionAccess::Manage,
            credential_mode: WorkspaceCredentialMode::Managed,
            provider_target: None,
        },
        requires_remote_rbac: true,
        catalog_cache_policy: crate::kernel::access::CatalogCachePolicy::EphemeralOnly,
    };
    let expires = (Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
    let body = serde_json::json!({
        "target": {
            "connectionId": connection.connection_id,
            "connectionRevision": connection.connection_revision.to_string(),
            "integrationId": Uuid::from_u128(91),
            "integrationGeneration": "4",
            "provider": "neon",
            "accountFingerprint": "ab".repeat(32),
            "resourceFingerprint": "cd".repeat(32),
            "displayName": connection.profile.name,
            "resource": {
                "project": "quiet-sun-12345678",
                "branch": "br-main-12345678",
                "databaseId": "834686",
                "database": connection.profile.database,
                "engine": "postgres",
                "schemas": ["public"]
            },
            "capabilityManifest": {
                "discover": true,
                "importReadOnly": true,
                "managedLease": true,
                "write": false
            },
            "production": false,
            "safeMigrations": null,
            "authorityExpiresAt": expires
        },
        "verification": {"providerAuditId": "br-main-12345678:834686"}
    });
    let parsed = parse_target_response(&serde_json::to_vec(&body).unwrap(), &connection).unwrap();
    assert_eq!(parsed.provider, LocalProvider::Neon);
    assert!(!parsed.write_available);

    let mut spoofed = body;
    spoofed["target"]["resource"]["apiKey"] = serde_json::json!("must-not-project");
    assert!(parse_target_response(&serde_json::to_vec(&spoofed).unwrap(), &connection).is_err());

    let mut planet_scale_connection = connection.clone();
    planet_scale_connection.profile.name = "PlanetScale app".into();
    planet_scale_connection.profile.engine = Engine::Mysql;
    planet_scale_connection.profile.provider = Provider::PlanetScale;
    planet_scale_connection.profile.database = "app".into();
    let mut production_mysql = serde_json::json!({
        "target": {
            "connectionId": planet_scale_connection.connection_id,
            "connectionRevision": planet_scale_connection.connection_revision.to_string(),
            "integrationId": Uuid::from_u128(93),
            "integrationGeneration": "5",
            "provider": "planetScale",
            "accountFingerprint": "ef".repeat(32),
            "resourceFingerprint": "01".repeat(32),
            "displayName": planet_scale_connection.profile.name,
            "resource": {
                "organization": "acme",
                "database": planet_scale_connection.profile.database,
                "branch": "production",
                "engine": "mysql"
            },
            "capabilityManifest": {
                "discover": true,
                "importReadOnly": true,
                "managedLease": true,
                "write": true
            },
            "production": true,
            "safeMigrations": true,
            "authorityExpiresAt": (Utc::now() + chrono::Duration::minutes(5)).to_rfc3339()
        },
        "verification": {"providerAuditId": "br-production-123"}
    });
    let parsed = parse_target_response(
        &serde_json::to_vec(&production_mysql).unwrap(),
        &planet_scale_connection,
    )
    .unwrap();
    assert_eq!(parsed.safe_migrations, Some(true));
    assert!(parsed.production);

    production_mysql["target"]["safeMigrations"] = serde_json::json!(false);
    assert!(parse_target_response(
        &serde_json::to_vec(&production_mysql).unwrap(),
        &planet_scale_connection,
    )
    .is_err());
}
