//! Provider-local authority contract: targets must match the exact read-only pin,
//! resolved credentials cannot change identity or transport security, and
//! cached pools retire no later than the authority's expiry window.

use std::collections::HashMap;

use chrono::Utc;
use uuid::Uuid;

use super::*;
use crate::connection::provider_local::GcpCloudSqlNetworkMode;
use crate::kernel::access::{AccountScope, ActiveResourceScope, CatalogCachePolicy, WorkspaceKind};
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
    assert!(binding_pin(&account, workspace, &target).matches_target(&account, workspace, &target));
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
    validate_resolved_provider_local_profile(&pin.profile, &target, &resolved_neon(&pin)).unwrap();

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

/// Remote authority double: records every call and never reaches a network.
struct FakeAuthority {
    revision: i64,
    target: Option<ProviderLocalTarget>,
    lease_profile: Option<ConnectionProfile>,
    lease_proxy: bool,
    authorize_calls: std::sync::atomic::AtomicUsize,
    lease_calls: std::sync::atomic::AtomicUsize,
    release_calls: std::sync::atomic::AtomicUsize,
}

impl FakeAuthority {
    fn new(revision: i64) -> Self {
        Self {
            revision,
            target: None,
            lease_profile: None,
            lease_proxy: false,
            authorize_calls: Default::default(),
            lease_calls: Default::default(),
            release_calls: Default::default(),
        }
    }

    fn count(counter: &std::sync::atomic::AtomicUsize) -> usize {
        counter.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl RemoteConnectionAuthorityPort for FakeAuthority {
    fn authorize<'a>(
        &'a self,
        _account_id: &'a AccountId,
        _workspace_id: WorkspaceId,
        _connection_id: ConnectionId,
        _access: ConnectionAccess,
    ) -> crate::connection::RemoteAuthorityFuture<'a, crate::connection::RemoteConnectionAuthority>
    {
        self.authorize_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let revision = self.revision;
        Box::pin(async move { Ok(crate::connection::RemoteConnectionAuthority { revision }) })
    }

    fn issue_managed_lease<'a>(
        &'a self,
        _account_id: &'a AccountId,
        _workspace_id: WorkspaceId,
        _profile: &'a ConnectionProfile,
        _access: ConnectionAccess,
    ) -> crate::connection::RemoteAuthorityFuture<'a, crate::connection::ManagedConnectionLease>
    {
        self.lease_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let profile = self.lease_profile.clone();
        let proxy = self.lease_proxy;
        Box::pin(async move {
            Ok(crate::connection::ManagedConnectionLease {
                lease_id: Uuid::new_v4(),
                profile: profile.expect("lease profile"),
                secret: Zeroizing::new("lease-secret".into()),
                valid_for: Duration::from_secs(600),
                cloud_sql_proxy: proxy.then(|| cloud_sql_proxy::CloudSqlProxyConfig {
                    instance_connection_name: "project:region:instance".into(),
                    access_token: Zeroizing::new("token".into()),
                    network_mode: GcpCloudSqlNetworkMode::Public,
                }),
            })
        })
    }

    fn release_managed_lease<'a>(
        &'a self,
        _account_id: &'a AccountId,
        _workspace_id: WorkspaceId,
        _connection_id: ConnectionId,
        _lease_id: Uuid,
    ) -> crate::connection::RemoteAuthorityFuture<'a, ()> {
        self.release_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }

    fn provider_local_target<'a>(
        &'a self,
        _account_id: &'a AccountId,
        _workspace_id: WorkspaceId,
        _connection_id: ConnectionId,
    ) -> crate::connection::RemoteAuthorityFuture<'a, ProviderLocalTarget> {
        let target = self.target.clone();
        Box::pin(async move {
            target.ok_or_else(|| AppError::Network("no provider-local target".into()))
        })
    }
}

/// Provider-local double that returns a fixed binding and never resolves a secret.
struct FakeBinding(Option<crate::connection::provider_local::ProviderLocalBindingPin>);

impl ProviderLocalConnectionPort for FakeBinding {
    fn authorize_binding<'a>(
        &'a self,
        _request: ProviderLocalPinRequest<'a>,
    ) -> crate::connection::provider_local::ProviderLocalFuture<
        'a,
        crate::connection::provider_local::ProviderLocalBindingPin,
    > {
        let binding = self.0.clone();
        Box::pin(async move {
            binding.ok_or_else(|| AppError::Blocked {
                reason: "no binding".into(),
            })
        })
    }

    fn resolve<'a>(
        &'a self,
        _request: ProviderLocalResolveRequest<'a>,
    ) -> crate::connection::provider_local::ProviderLocalFuture<
        'a,
        crate::connection::provider_local::ResolvedProviderLocalConnection,
    > {
        Box::pin(async { Err(AppError::Network("resolution is outside this test".into())) })
    }
}

fn local_sqlite_pin() -> PinnedConnection {
    let mut pin = neon_pin();
    pin.profile.engine = Engine::Sqlite;
    pin.profile.provider = Provider::Auto;
    pin.profile.database = ":memory:".into();
    pin.profile.sslmode = "disable".into();
    pin.profile.workspace_access = WorkspaceConnectionAccess::Local;
    pin.profile.credential_mode = WorkspaceCredentialMode::Local;
    pin.requires_remote_rbac = false;
    pin
}

#[tokio::test]
async fn authorization_and_pool_opening_fail_closed_before_any_live_connection() {
    fn blocked(result: AppResult<ConnectionAuthorization>) -> String {
        match result {
            Err(AppError::Blocked { reason }) => reason,
            Err(other) => panic!("expected a blocked decision, got {other:?}"),
            Ok(_) => panic!("expected a blocked decision, got authorization"),
        }
    }
    let no_binding = FakeBinding(None);

    // Local checks refuse before the remote authority is ever asked.
    let authority = FakeAuthority::new(11);
    let mut provisioned = neon_pin();
    provisioned.profile.credential_mode = WorkspaceCredentialMode::Provisioned;
    provisioned.profile.username.clear();
    assert!(blocked(
        authorize_pin(
            &authority,
            &no_binding,
            &provisioned,
            ConnectionAccess::Read
        )
        .await
    )
    .contains("not ready"));
    let member = neon_pin();
    assert!(blocked(
        authorize_pin(&authority, &no_binding, &member, ConnectionAccess::Schema).await
    )
    .contains("managed credentials"));

    type RoleCase = (
        &'static str,
        WorkspaceConnectionAccess,
        bool,
        ConnectionAccess,
        bool,
    );
    let roles: [RoleCase; 7] = [
        (
            "view grant reads",
            WorkspaceConnectionAccess::View,
            true,
            ConnectionAccess::Read,
            false,
        ),
        (
            "read grant writes",
            WorkspaceConnectionAccess::Read,
            true,
            ConnectionAccess::Write,
            false,
        ),
        (
            "write grant with writes disabled",
            WorkspaceConnectionAccess::Write,
            false,
            ConnectionAccess::Write,
            false,
        ),
        (
            "write grant changes schema",
            WorkspaceConnectionAccess::Write,
            true,
            ConnectionAccess::Schema,
            false,
        ),
        (
            "read grant reads",
            WorkspaceConnectionAccess::Read,
            false,
            ConnectionAccess::Read,
            true,
        ),
        (
            "write grant writes",
            WorkspaceConnectionAccess::Write,
            true,
            ConnectionAccess::Write,
            true,
        ),
        (
            "manage grant changes schema",
            WorkspaceConnectionAccess::Manage,
            true,
            ConnectionAccess::Schema,
            true,
        ),
    ];
    for (label, grant, allow_writes, access, allowed) in roles {
        let mut pin = neon_pin();
        // Managed credentials keep the schema path open to the role gate itself.
        pin.profile.credential_mode = WorkspaceCredentialMode::Managed;
        pin.profile.workspace_access = grant;
        pin.profile.allow_writes = allow_writes;
        pin.requires_remote_rbac = false;
        let result = authorize_pin(&authority, &no_binding, &pin, access).await;
        assert_eq!(result.is_ok(), allowed, "{label}");
        if !allowed {
            assert!(blocked(result).contains("workspace role"), "{label}");
        }
    }
    assert_eq!(FakeAuthority::count(&authority.authorize_calls), 0);

    // A local connection is authorized without any remote identity.
    let local = authorize_pin(
        &authority,
        &no_binding,
        &local_sqlite_pin(),
        ConnectionAccess::Read,
    )
    .await
    .unwrap();
    assert!(local.user_id.is_none() && local.workspace_id.is_none());
    assert!(local.provider_local_target.is_none() && local.provider_local_pin.is_none());

    // Shared access needs an active account and the exact current revision.
    let mut writer = neon_pin();
    writer.profile.workspace_access = WorkspaceConnectionAccess::Write;
    writer.profile.allow_writes = true;
    assert!(matches!(
        authorize_pin(&authority, &no_binding, &writer, ConnectionAccess::Write).await,
        Err(AppError::Config(_))
    ));
    assert_eq!(FakeAuthority::count(&authority.authorize_calls), 0);
    writer.scope.selected_account_id = Some("member-account-1".into());
    let stale = FakeAuthority::new(writer.connection_revision + 1);
    assert!(matches!(
        authorize_pin(&stale, &no_binding, &writer, ConnectionAccess::Write).await,
        Err(AppError::SharedConnectionChanged)
    ));
    let granted = authorize_pin(&authority, &no_binding, &writer, ConnectionAccess::Write)
        .await
        .unwrap();
    assert_eq!(granted.user_id.as_deref(), Some("member-account-1"));
    assert_eq!(granted.workspace_id, Some(writer.scope.workspace_id));
    assert!(granted.provider_local_target.is_none());

    // A member-local provider read is pinned to a binding for this exact account.
    let mut reader = neon_pin();
    reader.scope.selected_account_id = Some("member-account-1".into());
    let account = AccountId::new("member-account-1").unwrap();
    let workspace = WorkspaceId::from(reader.scope.workspace_id);
    let mut provider = FakeAuthority::new(reader.connection_revision);
    provider.target = Some(neon_target(&reader));
    let target = provider.target.clone().unwrap();
    let exact = FakeBinding(Some(binding_pin(&account, workspace, &target)));
    let pinned = authorize_pin(&provider, &exact, &reader, ConnectionAccess::Read)
        .await
        .unwrap();
    assert_eq!(pinned.provider_local_target, Some(target.clone()));
    assert!(pinned.provider_local_pin.is_some());
    let other_account = AccountId::new("member-account-2").unwrap();
    let foreign = FakeBinding(Some(binding_pin(&other_account, workspace, &target)));
    assert!(
        blocked(authorize_pin(&provider, &foreign, &reader, ConnectionAccess::Read).await)
            .contains("no longer authorized")
    );
    let mut wrong_target = neon_target(&reader);
    wrong_target.connection_id = ConnectionId::from(Uuid::new_v4());
    provider.target = Some(wrong_target);
    assert!(
        authorize_pin(&provider, &exact, &reader, ConnectionAccess::Read)
            .await
            .is_err()
    );

    // A provider-local target without its binding pin never opens a pool.
    let local_pin = local_sqlite_pin();
    let unbound = ConnectionAuthorization {
        user_id: Some("member-account-1".into()),
        workspace_id: Some(local_pin.scope.workspace_id),
        provider_local_target: Some(target),
        provider_local_pin: None,
    };
    let authority = Arc::new(FakeAuthority::new(11));
    let resolver: Arc<dyn ProviderLocalConnectionPort> = Arc::new(FakeBinding(None));
    let opened = connect_authorized(
        authority.clone(),
        resolver.clone(),
        &local_pin,
        &local_pin.profile,
        &unbound,
        ConnectionAccess::Read,
    )
    .await;
    assert!(matches!(opened, Err(AppError::Blocked { .. })));

    // A local profile opens without a deadline, lease, tunnel, or connector.
    let opened = connect_authorized(
        authority.clone(),
        resolver.clone(),
        &local_pin,
        &local_pin.profile,
        &local,
        ConnectionAccess::Read,
    )
    .await
    .unwrap();
    assert!(opened.retire_at.is_none() && opened.managed_lease.is_none());
    assert!(opened.ssh_tunnel.is_none() && opened.cloud_sql_proxy.is_none());
    retire_opened(opened).await;

    // Managed access needs a workspace account before any lease is issued.
    let mut managed_profile = local_pin.profile.clone();
    managed_profile.credential_mode = WorkspaceCredentialMode::Managed;
    let mut lease_authority = FakeAuthority::new(11);
    lease_authority.lease_profile = Some(local_pin.profile.clone());
    let lease_authority = Arc::new(lease_authority);
    assert!(matches!(
        connect_authorized(
            lease_authority.clone(),
            resolver.clone(),
            &local_pin,
            &managed_profile,
            &local,
            ConnectionAccess::Read,
        )
        .await,
        Err(AppError::Config(_))
    ));
    assert_eq!(FakeAuthority::count(&lease_authority.lease_calls), 0);

    // A leased pool retires before the lease and returns the lease exactly once.
    let account_scope = ConnectionAuthorization {
        user_id: Some("member-account-1".into()),
        workspace_id: Some(local_pin.scope.workspace_id),
        provider_local_target: None,
        provider_local_pin: None,
    };
    let started = Instant::now();
    let opened = connect_authorized(
        lease_authority.clone(),
        resolver.clone(),
        &local_pin,
        &managed_profile,
        &account_scope,
        ConnectionAccess::Read,
    )
    .await
    .unwrap();
    let retire_at = opened.retire_at.expect("leased pool deadline");
    assert!(retire_at <= started + Duration::from_secs(600 - 30) + Duration::from_secs(1));
    assert!(opened.managed_lease.is_some());
    retire_opened(opened).await;
    assert_eq!(FakeAuthority::count(&lease_authority.release_calls), 1);

    // A lease that asks for a Cloud SQL connector over an SSH alias is refused
    // before any process starts, and the lease is still returned.
    let mut tunneled = local_pin.profile.clone();
    tunneled
        .extra_params
        .insert(ssh::SSH_ALIAS_PARAMETER.into(), "bastion".into());
    let mut managed_tunneled = tunneled.clone();
    managed_tunneled.credential_mode = WorkspaceCredentialMode::Managed;
    let mut proxied = FakeAuthority::new(11);
    proxied.lease_profile = Some(tunneled);
    proxied.lease_proxy = true;
    let proxied = Arc::new(proxied);
    match connect_authorized(
        proxied.clone(),
        resolver,
        &local_pin,
        &managed_tunneled,
        &account_scope,
        ConnectionAccess::Read,
    )
    .await
    {
        Err(AppError::Config(reason)) => assert!(reason.contains("cannot also use an SSH tunnel")),
        Err(other) => panic!("expected the SSH and connector conflict, got {other:?}"),
        Ok(_) => panic!("expected the SSH and connector conflict, got a pool"),
    }
    assert_eq!(FakeAuthority::count(&proxied.lease_calls), 1);
    assert_eq!(FakeAuthority::count(&proxied.release_calls), 1);
}
