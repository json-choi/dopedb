use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::providers::adapters::{
    AuthorizedProvisioningTarget, ProvisioningTargetAuthorityPort,
};
use crate::features::providers::ports::ProvisioningRuntimePort;
use crate::features::providers::LocalProvider;
use crate::features::workspaces::{WorkspaceAuthUser, WorkspaceRole};
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::{AccountId, WorkspaceId};
use crate::model::{
    ConnectionProfile, Engine, Provider, WorkspaceConnectionAccess, WorkspaceCredentialMode,
};
use crate::store::Store;

use super::application::{ProvisioningDriver, ProvisioningInspection};
use super::domain::{
    ProvisioningAccessMode, ProvisioningAction, ProvisioningReceipt, ProvisioningRepairReason,
    ProvisioningTarget,
};
use super::{ProvisioningExecutionPermit, ProvisioningReadAuthority};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TargetBehavior {
    Ready,
    Drift,
    Unavailable,
}

#[derive(Debug)]
struct AuthorityState {
    target_behavior: TargetBehavior,
    destroy_fails: bool,
    target_calls: usize,
    destroy_calls: usize,
}

pub(super) struct FixtureTargetAuthority {
    target: AuthorizedProvisioningTarget,
    state: Mutex<AuthorityState>,
}

impl FixtureTargetAuthority {
    pub(super) fn new(target: AuthorizedProvisioningTarget) -> Self {
        Self {
            target,
            state: Mutex::new(AuthorityState {
                target_behavior: TargetBehavior::Ready,
                destroy_fails: false,
                target_calls: 0,
                destroy_calls: 0,
            }),
        }
    }

    fn set_target_behavior(&self, behavior: TargetBehavior) {
        self.state
            .lock()
            .expect("lock fixture target authority")
            .target_behavior = behavior;
    }

    fn set_destroy_failure(&self, fails: bool) {
        self.state
            .lock()
            .expect("lock fixture target authority")
            .destroy_fails = fails;
    }

    fn target_calls(&self) -> usize {
        self.state
            .lock()
            .expect("lock fixture target authority")
            .target_calls
    }

    fn destroy_calls(&self) -> usize {
        self.state
            .lock()
            .expect("lock fixture target authority")
            .destroy_calls
    }
}

impl ProvisioningTargetAuthorityPort for FixtureTargetAuthority {
    fn target<'a>(
        &'a self,
        connection: &'a PinnedConnection,
    ) -> Pin<Box<dyn Future<Output = AppResult<AuthorizedProvisioningTarget>> + Send + 'a>> {
        Box::pin(async move {
            assert_eq!(connection.connection_id, self.target.connection_id);
            assert_eq!(
                connection.connection_revision,
                self.target.connection_revision
            );
            let behavior = {
                let mut state = self.state.lock().expect("lock fixture target authority");
                state.target_calls += 1;
                state.target_behavior
            };
            match behavior {
                TargetBehavior::Ready => Ok(self.target.clone()),
                TargetBehavior::Drift => {
                    let mut target = self.target.clone();
                    target.integration_generation += 1;
                    Ok(target)
                }
                TargetBehavior::Unavailable => Err(AppError::Network(
                    "fixture Provider authority is unavailable".into(),
                )),
            }
        })
    }

    fn destroy<'a>(
        &'a self,
        connection: &'a PinnedConnection,
        target: &'a ProvisioningTarget,
        ownership_marker: &'a str,
    ) -> Pin<Box<dyn Future<Output = AppResult<String>> + Send + 'a>> {
        Box::pin(async move {
            assert_eq!(connection.connection_id, self.target.connection_id);
            assert_eq!(
                Uuid::from(target.connection_id()),
                self.target.connection_id
            );
            assert_eq!(target.provider_audit_id(), self.target.provider_audit_id);
            assert_eq!(
                ownership_marker,
                format!(
                    "dopedb:{}:{}",
                    target.provider().storage_key(),
                    connection.connection_id
                )
            );
            let fails = {
                let mut state = self.state.lock().expect("lock fixture target authority");
                state.destroy_calls += 1;
                state.destroy_fails
            };
            if fails {
                return Err(AppError::Network(
                    "fixture Provider cleanup is unavailable".into(),
                ));
            }
            Ok(self.target.provider_audit_id.clone())
        })
    }
}

#[derive(Debug)]
struct RuntimeState {
    smoke_failure: Option<ProvisioningAccessMode>,
    fence_fails: bool,
    smoke_calls: Vec<ProvisioningAccessMode>,
    fence_calls: usize,
}

pub(super) struct FixtureProvisioningRuntime {
    connection_id: Uuid,
    connection_revision: i64,
    provider: LocalProvider,
    engine: Engine,
    state: Mutex<RuntimeState>,
}

impl FixtureProvisioningRuntime {
    pub(super) fn new(target: &ProvisioningTarget) -> Self {
        Self {
            connection_id: Uuid::from(target.connection_id()),
            connection_revision: target.connection_revision(),
            provider: target.provider(),
            engine: target.engine(),
            state: Mutex::new(RuntimeState {
                smoke_failure: None,
                fence_fails: false,
                smoke_calls: Vec::new(),
                fence_calls: 0,
            }),
        }
    }

    fn set_smoke_failure(&self, access: Option<ProvisioningAccessMode>) {
        self.state
            .lock()
            .expect("lock fixture provisioning runtime")
            .smoke_failure = access;
    }

    fn set_fence_failure(&self, fails: bool) {
        self.state
            .lock()
            .expect("lock fixture provisioning runtime")
            .fence_fails = fails;
    }

    fn fence_calls(&self) -> usize {
        self.state
            .lock()
            .expect("lock fixture provisioning runtime")
            .fence_calls
    }
}

impl ProvisioningRuntimePort for FixtureProvisioningRuntime {
    fn smoke<'a>(
        &'a self,
        connection_id: Uuid,
        connection_revision: i64,
        provider: LocalProvider,
        engine: Engine,
        access: ProvisioningAccessMode,
    ) -> Pin<Box<dyn Future<Output = AppResult<()>> + Send + 'a>> {
        Box::pin(async move {
            assert_eq!(connection_id, self.connection_id);
            assert_eq!(connection_revision, self.connection_revision);
            assert_eq!(provider, self.provider);
            assert_eq!(engine, self.engine);
            let fails = {
                let mut state = self
                    .state
                    .lock()
                    .expect("lock fixture provisioning runtime");
                state.smoke_calls.push(access);
                state.smoke_failure == Some(access)
            };
            if fails {
                return Err(AppError::Blocked {
                    reason: "fixture credential smoke failed".into(),
                });
            }
            Ok(())
        })
    }

    fn force_fence<'a>(
        &'a self,
        connection_id: Uuid,
    ) -> Pin<Box<dyn Future<Output = AppResult<()>> + Send + 'a>> {
        Box::pin(async move {
            assert_eq!(connection_id, self.connection_id);
            let fails = {
                let mut state = self
                    .state
                    .lock()
                    .expect("lock fixture provisioning runtime");
                state.fence_calls += 1;
                state.fence_fails
            };
            if fails {
                return Err(AppError::Blocked {
                    reason: "fixture connection fence failed".into(),
                });
            }
            Ok(())
        })
    }
}

pub(super) async fn fixture_connection(
    store: &Store,
    target: &ProvisioningTarget,
    provider: Provider,
) -> PinnedConnection {
    let workspace_id = Uuid::new_v4();
    let user = WorkspaceAuthUser {
        id: AccountId::new("provider-contract-member").expect("Provider fixture account id"),
        email: "provider-contract@example.com".into(),
        display_name: "Provider contract member".into(),
    };
    store
        .sync_account_workspaces(
            &user,
            &[(
                workspace_id,
                "Provider contract".into(),
                WorkspaceRole::Owner,
            )],
        )
        .await
        .expect("seed Provider fixture workspace");
    let profile = ConnectionProfile {
        id: Uuid::from(target.connection_id()),
        name: target.display_name().into(),
        engine: target.engine(),
        provider,
        driver_id: None,
        host: "provider-contract.invalid".into(),
        port: if target.engine() == Engine::Mysql {
            3306
        } else {
            5432
        },
        database: target
            .selector(super::domain::ProvisioningTargetSelector::Database)
            .expect("provider fixture database selector")
            .into(),
        username: String::new(),
        sslmode: "verify-full".into(),
        extra_params: HashMap::new(),
        readonly_default: false,
        allow_writes: true,
        secret_ref: None,
        env: Some(if target.production() { "prod" } else { "dev" }.into()),
        schema_group: None,
        workspace_access: WorkspaceConnectionAccess::Manage,
        credential_mode: WorkspaceCredentialMode::Managed,
        provider_target: None,
        schema_access_available: false,
    };
    store
        .sync_remote_connections(
            workspace_id,
            user.id.as_str(),
            &[(profile.clone(), target.connection_revision())],
        )
        .await
        .expect("seed managed Provider fixture connection");
    store
        .activate_workspace(workspace_id, Some(user.id.as_str()))
        .await
        .expect("activate Provider fixture workspace");
    store
        .pin_connection_for_view(profile.id)
        .await
        .expect("pin Provider fixture connection")
}

pub(super) async fn assert_driver_failure_contract(
    driver: &dyn ProvisioningDriver,
    target: &ProvisioningTarget,
    connection: &PinnedConnection,
    authority: Arc<FixtureTargetAuthority>,
    runtime: Arc<FixtureProvisioningRuntime>,
) {
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let authority_calls = authority.target_calls();
    let read_authority =
        ProvisioningReadAuthority::issue(driver.provider(), driver.manifest_sha256().to_owned());
    let detection_error = driver
        .detect(&read_authority, &cancelled)
        .await
        .expect_err("cancelled detection must fail before Provider CLI execution");
    assert!(blocked_reason(&detection_error).contains("cancelled"));
    let discovery_error = driver
        .discover(connection.connection_id, &read_authority, &cancelled)
        .await
        .expect_err("cancelled discovery must fail before Provider authority");
    assert!(blocked_reason(&discovery_error).contains("cancelled"));
    assert_eq!(authority.target_calls(), authority_calls);

    let cancelled_error = driver
        .plan_apply(
            target,
            connection,
            ProvisioningAccessMode::Write,
            &cancelled,
        )
        .await
        .expect_err("cancelled planning must fail before Provider authority");
    assert!(blocked_reason(&cancelled_error).contains("cancelled"));
    assert_eq!(authority.target_calls(), authority_calls);

    authority.set_target_behavior(TargetBehavior::Drift);
    let active = CancellationToken::new();
    assert!(driver
        .plan_apply(target, connection, ProvisioningAccessMode::Write, &active,)
        .await
        .is_err());

    authority.set_target_behavior(TargetBehavior::Ready);
    let plan = driver
        .plan_apply(target, connection, ProvisioningAccessMode::Write, &active)
        .await
        .expect("plan exact Provider write fixture");
    assert_eq!(
        plan.steps()
            .iter()
            .map(|step| (step.action(), step.access()))
            .collect::<Vec<_>>(),
        vec![
            (ProvisioningAction::VerifyProviderTarget, None),
            (
                ProvisioningAction::SmokeTestReadCredential,
                Some(ProvisioningAccessMode::Read),
            ),
            (
                ProvisioningAction::SmokeTestWriteCredential,
                Some(ProvisioningAccessMode::Write),
            ),
        ]
    );

    authority.set_target_behavior(TargetBehavior::Unavailable);
    assert!(matches!(
        driver.inspect(&plan, &active).await,
        Err(AppError::Network(_))
    ));

    authority.set_target_behavior(TargetBehavior::Drift);
    assert!(matches!(
        driver.inspect(&plan, &active).await,
        Ok(ProvisioningInspection::Drift(
            ProvisioningRepairReason::ProviderDrift
        ))
    ));

    authority.set_target_behavior(TargetBehavior::Ready);
    runtime.set_smoke_failure(Some(ProvisioningAccessMode::Read));
    assert!(matches!(
        driver.inspect(&plan, &active).await,
        Ok(ProvisioningInspection::Drift(
            ProvisioningRepairReason::CredentialSmokeFailed
        ))
    ));
    runtime.set_smoke_failure(None);
    let verified = match driver
        .inspect(&plan, &active)
        .await
        .expect("inspect exact Provider fixture")
    {
        ProvisioningInspection::Verified(verified) => verified,
        ProvisioningInspection::Drift(reason) => {
            panic!("exact Provider fixture unexpectedly drifted: {reason:?}")
        }
    };
    assert_eq!(
        verified.provider_audit_id(),
        Some(target.provider_audit_id())
    );

    for access in [ProvisioningAccessMode::Read, ProvisioningAccessMode::Write] {
        let action = match access {
            ProvisioningAccessMode::Read => ProvisioningAction::SmokeTestReadCredential,
            ProvisioningAccessMode::Write => ProvisioningAction::SmokeTestWriteCredential,
        };
        let step = plan
            .steps()
            .iter()
            .find(|step| step.action() == action)
            .expect("find Provider smoke step");
        let permit = permit(driver, &plan, step, 1_100 + u128::from(step.sequence()));
        runtime.set_smoke_failure(Some(access));
        assert!(driver
            .execute_step(&plan, step, &permit, &active)
            .await
            .is_err());
        runtime.set_smoke_failure(None);
    }

    let verify_step = plan
        .steps()
        .iter()
        .find(|step| step.action() == ProvisioningAction::VerifyProviderTarget)
        .expect("find Provider target verification step");
    let wrong_provider = match driver.provider() {
        LocalProvider::GcpCloudSql => LocalProvider::Neon,
        LocalProvider::Neon | LocalProvider::PlanetScale => LocalProvider::GcpCloudSql,
    };
    let invalid_permit = ProvisioningExecutionPermit::issue(
        Uuid::from_u128(1_200),
        wrong_provider,
        plan.payload_sha256().into(),
        verify_step.execution_sha256().into(),
    );
    let authority_calls = authority.target_calls();
    assert!(driver
        .execute_step(&plan, verify_step, &invalid_permit, &active)
        .await
        .is_err());
    assert_eq!(authority.target_calls(), authority_calls);

    let cancelled_permit = permit(driver, &plan, verify_step, 1_201);
    let authority_calls = authority.target_calls();
    assert!(driver
        .execute_step(&plan, verify_step, &cancelled_permit, &cancelled,)
        .await
        .is_err());
    assert_eq!(authority.target_calls(), authority_calls);

    let authority_calls = authority.target_calls();
    let cancelled_verification = driver
        .verify(&plan, &cancelled)
        .await
        .expect_err("cancelled verification must fail before Provider authority");
    assert!(blocked_reason(&cancelled_verification).contains("incomplete"));
    let Err(cancelled_inspection) = driver.inspect(&plan, &cancelled).await else {
        panic!("cancelled inspection must fail before Provider authority");
    };
    assert!(blocked_reason(&cancelled_inspection).contains("cancelled"));
    assert_eq!(authority.target_calls(), authority_calls);

    let verification = driver
        .verify(&plan, &active)
        .await
        .expect("verify exact Provider plan");
    assert_eq!(
        verification.provider_audit_id(),
        Some(target.provider_audit_id())
    );

    let receipt = ProvisioningReceipt::ready_to_apply(
        WorkspaceId::from(connection.scope.workspace_id),
        "provider-contract-account".into(),
        target.connection_id(),
        Uuid::from_u128(1_300),
        &plan,
        Utc::now(),
    )
    .expect("create Provider destroy fixture receipt");

    let destroy_authority_calls = authority.target_calls();
    let cancelled_destroy = driver
        .plan_destroy(
            &receipt,
            target,
            connection,
            ProvisioningAccessMode::Write,
            &cancelled,
        )
        .await
        .expect_err("cancelled destroy planning must fail");
    assert!(blocked_reason(&cancelled_destroy).contains("cancelled"));
    assert_eq!(authority.target_calls(), destroy_authority_calls);

    let cancelled_repair = driver
        .plan_repair(
            &receipt,
            target,
            connection,
            ProvisioningAccessMode::Write,
            &cancelled,
        )
        .await
        .expect_err("cancelled repair planning must fail");
    assert!(blocked_reason(&cancelled_repair).contains("cancelled"));
    assert_eq!(authority.target_calls(), destroy_authority_calls);

    authority.set_target_behavior(TargetBehavior::Drift);
    assert!(driver
        .plan_repair(
            &receipt,
            target,
            connection,
            ProvisioningAccessMode::Write,
            &active,
        )
        .await
        .is_err());
    authority.set_target_behavior(TargetBehavior::Ready);
    let repair = driver
        .plan_repair(
            &receipt,
            target,
            connection,
            ProvisioningAccessMode::Write,
            &active,
        )
        .await
        .expect("plan exact Provider repair");
    assert_ne!(repair.idempotency_key(), plan.idempotency_key());

    let (destroy, marker) = driver
        .plan_destroy(
            &receipt,
            target,
            connection,
            ProvisioningAccessMode::Write,
            &active,
        )
        .await
        .expect("plan exact Provider cleanup");
    assert_eq!(marker, receipt.ownership_marker());
    let destroy_step = destroy.steps().first().expect("Provider destroy step");
    let destroy_permit = permit(driver, &destroy, destroy_step, 1_400);

    runtime.set_fence_failure(true);
    let destroy_calls = authority.destroy_calls();
    assert!(driver
        .execute_step(&destroy, destroy_step, &destroy_permit, &active)
        .await
        .is_err());
    assert_eq!(authority.destroy_calls(), destroy_calls);

    runtime.set_fence_failure(false);
    authority.set_destroy_failure(true);
    assert!(driver
        .execute_step(&destroy, destroy_step, &destroy_permit, &active)
        .await
        .is_err());
    assert_eq!(authority.destroy_calls(), destroy_calls + 1);
    assert!(runtime.fence_calls() >= 2);

    authority.set_destroy_failure(false);
    driver
        .execute_step(&destroy, destroy_step, &destroy_permit, &active)
        .await
        .expect("complete exact Provider cleanup after retry");
}

fn permit(
    driver: &dyn ProvisioningDriver,
    plan: &super::domain::ProvisioningPlan,
    step: &super::domain::ProvisioningPlanStep,
    operation_id: u128,
) -> ProvisioningExecutionPermit {
    ProvisioningExecutionPermit::issue(
        Uuid::from_u128(operation_id),
        driver.provider(),
        plan.payload_sha256().into(),
        step.execution_sha256().into(),
    )
}

fn blocked_reason(error: &AppError) -> &str {
    match error {
        AppError::Blocked { reason } => reason,
        other => panic!("expected blocked Provider error, got {other}"),
    }
}
