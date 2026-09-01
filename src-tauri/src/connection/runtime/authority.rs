//! Provider-local and managed-pool authorization at the runtime boundary.
//!
//! Remote RBAC is checked before a provider target is fetched.  The local
//! provider binding is then pinned independently before every cache hand-off;
//! only a genuinely new pool may ask the provider feature to resolve a secret.

use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};
use crate::model::{ConnectionProfile, Engine, Provider, WorkspaceCredentialMode};

use super::{release_managed_bounded, CacheEntry, Live};
use super::{
    ConnectionAccess, ManagedLeaseHandle, ProviderLocalConnectionPort, ProviderLocalTarget,
    RemoteConnectionAuthorityPort,
};
use crate::connection::{
    cloud_sql_proxy::{self, CloudSqlProxy},
    ssh::{self, SshTunnel},
    ProviderLocalPinRequest, ProviderLocalResolveRequest, ProviderLocalResource,
    ProviderLocalSecret,
};

pub(super) struct ConnectionAuthorization {
    pub(super) user_id: Option<String>,
    pub(super) workspace_id: Option<uuid::Uuid>,
    pub(super) provider_local_target: Option<ProviderLocalTarget>,
    pub(super) provider_local_pin: Option<super::ProviderLocalBindingPin>,
}

pub(super) struct OpenedLive {
    pub(super) live: Live,
    pub(super) retire_at: Option<Instant>,
    pub(super) managed_lease: Option<ManagedLeaseHandle>,
    pub(super) ssh_tunnel: Option<SshTunnel>,
    pub(super) cloud_sql_proxy: Option<CloudSqlProxy>,
}

pub(super) async fn retire_opened(mut opened: OpenedLive) {
    if let Some(tunnel) = opened.ssh_tunnel.take() {
        tunnel.close().await;
    }
    opened.live.close().await;
    if let Some(proxy) = opened.cloud_sql_proxy.take() {
        proxy.close().await;
    }
    if let Some(managed_lease) = opened.managed_lease {
        release_managed_bounded(managed_lease).await;
    }
}

async fn open_live(
    pin: &PinnedConnection,
    alias_profile: &ConnectionProfile,
    target_profile: &ConnectionProfile,
    secret: &str,
    access: ConnectionAccess,
    cloud_sql_config: Option<cloud_sql_proxy::CloudSqlProxyConfig>,
) -> AppResult<(Live, Option<SshTunnel>, Option<CloudSqlProxy>)> {
    let bigquery_auth_scope = (alias_profile.engine == Engine::Bigquery).then(|| {
        crate::bigquery::BigQueryAuthScope::from_active_scope(&pin.scope, pin.connection_id)
    });
    if let Some(config) = cloud_sql_config {
        if alias_profile
            .extra_params
            .contains_key(ssh::SSH_ALIAS_PARAMETER)
        {
            return Err(AppError::Config(
                "Cloud SQL secure connections cannot also use an SSH tunnel".into(),
            ));
        }
        let opened = cloud_sql_proxy::open(target_profile, config).await?;
        return match crate::driver::connect(
            &opened.profile,
            secret,
            access,
            bigquery_auth_scope.as_ref(),
        )
        .await
        {
            Ok(live) => Ok((live, None, Some(opened.proxy))),
            Err(error) => {
                tokio::time::sleep(Duration::from_millis(50)).await;
                let detail = opened.proxy.failure_detail().await;
                opened.proxy.close().await;
                if detail.is_empty() {
                    Err(error)
                } else {
                    Err(AppError::Network(format!(
                        "Cloud SQL secure connector rejected the connection: {detail}"
                    )))
                }
            }
        };
    }
    let transport = ssh::open(alias_profile, target_profile).await?;
    match crate::driver::connect(
        &transport.profile,
        secret,
        access,
        bigquery_auth_scope.as_ref(),
    )
    .await
    {
        Ok(live) => Ok((live, transport.tunnel, None)),
        Err(error) => {
            if let Some(tunnel) = transport.tunnel {
                tunnel.close().await;
            }
            Err(error)
        }
    }
}

pub(super) fn scope_changed() -> AppError {
    AppError::Blocked {
        reason: "workspace or connection access changed; retry the operation".into(),
    }
}

pub(super) async fn authorize_pin(
    remote_authority: &dyn RemoteConnectionAuthorityPort,
    provider_local: &dyn ProviderLocalConnectionPort,
    pin: &PinnedConnection,
    access: ConnectionAccess,
) -> AppResult<ConnectionAuthorization> {
    let mutation = access.is_mutation();
    if pin.requires_remote_rbac
        && pin.profile.credential_mode == WorkspaceCredentialMode::MemberLocal
        && mutation
    {
        return Err(AppError::Blocked {
            reason: "shared member-local connections are read-only".into(),
        });
    }
    if !pin.profile.workspace_access.can_read()
        || (mutation && (!pin.profile.workspace_access.can_write() || !pin.profile.allow_writes))
        || (access.is_schema() && !pin.profile.workspace_access.can_manage())
    {
        return Err(AppError::Blocked {
            reason: if access.is_schema() {
                "your workspace role does not permit schema changes".into()
            } else {
                "your workspace role does not permit this database action".into()
            },
        });
    }
    if !pin.requires_remote_rbac {
        return Ok(ConnectionAuthorization {
            user_id: None,
            workspace_id: None,
            provider_local_target: None,
            provider_local_pin: None,
        });
    }
    let user_id = pin.scope.selected_account_id.clone().ok_or_else(|| {
        AppError::Config("shared connection access requires an active workspace account".into())
    })?;
    let account_id = AccountId::new(user_id.clone())
        .ok_or_else(|| AppError::Config("active workspace account id is invalid".into()))?;
    let authority = remote_authority
        .authorize(
            &account_id,
            pin.scope.workspace_id.into(),
            pin.connection_id.into(),
            access,
        )
        .await?;
    if authority.revision != pin.connection_revision {
        return Err(AppError::Blocked {
            reason: "the shared connection changed; refresh the workspace and retry".into(),
        });
    }
    let (provider_local_target, provider_local_pin) = if requires_provider_local_target(pin, access)
    {
        let target = remote_authority
            .provider_local_target(
                &account_id,
                pin.scope.workspace_id.into(),
                pin.connection_id.into(),
            )
            .await?;
        validate_provider_local_target(pin, &target)?;
        let workspace_id = WorkspaceId::from(pin.scope.workspace_id);
        let binding = provider_local
            .authorize_binding(ProviderLocalPinRequest {
                account_id: &account_id,
                workspace_id,
                profile: &pin.profile,
                authority: &target,
            })
            .await?;
        if !binding.matches_target(&account_id, workspace_id, &target) {
            return Err(AppError::Blocked {
                reason: "provider-local credential binding is no longer authorized".into(),
            });
        }
        (Some(target), Some(binding))
    } else {
        (None, None)
    };
    Ok(ConnectionAuthorization {
        user_id: Some(user_id),
        workspace_id: Some(pin.scope.workspace_id),
        provider_local_target,
        provider_local_pin,
    })
}

fn requires_provider_local_target(pin: &PinnedConnection, access: ConnectionAccess) -> bool {
    access == ConnectionAccess::Read
        && pin.requires_remote_rbac
        && pin.profile.credential_mode == WorkspaceCredentialMode::MemberLocal
        && matches!(pin.profile.provider, Provider::Neon | Provider::GcpCloudSql)
}

fn validate_provider_local_target(
    pin: &PinnedConnection,
    target: &ProviderLocalTarget,
) -> AppResult<()> {
    if target.connection_id != ConnectionId::from(pin.connection_id)
        || target.connection_revision != pin.connection_revision
        || target.integration_generation < 1
        || target.resource_fingerprint.len() != 64
        || !target
            .resource_fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || target.provider != pin.profile.provider
        || target.target_database() != pin.profile.database
        || !pin.profile.readonly_default
        || pin.profile.allow_writes
    {
        return Err(AppError::Network(
            "provider-local target authority returned invalid metadata".into(),
        ));
    }
    let _ = target.cache_retire_after()?;
    match (&target.resource, target.provider, pin.profile.engine) {
        (ProviderLocalResource::Neon { .. }, Provider::Neon, Engine::Postgres) => Ok(()),
        (
            ProviderLocalResource::GcpCloudSql { engine, .. },
            Provider::GcpCloudSql,
            profile_engine,
        ) if *engine == profile_engine => Ok(()),
        _ => Err(AppError::Network(
            "provider-local target authority returned an unsupported target".into(),
        )),
    }
}

pub(super) fn provider_target_expiry_shrank(
    entry: &CacheEntry,
    target: Option<&ProviderLocalTarget>,
) -> AppResult<bool> {
    let Some(target) = target else {
        return Ok(false);
    };
    let fresh_retire_at = Instant::now() + target.cache_retire_after()?;
    Ok(entry
        .retire_at
        .is_none_or(|retire_at| retire_at > fresh_retire_at))
}

pub(super) fn opened_provider_target_expiry_shrank(
    opened: &OpenedLive,
    target: Option<&ProviderLocalTarget>,
) -> AppResult<bool> {
    let Some(target) = target else {
        return Ok(false);
    };
    let fresh_retire_at = Instant::now() + target.cache_retire_after()?;
    Ok(opened
        .retire_at
        .is_none_or(|retire_at| retire_at > fresh_retire_at))
}

/// Open a pool using an OS-keyring reference or short-lived managed lease.
pub(super) async fn connect_authorized(
    remote_authority: Arc<dyn RemoteConnectionAuthorityPort>,
    provider_local: Arc<dyn ProviderLocalConnectionPort>,
    pin: &PinnedConnection,
    profile: &ConnectionProfile,
    authorization: &ConnectionAuthorization,
    access: ConnectionAccess,
) -> AppResult<OpenedLive> {
    if profile.credential_mode == WorkspaceCredentialMode::Managed {
        let user_id = authorization.user_id.as_deref().ok_or_else(|| {
            AppError::Config("managed database access requires a workspace account".into())
        })?;
        let workspace_id = authorization.workspace_id.ok_or_else(|| {
            AppError::Config("managed database access requires a team workspace".into())
        })?;
        let account_id = AccountId::new(user_id.to_owned())
            .ok_or_else(|| AppError::Config("active workspace account id is invalid".into()))?;
        let workspace_id = WorkspaceId::from(workspace_id);
        let lease = remote_authority
            .issue_managed_lease(&account_id, workspace_id, profile, access)
            .await?;
        let retire_at = Instant::now()
            + lease
                .valid_for
                .saturating_sub(Duration::from_secs(30))
                .max(Duration::from_secs(1));
        let managed_lease = ManagedLeaseHandle {
            authority: remote_authority,
            account_id,
            workspace_id,
            connection_id: profile.id.into(),
            lease_id: lease.lease_id,
        };
        let (live, ssh_tunnel, cloud_sql_proxy) = match open_live(
            pin,
            profile,
            &lease.profile,
            lease.secret.as_str(),
            access,
            lease.cloud_sql_proxy,
        )
        .await
        {
            Ok(opened) => opened,
            Err(error) => {
                release_managed_bounded(managed_lease).await;
                return Err(error);
            }
        };
        return Ok(OpenedLive {
            live,
            retire_at: Some(retire_at),
            managed_lease: Some(managed_lease),
            ssh_tunnel,
            cloud_sql_proxy,
        });
    }
    if let Some(target) = authorization.provider_local_target.as_ref() {
        let binding_pin =
            authorization
                .provider_local_pin
                .as_ref()
                .ok_or_else(|| AppError::Blocked {
                    reason: "provider-local credential binding is no longer authorized".into(),
                })?;
        let user_id = authorization.user_id.as_deref().ok_or_else(|| {
            AppError::Config("provider-local database access requires a workspace account".into())
        })?;
        let workspace_id = authorization.workspace_id.ok_or_else(|| {
            AppError::Config("provider-local database access requires a team workspace".into())
        })?;
        let account_id = AccountId::new(user_id.to_owned())
            .ok_or_else(|| AppError::Config("active workspace account id is invalid".into()))?;
        let resolved = provider_local
            .resolve(ProviderLocalResolveRequest {
                account_id: &account_id,
                workspace_id: workspace_id.into(),
                profile,
                authority: target,
                binding_pin,
            })
            .await?;
        validate_resolved_provider_local_profile(profile, target, &resolved.profile)?;
        let secret = match resolved.secret {
            ProviderLocalSecret::ProfileSecret => {
                Zeroizing::new(super::super::fetch_profile_secret(profile)?)
            }
        };
        if secret.is_empty() {
            return Err(AppError::Network(
                "provider-local credential resolution returned invalid material".into(),
            ));
        }
        let retire_at = Instant::now() + target.cache_retire_after()?;
        let (live, ssh_tunnel, cloud_sql_proxy) = open_live(
            pin,
            profile,
            &resolved.profile,
            secret.as_str(),
            access,
            resolved.cloud_sql_proxy,
        )
        .await?;
        return Ok(OpenedLive {
            live,
            retire_at: Some(retire_at),
            managed_lease: None,
            ssh_tunnel,
            cloud_sql_proxy,
        });
    }
    let secret = Zeroizing::new(super::super::fetch_profile_secret(profile)?);
    let (live, ssh_tunnel, cloud_sql_proxy) =
        open_live(pin, profile, profile, secret.as_str(), access, None).await?;
    Ok(OpenedLive {
        live,
        retire_at: None,
        managed_lease: None,
        ssh_tunnel,
        cloud_sql_proxy,
    })
}

pub(super) fn validate_resolved_provider_local_profile(
    original: &ConnectionProfile,
    target: &ProviderLocalTarget,
    resolved: &ConnectionProfile,
) -> AppResult<()> {
    let mut original_non_tls = original.extra_params.clone();
    let mut resolved_non_tls = resolved.extra_params.clone();
    original_non_tls.remove("sslrootcert_pem");
    resolved_non_tls.remove("sslrootcert_pem");
    let host_is_safe = !resolved.host.is_empty()
        && resolved.host.len() <= 512
        && !resolved.host.contains("://")
        && !resolved.host.chars().any(char::is_whitespace);
    let ca_is_safe = resolved
        .extra_params
        .get("sslrootcert_pem")
        .is_none_or(|pem| {
            pem.len() <= 64 * 1024
                && pem.starts_with("-----BEGIN CERTIFICATE-----")
                && pem.trim_end().ends_with("-----END CERTIFICATE-----")
                && !pem.contains('\0')
        });
    let neon_host_is_safe = original.provider != Provider::Neon
        || (resolved.host.ends_with(".neon.tech") && resolved.sslmode == "verify-full");
    let gcp_tls_is_safe = original.provider != Provider::GcpCloudSql
        || (matches!(resolved.sslmode.as_str(), "verify-ca" | "verify-full")
            && resolved.extra_params.contains_key("sslrootcert_pem")
            && ca_is_safe);
    let unchanged_identity = resolved.id == original.id
        && resolved.name == original.name
        && resolved.engine == original.engine
        && resolved.provider == original.provider
        && resolved.driver_id == original.driver_id
        && resolved.readonly_default == original.readonly_default
        && resolved.workspace_access == original.workspace_access
        && resolved.credential_mode == original.credential_mode
        && resolved.secret_ref == original.secret_ref
        && resolved.username == original.username
        && resolved.env == original.env
        && resolved.schema_group == original.schema_group
        && resolved.provider_target == original.provider_target;
    if !unchanged_identity
        || resolved.database != target.target_database()
        || resolved.database != original.database
        || resolved.port == 0
        || original_non_tls != resolved_non_tls
        || !host_is_safe
        || !neon_host_is_safe
        || !gcp_tls_is_safe
        || resolved.allow_writes
        || resolved.username.is_empty()
        || resolved.username.len() > 512
        || !matches!(resolved.sslmode.as_str(), "verify-ca" | "verify-full")
    {
        return Err(AppError::Network(
            "provider-local credential resolution returned invalid connection material".into(),
        ));
    }
    Ok(())
}
