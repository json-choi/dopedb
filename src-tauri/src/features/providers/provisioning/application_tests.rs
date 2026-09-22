//! Provisioning restart and resume contract coverage.

use super::*;

pub(crate) async fn assert_restart_resume_lifecycle() {
    use chrono::Duration as ChronoDuration;
    use dopedb_protocol::{OperationActorKind, OperationRiskLevel};

    use crate::operations::{
        ExactApprovalRequest, LocalApprovalAuthority, NewOperation, OperationActor,
        OperationActorProvenance, OperationApprover, OperationPlanDisposition,
    };

    use super::super::domain::{
        fixture_plan, fixture_repair_plan, ManagedAccessCapability, ProvisioningCapabilityManifest,
        ProvisioningIntent,
    };
    use crate::kernel::identity::{ConnectionId, WorkspaceId};

    use ManagedAccessCapability::{
        Apply, Destroy, Detect, Discover, Issue, Plan, Reconcile, Verify,
    };

    #[derive(Debug, Default)]
    struct MockProviderEffects {
        attempted_sequences: Vec<u16>,
        applied_actions: Vec<ProvisioningAction>,
    }

    #[derive(Default)]
    struct MockDriver {
        fail_sequence: Option<u16>,
        fail_verification: bool,
        effects: Arc<Mutex<MockProviderEffects>>,
    }

    impl ProvisioningDriver for MockDriver {
        fn provider(&self) -> LocalProvider {
            LocalProvider::GcpCloudSql
        }

        fn manifest_sha256(&self) -> &str {
            "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"
        }

        fn detect<'a>(
            &'a self,
            _authority: &'a ProvisioningReadAuthority,
            _cancellation: &'a CancellationToken,
        ) -> DriverFuture<'a, ProvisioningDriverStatus> {
            Box::pin(async move {
                Ok(ProvisioningDriverStatus {
                    provider: LocalProvider::GcpCloudSql,
                    prerequisite_kind: ProvisioningPrerequisiteKind::OfficialCli,
                    prerequisite_name: "mock-gcloud".into(),
                    minimum_version: Some("1.0.0".into()),
                    installed_version: Some("1.0.0".into()),
                    active_identity: Some("owner@example.com".into()),
                    readiness: ProvisioningReadiness::Ready,
                })
            })
        }

        fn discover<'a>(
            &'a self,
            _connection_id: Uuid,
            _authority: &'a ProvisioningReadAuthority,
            _cancellation: &'a CancellationToken,
        ) -> DriverFuture<'a, Vec<ProvisioningDiscoveredTarget>> {
            Box::pin(async move {
                let plan = fixture_plan(
                    ProvisioningIntent::Apply,
                    ProvisioningCapabilityManifest::new([
                        Detect, Discover, Plan, Apply, Verify, Issue, Reconcile, Destroy,
                    ]),
                );
                Ok(vec![ProvisioningDiscoveredTarget::new(
                    plan.target().clone(),
                )])
            })
        }

        fn plan_apply<'a>(
            &'a self,
            _target: &'a ProvisioningTarget,
            _connection: &'a PinnedConnection,
            _access: ProvisioningAccessMode,
            _cancellation: &'a CancellationToken,
        ) -> DriverFuture<'a, ProvisioningPlan> {
            Box::pin(async move {
                Ok(fixture_plan(
                    ProvisioningIntent::Apply,
                    ProvisioningCapabilityManifest::new([
                        Detect, Discover, Plan, Apply, Verify, Issue, Reconcile, Destroy,
                    ]),
                ))
            })
        }

        fn plan_destroy<'a>(
            &'a self,
            _receipt: &'a ProvisioningReceipt,
            _target: &'a ProvisioningTarget,
            _connection: &'a PinnedConnection,
            _access: ProvisioningAccessMode,
            _cancellation: &'a CancellationToken,
        ) -> DriverFuture<'a, (ProvisioningPlan, String)> {
            Box::pin(async move {
                let plan = fixture_plan(
                    ProvisioningIntent::Destroy,
                    ProvisioningCapabilityManifest::new([
                        Detect, Discover, Plan, Apply, Verify, Issue, Reconcile, Destroy,
                    ]),
                );
                let marker = plan.ownership_marker().to_owned();
                Ok((plan, marker))
            })
        }

        fn plan_repair<'a>(
            &'a self,
            _receipt: &'a ProvisioningReceipt,
            _target: &'a ProvisioningTarget,
            _connection: &'a PinnedConnection,
            _access: ProvisioningAccessMode,
            _cancellation: &'a CancellationToken,
        ) -> DriverFuture<'a, ProvisioningPlan> {
            Box::pin(async move {
                Ok(fixture_repair_plan(ProvisioningCapabilityManifest::new([
                    Detect, Discover, Plan, Apply, Verify, Issue, Reconcile, Destroy,
                ])))
            })
        }

        fn inspect<'a>(
            &'a self,
            plan: &'a ProvisioningPlan,
            _cancellation: &'a CancellationToken,
        ) -> DriverFuture<'a, ProvisioningInspection> {
            Box::pin(async move {
                Ok(ProvisioningInspection::Verified(
                    ProvisioningVerification::complete(
                        Some(plan.target().provider_audit_id().into()),
                        Utc::now(),
                    )?,
                ))
            })
        }

        fn execute_step<'a>(
            &'a self,
            _plan: &'a ProvisioningPlan,
            step: &'a ProvisioningPlanStep,
            _permit: &'a ProvisioningExecutionPermit,
            cancellation: &'a CancellationToken,
        ) -> DriverFuture<'a, ProvisioningStepEvidence> {
            Box::pin(async move {
                if cancellation.is_cancelled() {
                    return Err(blocked("mock provider operation was cancelled"));
                }
                let mut effects = self.effects.lock().await;
                effects.attempted_sequences.push(step.sequence());
                if self.fail_sequence == Some(step.sequence()) {
                    return Err(blocked("mock provider step outcome is unknown"));
                }
                if !effects.applied_actions.contains(&step.action()) {
                    effects.applied_actions.push(step.action());
                }
                Ok(ProvisioningStepEvidence::exact(step))
            })
        }

        fn verify<'a>(
            &'a self,
            plan: &'a ProvisioningPlan,
            cancellation: &'a CancellationToken,
        ) -> DriverFuture<'a, ProvisioningVerification> {
            Box::pin(async move {
                if cancellation.is_cancelled() {
                    return Err(blocked("mock provider verification was cancelled"));
                }
                if self.fail_verification {
                    return Err(blocked("mock provider verification failed"));
                }
                ProvisioningVerification::complete(
                    Some(plan.target().provider_audit_id().into()),
                    Utc::now(),
                )
            })
        }
    }

    async fn seed_fixture_connection(store: &Store, plan: &ProvisioningPlan) {
        let connection = crate::model::ConnectionProfile {
            id: Uuid::from(plan.target().connection_id()),
            name: "fixture-instance / app".into(),
            engine: Engine::Postgres,
            provider: crate::model::Provider::GcpCloudSql,
            driver_id: None,
            host: "127.0.0.1".into(),
            port: 5432,
            database: "app".into(),
            username: "fixture".into(),
            sslmode: "disable".into(),
            extra_params: HashMap::new(),
            readonly_default: true,
            allow_writes: false,
            secret_ref: None,
            env: Some("dev".into()),
            schema_group: None,
            workspace_access: crate::model::WorkspaceConnectionAccess::Local,
            credential_mode: crate::model::WorkspaceCredentialMode::Local,
            provider_target: None,
            schema_access_available: false,
        };
        for expected_revision in 1..=plan.target().connection_revision() {
            store
                .upsert_connection(&connection)
                .await
                .unwrap_or_else(|error| {
                    panic!("seed fixture connection revision {expected_revision}: {error}")
                });
        }
    }

    async fn approved_operation(
        runtime: &OperationRuntime,
        authority: &LocalApprovalAuthority,
        scope: &ActiveResourceScope,
        plan: &ProvisioningPlan,
        operation_id: Uuid,
    ) -> OperationRecord {
        let operation = runtime
            .plan(
                NewOperation {
                    id: operation_id,
                    workspace_id: scope.workspace_id,
                    account_scope: scope.account_scope.storage_key().into(),
                    connection_id: Uuid::from(plan.target().connection_id()),
                    connection_revision: plan.target().connection_revision(),
                    terminal_session_id: None,
                    actor: OperationActor {
                        kind: OperationActorKind::LocalUser,
                        id: "local-user".into(),
                        provenance: OperationActorProvenance {
                            origin_surface: "provider-provisioning-test".into(),
                            ..OperationActorProvenance::default()
                        },
                    },
                    kind: OperationKind::ProviderAction,
                    payload_schema_version: 1,
                    payload: plan.operation_payload().unwrap(),
                    schema_fingerprint: None,
                    risk_level: OperationRiskLevel::High,
                    preview: serde_json::json!({"provider": "gcpCloudSql"}),
                    policy_snapshot: serde_json::json!({"environment": "prod"}),
                    policy_revision: "provider-policy-v1".into(),
                    single_use: true,
                    idempotency_key: plan.idempotency_key().into(),
                    expires_at: Some(Utc::now() + ChronoDuration::minutes(5)),
                },
                OperationPlanDisposition::ApprovalRequired,
            )
            .await
            .expect("plan provider operation");
        runtime
            .approve_exact(
                authority,
                ExactApprovalRequest {
                    operation_id,
                    expected_payload_hash: operation.payload_hash.clone(),
                    approver: OperationApprover {
                        kind: OperationActorKind::LocalUser,
                        id: "local-user".into(),
                    },
                    current_policy_revision: operation.policy_revision.clone(),
                    reason: Some("test exact target".into()),
                },
            )
            .await
            .expect("approve exact provider operation")
    }

    async fn approve_planned_operation(
        runtime: &OperationRuntime,
        authority: &LocalApprovalAuthority,
        operation_id: Uuid,
    ) -> OperationRecord {
        let operation = runtime
            .get(operation_id)
            .await
            .expect("load planned provider operation");
        runtime
            .approve_exact(
                authority,
                ExactApprovalRequest {
                    operation_id,
                    expected_payload_hash: operation.payload_hash.clone(),
                    approver: OperationApprover {
                        kind: OperationActorKind::LocalUser,
                        id: "local-user".into(),
                    },
                    current_policy_revision: operation.policy_revision.clone(),
                    reason: Some("repair exact provider target".into()),
                },
            )
            .await
            .expect("approve planned provider operation")
    }

    async fn assert_apply_failure_repair(
        fail_sequence: Option<u16>,
        fail_verification: bool,
        expected_completed_steps: u16,
        expected_repair_reason: ProvisioningRepairReason,
        expected_operation_reason: &'static str,
    ) {
        let store = Store::in_memory_for_test()
            .await
            .expect("open partial apply recovery store");
        let scope = store
            .active_resource_scope()
            .await
            .expect("resolve partial apply test scope");
        let plan = fixture_plan(
            ProvisioningIntent::Apply,
            ProvisioningCapabilityManifest::new([
                Detect, Discover, Plan, Apply, Verify, Issue, Reconcile, Destroy,
            ]),
        );
        let connection = crate::model::ConnectionProfile {
            id: Uuid::from(plan.target().connection_id()),
            name: "fixture-instance / app".into(),
            engine: Engine::Postgres,
            provider: crate::model::Provider::GcpCloudSql,
            driver_id: None,
            host: "127.0.0.1".into(),
            port: 5432,
            database: "app".into(),
            username: "fixture".into(),
            sslmode: "disable".into(),
            extra_params: HashMap::new(),
            readonly_default: true,
            allow_writes: false,
            secret_ref: None,
            env: Some("dev".into()),
            schema_group: None,
            workspace_access: crate::model::WorkspaceConnectionAccess::Local,
            credential_mode: crate::model::WorkspaceCredentialMode::Local,
            provider_target: None,
            schema_access_available: false,
        };
        for expected_revision in 1..=plan.target().connection_revision() {
            store
                .upsert_connection(&connection)
                .await
                .unwrap_or_else(|error| {
                    panic!("seed fixture connection revision {expected_revision}: {error}")
                });
        }
        let operation_id = Uuid::from_u128(50);
        let (runtime, authority) = OperationRuntime::new(&store);
        approved_operation(&runtime, &authority, &scope, &plan, operation_id).await;

        let receipt_repository =
            ProvisioningReceiptRepository::new(ProvisioningRepository::new(store.clone()));
        let receipt = ProvisioningReceipt::ready_to_apply(
            WorkspaceId::from(scope.workspace_id),
            scope.account_scope.storage_key().into(),
            plan.target().connection_id(),
            operation_id,
            &plan,
            Utc::now(),
        )
        .expect("create partial apply receipt");
        receipt_repository
            .create(&scope, &receipt)
            .await
            .expect("store partial apply receipt");

        let effects = Arc::new(Mutex::new(MockProviderEffects::default()));
        let failing_coordinator = ProvisioningCoordinator::new(
            ProvisioningRepository::new(store.clone()),
            runtime.clone(),
            ProvisioningDriverRegistry::with_driver(Arc::new(MockDriver {
                fail_sequence,
                fail_verification,
                effects: effects.clone(),
            })),
        );
        assert!(failing_coordinator.execute(receipt.id()).await.is_err());

        let failed = receipt_repository
            .load(&scope, receipt.id())
            .await
            .expect("load deterministic partial apply state");
        assert_eq!(failed.state(), ProvisioningState::NeedsRepair);
        assert_eq!(failed.completed_steps(), expected_completed_steps);
        assert_eq!(failed.repair_reason(), Some(expected_repair_reason));
        assert!(!failed.can_issue());
        assert_eq!(
            runtime.get(operation_id).await.unwrap().state,
            OperationState::OutcomeUnknown
        );
        let failure_events = runtime
            .events(operation_id)
            .await
            .expect("load partial apply audit events");
        let failure = &failure_events.last().unwrap().details;
        assert_eq!(
            failure["providerAuditId"],
            plan.target().provider_audit_id()
        );
        assert_eq!(failure["completedSteps"], expected_completed_steps);
        assert_eq!(failure["reason"], expected_operation_reason);
        assert_eq!(failure["totalSteps"], plan.steps().len());
        assert!(runtime
            .verify_event_chain(operation_id)
            .await
            .expect("verify partial apply audit chain"));

        let expected_partial_actions = plan
            .steps()
            .iter()
            .take(usize::from(expected_completed_steps))
            .map(ProvisioningPlanStep::action)
            .collect::<Vec<_>>();
        assert_eq!(
            effects.lock().await.applied_actions,
            expected_partial_actions
        );

        let repair_coordinator = ProvisioningCoordinator::new(
            ProvisioningRepository::new(store),
            runtime.clone(),
            ProvisioningDriverRegistry::with_driver(Arc::new(MockDriver {
                effects: effects.clone(),
                ..MockDriver::default()
            })),
        );
        let repair = repair_coordinator
            .prepare_repair(receipt.id())
            .await
            .expect("prepare exact partial apply repair");
        assert_eq!(repair.state, ProvisioningState::ReadyToApply);
        assert_eq!(repair.completed_steps, 0);
        assert_eq!(repair.actions.len(), plan.steps().len());
        approve_planned_operation(&runtime, &authority, repair.operation_id).await;

        let repaired = repair_coordinator
            .execute(receipt.id())
            .await
            .expect("execute convergent partial apply repair");
        assert_eq!(repaired.state(), ProvisioningState::Ready);
        assert_eq!(usize::from(repaired.completed_steps()), plan.steps().len());
        assert!(repaired.can_issue());
        assert_eq!(
            runtime.get(repair.operation_id).await.unwrap().state,
            OperationState::Succeeded
        );

        let expected_actions = plan
            .steps()
            .iter()
            .map(ProvisioningPlanStep::action)
            .collect::<Vec<_>>();
        let attempts_before_replay = {
            let effects = effects.lock().await;
            assert_eq!(effects.applied_actions, expected_actions);
            effects.attempted_sequences.len()
        };
        assert!(repair_coordinator.execute(receipt.id()).await.is_err());
        assert_eq!(
            effects.lock().await.attempted_sequences.len(),
            attempts_before_replay
        );
        assert!(runtime
            .verify_event_chain(repair.operation_id)
            .await
            .expect("verify repaired apply audit chain"));
    }

    assert_apply_failure_repair(
        Some(1),
        false,
        0,
        ProvisioningRepairReason::ApplyOutcomeUnknown,
        "provider_apply_outcome_unknown",
    )
    .await;
    assert_apply_failure_repair(
        Some(2),
        false,
        1,
        ProvisioningRepairReason::ApplyOutcomeUnknown,
        "provider_apply_outcome_unknown",
    )
    .await;
    assert_apply_failure_repair(
        Some(3),
        false,
        2,
        ProvisioningRepairReason::ApplyOutcomeUnknown,
        "provider_apply_outcome_unknown",
    )
    .await;
    assert_apply_failure_repair(
        Some(4),
        false,
        3,
        ProvisioningRepairReason::ApplyOutcomeUnknown,
        "provider_apply_outcome_unknown",
    )
    .await;
    assert_apply_failure_repair(
        None,
        true,
        4,
        ProvisioningRepairReason::VerificationFailed,
        "provider_verification_failed",
    )
    .await;

    let retry_store = Store::in_memory_for_test()
        .await
        .expect("open approval retry store");
    let retry_plan = fixture_plan(
        ProvisioningIntent::Apply,
        ProvisioningCapabilityManifest::new([
            Detect, Discover, Plan, Apply, Verify, Issue, Reconcile, Destroy,
        ]),
    );
    seed_fixture_connection(&retry_store, &retry_plan).await;
    let retry_connection_id = Uuid::from(retry_plan.target().connection_id());
    let (first_approval_runtime, _) = OperationRuntime::new(&retry_store);
    let first_approval_coordinator = ProvisioningCoordinator::new(
        ProvisioningRepository::new(retry_store.clone()),
        first_approval_runtime.clone(),
        ProvisioningDriverRegistry::with_driver(Arc::new(MockDriver::default())),
    );
    let staged = first_approval_coordinator
        .discover(LocalProvider::GcpCloudSql, retry_connection_id)
        .await
        .expect("stage initial provider approval target");
    let first_approval = first_approval_coordinator
        .prepare_apply(
            staged[0].discovery_id,
            retry_connection_id,
            ProvisioningAccessMode::Read,
        )
        .await
        .expect("prepare initial provider approval");
    assert_eq!(
        first_approval.operation_state,
        OperationState::PendingApproval
    );
    assert_eq!(
        serde_json::to_value(&first_approval).unwrap()["operationState"],
        "pending_approval"
    );

    let (second_approval_runtime, _) = OperationRuntime::new(&retry_store);
    let approval_recovery = second_approval_runtime
        .recover_previous_runtimes()
        .await
        .expect("expire the previous runtime approval");
    assert_eq!(approval_recovery.expired, vec![first_approval.operation_id]);
    let second_approval_coordinator = ProvisioningCoordinator::new(
        ProvisioningRepository::new(retry_store),
        second_approval_runtime.clone(),
        ProvisioningDriverRegistry::with_driver(Arc::new(MockDriver::default())),
    );
    let restaged = second_approval_coordinator
        .discover(LocalProvider::GcpCloudSql, retry_connection_id)
        .await
        .expect("restage the exact provider approval target");
    let retried_approval = second_approval_coordinator
        .prepare_apply(
            restaged[0].discovery_id,
            retry_connection_id,
            ProvisioningAccessMode::Read,
        )
        .await
        .expect("retry the exact provider approval after restart");
    assert_eq!(retried_approval.receipt_id, first_approval.receipt_id);
    assert_ne!(retried_approval.operation_id, first_approval.operation_id);
    assert_eq!(
        retried_approval.operation_state,
        OperationState::PendingApproval
    );
    assert_eq!(
        first_approval_runtime
            .get(first_approval.operation_id)
            .await
            .unwrap()
            .state,
        OperationState::Expired
    );
    assert_eq!(
        second_approval_runtime
            .get(retried_approval.operation_id)
            .await
            .unwrap()
            .state,
        OperationState::PendingApproval
    );

    let store = Store::in_memory_for_test()
        .await
        .expect("open provisioning recovery store");
    let scope = store
        .active_resource_scope()
        .await
        .expect("resolve active test scope");
    let plan = fixture_plan(
        ProvisioningIntent::Apply,
        ProvisioningCapabilityManifest::new([
            Detect, Discover, Plan, Apply, Verify, Issue, Reconcile, Destroy,
        ]),
    );
    let operation_id = Uuid::from_u128(40);
    let connection_id = Uuid::from(plan.target().connection_id());
    assert!(!verification_matches_plan(
        &plan,
        &ProvisioningVerification::complete(Some("wrong-provider-audit".into()), Utc::now())
            .expect("construct mismatched provider audit fixture"),
    ));
    let (first_runtime, authority) = OperationRuntime::new(&store);
    approved_operation(&first_runtime, &authority, &scope, &plan, operation_id).await;
    let receipt_repository =
        ProvisioningReceiptRepository::new(ProvisioningRepository::new(store.clone()));
    let mut receipt = ProvisioningReceipt::ready_to_apply(
        WorkspaceId::from(scope.workspace_id),
        scope.account_scope.storage_key().into(),
        ConnectionId::from(connection_id),
        operation_id,
        &plan,
        Utc::now(),
    )
    .expect("create recovery receipt");
    receipt_repository
        .create(&scope, &receipt)
        .await
        .expect("store recovery receipt");
    first_runtime
        .claim(operation_id)
        .await
        .expect("claim first runtime operation");
    let expected = receipt.revision();
    receipt
        .begin_apply(&plan, operation_id, Utc::now())
        .expect("begin first runtime apply");
    receipt_repository
        .save(&scope, &receipt, expected)
        .await
        .expect("store apply state");
    let expected = receipt.revision();
    receipt
        .checkpoint(&plan, 1, Utc::now())
        .expect("checkpoint first provider step");
    receipt_repository
        .save(&scope, &receipt, expected)
        .await
        .expect("store first checkpoint");

    let (second_runtime, second_authority) = OperationRuntime::new(&store);
    let recovery = second_runtime
        .recover_previous_runtimes()
        .await
        .expect("classify interrupted operations");
    assert_eq!(
        recovery.provisioning_checkpoint_validation_required,
        vec![operation_id]
    );
    assert!(recovery.outcome_unknown.is_empty());
    let coordinator = ProvisioningCoordinator::new(
        ProvisioningRepository::new(store.clone()),
        second_runtime.clone(),
        ProvisioningDriverRegistry::with_driver(Arc::new(MockDriver::default())),
    );
    let resumed = coordinator
        .recover_previous_runtimes(&recovery.provisioning_checkpoint_validation_required)
        .await
        .expect("resume exact provider checkpoint");
    assert_eq!(resumed.resumed, vec![operation_id]);
    let stored = receipt_repository
        .load(&scope, receipt.id())
        .await
        .expect("load resumed receipt");
    assert_eq!(stored.state(), ProvisioningState::Ready);
    assert!(stored.can_issue());
    assert_eq!(
        second_runtime.get(operation_id).await.unwrap().state,
        OperationState::Succeeded
    );
    let statuses = coordinator
        .driver_statuses()
        .await
        .expect("inspect the closed mock driver");
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].readiness, ProvisioningReadiness::Ready);
    let targets = coordinator
        .discover(LocalProvider::GcpCloudSql, connection_id)
        .await
        .expect("stage a scope-bound provider target");
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].display_name, "fixture-instance / app");
    let status = coordinator
        .status(receipt.id())
        .await
        .expect("project a secret-free completed plan");
    assert_eq!(status.state, ProvisioningState::Ready);
    assert_eq!(status.completed_steps, status.total_steps);
    assert!(status.can_destroy);

    let success_events = second_runtime
        .events(operation_id)
        .await
        .expect("load successful provider audit events");
    assert_eq!(
        success_events.last().unwrap().details["providerAuditId"],
        plan.target().provider_audit_id()
    );
    assert_eq!(
        success_events.last().unwrap().details["completedSteps"],
        plan.steps().len()
    );
    assert!(second_runtime
        .verify_event_chain(operation_id)
        .await
        .expect("verify successful provider audit chain"));

    let destroy_plan = fixture_plan(
        ProvisioningIntent::Destroy,
        ProvisioningCapabilityManifest::new([
            Detect, Discover, Plan, Apply, Verify, Issue, Reconcile, Destroy,
        ]),
    );
    let destroy_operation_id = Uuid::from_u128(41);
    approved_operation(
        &second_runtime,
        &second_authority,
        &scope,
        &destroy_plan,
        destroy_operation_id,
    )
    .await;
    let mut destroying = stored;
    let expected = destroying.revision();
    destroying
        .begin_destroy(
            &destroy_plan,
            destroy_operation_id,
            destroy_plan.ownership_marker(),
            Utc::now(),
        )
        .expect("begin partial destroy fixture");
    receipt_repository
        .save(&scope, &destroying, expected)
        .await
        .expect("persist partial destroy fixture");
    let failing_coordinator = ProvisioningCoordinator::new(
        ProvisioningRepository::new(store),
        second_runtime.clone(),
        ProvisioningDriverRegistry::with_driver(Arc::new(MockDriver {
            fail_sequence: Some(2),
            ..MockDriver::default()
        })),
    );
    assert!(failing_coordinator.execute(destroying.id()).await.is_err());
    let failed = receipt_repository
        .load(&scope, destroying.id())
        .await
        .expect("load deterministic partial destroy state");
    assert_eq!(failed.state(), ProvisioningState::NeedsRepair);
    assert_eq!(failed.completed_steps(), 1);
    assert_eq!(
        failed.repair_reason(),
        Some(ProvisioningRepairReason::CleanupFailed)
    );
    assert!(!failed.can_issue());
    assert_eq!(
        second_runtime
            .get(destroy_operation_id)
            .await
            .unwrap()
            .state,
        OperationState::OutcomeUnknown
    );
    let failure_events = second_runtime
        .events(destroy_operation_id)
        .await
        .expect("load partial destroy audit events");
    let failure = &failure_events.last().unwrap().details;
    assert_eq!(
        failure["providerAuditId"],
        destroy_plan.target().provider_audit_id()
    );
    assert_eq!(failure["completedSteps"], 1);
    assert_eq!(failure["reason"], "provider_destroy_outcome_unknown");
    assert_eq!(failure["totalSteps"], destroy_plan.steps().len());
    assert!(second_runtime
        .verify_event_chain(destroy_operation_id)
        .await
        .expect("verify partial destroy audit chain"));
}
