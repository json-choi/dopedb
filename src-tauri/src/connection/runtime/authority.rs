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
    let cloudflare_auth_scope = (alias_profile.engine == Engine::Sqlite
        && alias_profile.provider == Provider::CloudflareD1)
        .then(|| {
            crate::cloudflare_d1::CloudflareD1AuthScope::from_active_scope(
                &pin.scope,
                pin.connection_id,
            )
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
            cloudflare_auth_scope.as_ref(),
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
                    // Connector stderr can name instances, accounts, or network
                    // paths; keep it in the local log and return a fixed reason.
                    tracing::warn!(%detail, "Cloud SQL secure connector rejected the connection");
                    Err(AppError::Network(
                        "Cloud SQL secure connector rejected the connection".into(),
                    ))
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
        cloudflare_auth_scope.as_ref(),
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
    // A provisioned connection opens only as the server-generated principal the
    // control plane reported ready; the name is empty in every other state.
    if pin.profile.credential_mode == WorkspaceCredentialMode::Provisioned
        && pin.profile.username.is_empty()
    {
        return Err(AppError::Blocked {
            reason: "your personal database account on this shared database is not ready".into(),
        });
    }
    // Data changes on a member-credential team connection follow the member's grant, role and
    // device Safety like any other credential method; the control plane re-checks the grant
    // below. Schema changes stay with managed credentials, whose owner lease they require.
    if pin.requires_remote_rbac
        && pin.profile.credential_mode == WorkspaceCredentialMode::MemberLocal
        && access.is_schema()
    {
        return Err(AppError::Blocked {
            reason: "schema changes on a team connection need managed credentials".into(),
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
        return Err(AppError::SharedConnectionChanged);
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
        && resolved.provider_target == original.provider_target
        && resolved.schema_access_available == original.schema_access_available;
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::Utc;
    use uuid::Uuid;

    use super::*;
    use crate::connection::provider_local::GcpCloudSqlNetworkMode;
    use crate::kernel::access::{
        AccountScope, ActiveResourceScope, CatalogCachePolicy, WorkspaceKind,
    };
    use crate::kernel::identity::ProviderIntegrationId;
    use crate::model::WorkspaceConnectionAccess;

    const CA: &str = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

    fn neon_pin() -> PinnedConnection {
        let connection_id = Uuid::new_v4();
        PinnedConnection {
            scope: ActiveResourceScope {
                workspace_id: Uuid::new_v4(),
                workspace_kind: WorkspaceKind::Team,
                selected_account_id: None,
                account_scope: AccountScope::Personal,
                generation: 7,
            },
            connection_id,
            connection_revision: 11,
            binding_revision: 3,
            binding_updated_at: Utc::now().to_rfc3339(),
            profile: ConnectionProfile {
                id: connection_id,
                name: "orders".into(),
                engine: Engine::Postgres,
                provider: Provider::Neon,
                driver_id: None,
                host: String::new(),
                port: 0,
                database: "app".into(),
                username: "dopedb_member".into(),
                sslmode: "verify-full".into(),
                extra_params: HashMap::new(),
                readonly_default: true,
                allow_writes: false,
                secret_ref: None,
                env: None,
                effective_env: None,
                schema_group: None,
                workspace_access: WorkspaceConnectionAccess::Read,
                credential_mode: WorkspaceCredentialMode::MemberLocal,
                provider_target: None,
                schema_access_available: false,
            },
            requires_remote_rbac: true,
            catalog_cache_policy: CatalogCachePolicy::Persistent,
        }
    }

    fn neon_target(pin: &PinnedConnection) -> ProviderLocalTarget {
        ProviderLocalTarget {
            connection_id: ConnectionId::from(pin.connection_id),
            connection_revision: pin.connection_revision,
            integration_id: ProviderIntegrationId::from(Uuid::new_v4()),
            integration_generation: 1,
            provider: Provider::Neon,
            resource_fingerprint: "ab".repeat(32),
            resource: ProviderLocalResource::Neon {
                project: "project".into(),
                branch: "main".into(),
                database_id: "db".into(),
                database: "app".into(),
                schemas: vec!["public".into()],
            },
            expires_at: Utc::now() + chrono::Duration::seconds(120),
        }
    }

    fn resolved_neon(pin: &PinnedConnection) -> ConnectionProfile {
        ConnectionProfile {
            host: "ep-quiet-1.us-east-2.aws.neon.tech".into(),
            port: 5432,
            ..pin.profile.clone()
        }
    }

    fn binding_pin(
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        target: &ProviderLocalTarget,
    ) -> crate::connection::provider_local::ProviderLocalBindingPin {
        crate::connection::provider_local::ProviderLocalBindingPin {
            binding_id: crate::kernel::identity::ProviderBindingId::from(Uuid::new_v4()),
            binding_revision: 1,
            account_id: account_id.clone(),
            workspace_id,
            integration_id: target.integration_id,
            integration_generation: target.integration_generation,
            provider: target.provider,
            resource_fingerprint: target.resource_fingerprint.clone(),
        }
    }

    #[tokio::test]
    async fn provider_target_metadata_must_match_the_exact_read_only_pin() {
        let pin = neon_pin();
        validate_provider_local_target(&pin, &neon_target(&pin)).unwrap();

        // Only a member-local Neon or Cloud SQL read on a remote-RBAC pin asks
        // for a provider-local target; every other access keeps its own path.
        assert!(requires_provider_local_target(&pin, ConnectionAccess::Read));
        type RequiresCase = (&'static str, fn(&mut PinnedConnection), ConnectionAccess);
        let requires_cases: [RequiresCase; 5] = [
            ("a write", |_| {}, ConnectionAccess::Write),
            ("a schema change", |_| {}, ConnectionAccess::Schema),
            (
                "a local pin",
                |p| p.requires_remote_rbac = false,
                ConnectionAccess::Read,
            ),
            (
                "managed credentials",
                |p| p.profile.credential_mode = WorkspaceCredentialMode::Managed,
                ConnectionAccess::Read,
            ),
            (
                "a generic provider",
                |p| p.profile.provider = Provider::Generic,
                ConnectionAccess::Read,
            ),
        ];
        for (label, mutate, access) in requires_cases {
            let mut other = neon_pin();
            mutate(&mut other);
            assert!(
                !requires_provider_local_target(&other, access),
                "{label} must not use a provider-local target"
            );
        }
        let mut cloud_sql = neon_pin();
        cloud_sql.profile.provider = Provider::GcpCloudSql;
        assert!(requires_provider_local_target(
            &cloud_sql,
            ConnectionAccess::Read
        ));
        assert!(matches!(
            scope_changed(),
            AppError::Blocked { reason } if reason.contains("access changed")
        ));

        // The authority expiry must sit inside a bounded window, and a pool is
        // retired fifteen seconds before the authority itself expires.
        for (seconds, accepted) in [(-5, false), (20, false), (300, true), (400, false)] {
            let mut target = neon_target(&pin);
            target.expires_at = Utc::now() + chrono::Duration::seconds(seconds);
            assert_eq!(
                target.cache_retire_after().is_ok(),
                accepted,
                "expiry {seconds}s"
            );
        }
        let retire_after = neon_target(&pin).cache_retire_after().unwrap();
        assert!(
            (Duration::from_secs(100)..=Duration::from_secs(105)).contains(&retire_after),
            "retire margin applied: {retire_after:?}"
        );

        // A cached pool is reused only while its deadline is not later than the
        // fresh authority; a pool without a deadline is never reused for one.
        let target = neon_target(&pin);
        let mut too_long = neon_target(&pin);
        too_long.expires_at = Utc::now() + chrono::Duration::minutes(10);
        let sqlite = ConnectionProfile {
            engine: Engine::Sqlite,
            provider: Provider::Auto,
            database: ":memory:".into(),
            sslmode: "disable".into(),
            ..neon_pin().profile
        };
        for (label, retire_at, shrank) in [
            ("no deadline", None, true),
            ("an earlier deadline", Some(Duration::from_secs(10)), false),
            ("a later deadline", Some(Duration::from_secs(3_600)), true),
        ] {
            let retire_at = retire_at.map(|after| Instant::now() + after);
            let profile = &sqlite;
            let live = || async move {
                crate::driver::connect(profile, "", ConnectionAccess::Read, None, None)
                    .await
                    .unwrap()
            };
            let entry = CacheEntry {
                live: live().await,
                generation: 1,
                retire_at,
                managed_lease: std::sync::Mutex::new(None),
                ssh_tunnel: std::sync::Mutex::new(None),
                cloud_sql_proxy: std::sync::Mutex::new(None),
                closed: std::sync::atomic::AtomicBool::new(false),
            };
            let opened = OpenedLive {
                live: live().await,
                retire_at,
                managed_lease: None,
                ssh_tunnel: None,
                cloud_sql_proxy: None,
            };
            assert_eq!(
                provider_target_expiry_shrank(&entry, Some(&target)).unwrap(),
                shrank,
                "cached pool with {label}"
            );
            assert_eq!(
                opened_provider_target_expiry_shrank(&opened, Some(&target)).unwrap(),
                shrank,
                "opened pool with {label}"
            );
            assert!(!provider_target_expiry_shrank(&entry, None).unwrap());
            assert!(!opened_provider_target_expiry_shrank(&opened, None).unwrap());
            assert!(provider_target_expiry_shrank(&entry, Some(&too_long)).is_err());
            assert!(opened_provider_target_expiry_shrank(&opened, Some(&too_long)).is_err());
            opened.live.close().await;
        }

        // A binding pin authorizes only the exact account, workspace, versioned
        // integration, provider, and fingerprint the target names.
        let account = AccountId::new("10000000-0000-0000-0000-000000000001").unwrap();
        let workspace = WorkspaceId::from(Uuid::new_v4());
        assert!(
            binding_pin(&account, workspace, &target).matches_target(&account, workspace, &target)
        );
        let other_account = AccountId::new("20000000-0000-0000-0000-000000000002").unwrap();
        assert!(!binding_pin(&account, workspace, &target).matches_target(
            &other_account,
            workspace,
            &target
        ));
        assert!(!binding_pin(&account, workspace, &target).matches_target(
            &account,
            WorkspaceId::from(Uuid::new_v4()),
            &target
        ));
        type BindingCase = (
            &'static str,
            fn(&mut crate::connection::provider_local::ProviderLocalBindingPin),
        );
        let binding_cases: [BindingCase; 5] = [
            ("an unrevisioned binding", |b| b.binding_revision = 0),
            ("another integration", |b| {
                b.integration_id = ProviderIntegrationId::from(Uuid::new_v4())
            }),
            ("another integration generation", |b| {
                b.integration_generation += 1
            }),
            ("another provider", |b| b.provider = Provider::GcpCloudSql),
            ("another fingerprint", |b| {
                b.resource_fingerprint = "cd".repeat(32)
            }),
        ];
        for (label, mutate) in binding_cases {
            let mut binding = binding_pin(&account, workspace, &target);
            mutate(&mut binding);
            assert!(
                !binding.matches_target(&account, workspace, &target),
                "{label} must not match"
            );
        }

        // The cache identity separates every canonical target field, including
        // boundaries that plain concatenation would merge.
        let neon = |project: &str, branch: &str, schemas: &[&str]| ProviderLocalResource::Neon {
            project: project.into(),
            branch: branch.into(),
            database_id: "db".into(),
            database: "app".into(),
            schemas: schemas.iter().map(|schema| (*schema).into()).collect(),
        };
        let gcp = |instance: &str, engine, network_mode| ProviderLocalResource::GcpCloudSql {
            project: "project".into(),
            instance: instance.into(),
            database: "app".into(),
            engine,
            network_mode,
        };
        let resources = [
            neon("ab", "c", &["public"]),
            neon("a", "bc", &["public"]),
            neon("ab", "c", &["public", "audit"]),
            neon("ab", "c", &["audit", "public"]),
            neon("ab", "c", &["publicaudit"]),
            gcp("primary", Engine::Postgres, GcpCloudSqlNetworkMode::Public),
            gcp("primary", Engine::Mysql, GcpCloudSqlNetworkMode::Public),
            gcp("primary", Engine::Sqlite, GcpCloudSqlNetworkMode::Public),
            gcp(
                "primary",
                Engine::Postgres,
                GcpCloudSqlNetworkMode::PrivateServicesAccess,
            ),
            gcp(
                "primary",
                Engine::Postgres,
                GcpCloudSqlNetworkMode::PrivateServiceConnect,
            ),
            gcp("replica", Engine::Postgres, GcpCloudSqlNetworkMode::Public),
        ];
        let identities = resources
            .iter()
            .map(|resource| {
                let mut target = neon_target(&pin);
                target.resource = resource.clone();
                target.cache_identity()
            })
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(identities.len(), resources.len());
        let mut same = neon_target(&pin);
        same.expires_at += chrono::Duration::seconds(5);
        assert_eq!(same.cache_identity(), neon_target(&pin).cache_identity());

        type TargetCase = (&'static str, fn(&mut ProviderLocalTarget));
        let target_cases: [TargetCase; 8] = [
            ("another connection", |t| {
                t.connection_id = ConnectionId::from(Uuid::new_v4())
            }),
            ("stale revision", |t| t.connection_revision -= 1),
            ("unversioned integration", |t| t.integration_generation = 0),
            ("non-hex fingerprint", |t| {
                t.resource_fingerprint = "AB".repeat(32)
            }),
            ("short fingerprint", |t| t.resource_fingerprint.truncate(63)),
            ("another provider", |t| t.provider = Provider::GcpCloudSql),
            ("expiry beyond the bounded window", |t| {
                t.expires_at = Utc::now() + chrono::Duration::minutes(10)
            }),
            ("another database", |t| {
                if let ProviderLocalResource::Neon { database, .. } = &mut t.resource {
                    *database = "other".into();
                }
            }),
        ];
        for (label, mutate) in target_cases {
            let mut target = neon_target(&pin);
            mutate(&mut target);
            assert!(
                validate_provider_local_target(&pin, &target).is_err(),
                "{label} must be refused"
            );
        }

        type PinCase = (&'static str, fn(&mut PinnedConnection));
        let pin_cases: [PinCase; 2] = [
            ("write-enabled profile", |p| p.profile.allow_writes = true),
            ("profile without read-only default", |p| {
                p.profile.readonly_default = false
            }),
        ];
        for (label, mutate) in pin_cases {
            let mut writable = neon_pin();
            mutate(&mut writable);
            let target = neon_target(&writable);
            assert!(
                validate_provider_local_target(&writable, &target).is_err(),
                "{label} must be refused"
            );
        }

        // A Cloud SQL resource is accepted only for the engine the profile pinned.
        let mut gcp = neon_pin();
        gcp.profile.provider = Provider::GcpCloudSql;
        let mut target = neon_target(&gcp);
        target.provider = Provider::GcpCloudSql;
        target.resource = ProviderLocalResource::GcpCloudSql {
            project: "project".into(),
            instance: "instance".into(),
            database: "app".into(),
            engine: Engine::Postgres,
            network_mode: GcpCloudSqlNetworkMode::Public,
        };
        validate_provider_local_target(&gcp, &target).unwrap();
        if let ProviderLocalResource::GcpCloudSql { engine, .. } = &mut target.resource {
            *engine = Engine::Mysql;
        }
        assert!(validate_provider_local_target(&gcp, &target).is_err());
    }

    #[test]
    fn resolved_credentials_cannot_change_identity_scope_or_transport_security() {
        let pin = neon_pin();
        let target = neon_target(&pin);
        validate_resolved_provider_local_profile(&pin.profile, &target, &resolved_neon(&pin))
            .unwrap();

        type ProfileCase = (&'static str, fn(&mut ConnectionProfile));
        let cases: [ProfileCase; 11] = [
            ("enabled writes", |p| p.allow_writes = true),
            ("another username", |p| p.username = "app_owner".into()),
            ("another secret reference", |p| {
                p.secret_ref = Some("other".into())
            }),
            ("another database", |p| p.database = "other".into()),
            ("another credential mode", |p| {
                p.credential_mode = WorkspaceCredentialMode::Local
            }),
            ("a non-Neon host", |p| p.host = "db.example.test".into()),
            ("a URL-shaped host", |p| {
                p.host = "postgres://ep.neon.tech".into()
            }),
            ("an unverified TLS mode", |p| p.sslmode = "require".into()),
            ("a zero port", |p| p.port = 0),
            ("an empty username", |p| p.username.clear()),
            ("an injected connection parameter", |p| {
                p.extra_params
                    .insert("options".into(), "-c role=app_owner".into());
            }),
        ];
        for (label, mutate) in cases {
            let mut resolved = resolved_neon(&pin);
            mutate(&mut resolved);
            assert!(
                validate_resolved_provider_local_profile(&pin.profile, &target, &resolved).is_err(),
                "{label} must be refused"
            );
        }

        // Cloud SQL must verify the server with the CA the authority returned.
        let mut original = pin.profile.clone();
        original.provider = Provider::GcpCloudSql;
        let mut resolved = ConnectionProfile {
            host: "10.0.0.5".into(),
            port: 5432,
            sslmode: "verify-ca".into(),
            ..original.clone()
        };
        assert!(
            validate_resolved_provider_local_profile(&original, &target, &resolved).is_err(),
            "Cloud SQL without a CA must be refused"
        );
        resolved
            .extra_params
            .insert("sslrootcert_pem".into(), "not a certificate".into());
        assert!(
            validate_resolved_provider_local_profile(&original, &target, &resolved).is_err(),
            "Cloud SQL with a malformed CA must be refused"
        );
        resolved
            .extra_params
            .insert("sslrootcert_pem".into(), CA.into());
        validate_resolved_provider_local_profile(&original, &target, &resolved).unwrap();
        resolved.sslmode = "require".into();
        assert!(
            validate_resolved_provider_local_profile(&original, &target, &resolved).is_err(),
            "Cloud SQL without server verification must be refused"
        );
    }
}
