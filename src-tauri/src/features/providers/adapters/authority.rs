//! Hosted provider-integration authority adapter.
//!
//! The webview never supplies a provider family, generation, or bearer token:
//! both inventory and exact revalidation come from the authenticated control
//! plane immediately before a local credential can be staged or committed.

use reqwest::{StatusCode, Url};
use serde::Deserialize;
use uuid::Uuid;

use crate::connection::keychain::fetch_workspace_session;
use crate::error::{AppError, AppResult};
use crate::hosted_control_plane;
use crate::kernel::identity::ProviderIntegrationId;

use super::super::domain::{
    GcpCloudSqlVerificationTarget, LocalProvider, ProviderBindingScope, ProviderCredentialMethod,
    ProviderIntegrationState, ProviderIntegrationSummary, ProviderScope,
    ProviderVerificationTarget,
};
use super::super::ports::ProviderAuthorityPort;

const MAX_INVENTORY_BODY_BYTES: usize = 64 * 1024;
const MAX_PROVIDER_INTEGRATIONS: usize = 200;

#[derive(Clone)]
pub(crate) struct HostedProviderAuthority;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InventoryResponse {
    integrations: Vec<RemoteIntegration>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct RemoteIntegration {
    id: String,
    provider: String,
    display_name: String,
    status: String,
    generation: String,
    granted_scope: String,
    reconnect_required: bool,
    verification_target: Option<RemoteVerificationTarget>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind", deny_unknown_fields)]
enum RemoteVerificationTarget {
    #[serde(rename = "gcpCloudSql")]
    GcpCloudSql {
        project_id: String,
        instance_id: String,
    },
}

impl HostedProviderAuthority {
    pub(crate) fn new() -> Self {
        Self
    }

    async fn inventory(&self, scope: &ProviderScope) -> AppResult<Vec<ProviderIntegrationSummary>> {
        let token = fetch_workspace_session(scope.account_id.as_str())
            .await?
            .ok_or_else(|| AppError::Blocked {
                reason: "provider integrations require an active hosted session".into(),
            })?;
        let origin = Url::parse(&hosted_control_plane::origin()?)
            .map_err(|_| AppError::Config("workspace control-plane origin is invalid".into()))?;
        let path = format!(
            "api/v1/workspaces/{}/provider-integrations/local-authority",
            scope.workspace_id
        );
        let url = origin
            .join(&path)
            .map_err(|_| AppError::Config("provider authority URL is invalid".into()))?;
        let response = hosted_control_plane::client()?
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| AppError::Network("provider authority is unavailable".into()))?;
        if response.status() == StatusCode::UNAUTHORIZED
            || response.status() == StatusCode::FORBIDDEN
        {
            return Err(AppError::Blocked {
                reason: "provider integration authority is unavailable".into(),
            });
        }
        if !response.status().is_success() {
            return Err(AppError::Network(
                "provider authority request failed".into(),
            ));
        }
        let response = hosted_control_plane::bounded_json_response::<InventoryResponse>(
            response,
            "provider authority",
            MAX_INVENTORY_BODY_BYTES,
        )
        .await?;
        if response.integrations.len() > MAX_PROVIDER_INTEGRATIONS {
            return Err(AppError::Network(
                "provider authority returned too many integrations".into(),
            ));
        }
        response
            .integrations
            .into_iter()
            .map(parse_integration)
            .collect()
    }
}

#[cfg(test)]
fn parse_inventory_body(body: &[u8]) -> AppResult<InventoryResponse> {
    if body.len() > MAX_INVENTORY_BODY_BYTES || body.contains(&0) {
        return Err(invalid_inventory_response());
    }
    serde_json::from_slice(body).map_err(|_| invalid_inventory_response())
}

#[cfg(test)]
fn invalid_inventory_response() -> AppError {
    AppError::Network("provider authority response is invalid".into())
}

impl ProviderAuthorityPort for HostedProviderAuthority {
    async fn list_integrations(
        &self,
        scope: &ProviderScope,
    ) -> AppResult<Vec<ProviderIntegrationSummary>> {
        self.inventory(scope).await
    }

    async fn revalidate(
        &self,
        scope: &ProviderScope,
        integration_id: ProviderIntegrationId,
    ) -> AppResult<ProviderBindingScope> {
        let integration = self
            .inventory(scope)
            .await?
            .into_iter()
            .find(|candidate| candidate.id == integration_id)
            .ok_or_else(|| AppError::Blocked {
                reason: "provider integration is no longer active".into(),
            })?;
        if integration.state != ProviderIntegrationState::Active {
            return Err(AppError::Blocked {
                reason: "provider integration is not active".into(),
            });
        }
        if matches!(
            integration.credential_method,
            ProviderCredentialMethod::Unsupported
        ) {
            return Err(AppError::Blocked {
                reason: "provider integration requires managed OAuth".into(),
            });
        }
        Ok(ProviderBindingScope {
            scope: scope.clone(),
            provider: integration.provider,
            integration_id,
            integration_generation: integration.generation,
            granted_scope: integration.granted_scope,
            verification_target: integration.verification_target,
        })
    }
}

fn parse_integration(value: RemoteIntegration) -> AppResult<ProviderIntegrationSummary> {
    let id = Uuid::parse_str(&value.id)
        .map_err(|_| AppError::Network("provider authority response is invalid".into()))?;
    let provider = LocalProvider::parse(&value.provider)
        .ok_or_else(|| AppError::Network("provider authority response is invalid".into()))?;
    let verification_target = match (&provider, value.verification_target) {
        (
            LocalProvider::GcpCloudSql,
            Some(RemoteVerificationTarget::GcpCloudSql {
                project_id,
                instance_id,
            }),
        ) if valid_gcp_target(&project_id, &instance_id) => Some(
            ProviderVerificationTarget::GcpCloudSql(GcpCloudSqlVerificationTarget {
                project_id,
                instance_id,
            }),
        ),
        (LocalProvider::GcpCloudSql, _) => {
            return Err(AppError::Network(
                "provider authority response is invalid".into(),
            ));
        }
        (_, None) => None,
        _ => {
            return Err(AppError::Network(
                "provider authority response is invalid".into(),
            ));
        }
    };
    let credential_method = match provider {
        LocalProvider::Neon => ProviderCredentialMethod::Unsupported,
        LocalProvider::GcpCloudSql if value.granted_scope == "adcWif" => {
            ProviderCredentialMethod::GcpAdcWif
        }
        LocalProvider::PlanetScale => ProviderCredentialMethod::Unsupported,
        _ => {
            return Err(AppError::Network(
                "provider authority response is invalid".into(),
            ));
        }
    };
    if value.reconnect_required != (value.status == "reconnect_required")
        || value.display_name.is_empty()
        || value.display_name.len() > 256
        || !valid_generation(&value.generation)
        || !matches!(value.status.as_str(), "active" | "reconnect_required")
    {
        return Err(AppError::Network(
            "provider authority response is invalid".into(),
        ));
    }
    Ok(ProviderIntegrationSummary {
        id: ProviderIntegrationId::from(id),
        provider,
        display_name: value.display_name,
        generation: value.generation,
        credential_method,
        // The local-authority route currently permits only active and
        // reconnect-required rows, but retain the domain's complete mapping
        // here so a future explicitly admitted remote lifecycle state remains
        // fail-closed at the validation boundary rather than silently folded
        // into active access.
        state: if value.reconnect_required {
            ProviderIntegrationState::ReconnectRequired
        } else {
            match value.status.as_str() {
                "active" => ProviderIntegrationState::Active,
                "revoked" => ProviderIntegrationState::Revoked,
                _ => ProviderIntegrationState::Unsupported,
            }
        },
        granted_scope: value.granted_scope,
        verification_target,
    })
}

fn valid_gcp_target(project_id: &str, instance: &str) -> bool {
    let identifier = |value: &str, maximum: usize| {
        !value.is_empty()
            && value.len() <= maximum
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    };
    project_id.len() >= 6
        && project_id.len() <= 30
        && project_id.starts_with(|character: char| character.is_ascii_lowercase())
        && project_id.ends_with(|character: char| {
            character.is_ascii_lowercase() || character.is_ascii_digit()
        })
        && project_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && identifier(instance, 99)
}

fn valid_generation(value: &str) -> bool {
    !value.is_empty() && value.len() <= 39 && value.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
#[path = "authority_tests.rs"]
mod tests;
