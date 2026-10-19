//! Coordinator ordering contract, run from `assert_direct_access_contract`.
//!
//! Port fakes record every database statement and control-plane call so the
//! revocation protocol's ordering is checked without a server: a failed database
//! revoke never reaches the control-plane mutation, a missing credential blocks with
//! no database or control-plane effect, and a multi-member change commits only when
//! every principal was revoked.

use std::sync::{Arc, Mutex};

use crate::kernel::sync::lock_unpoisoned;

use serde_json::{json, Value};
use uuid::Uuid;

use dopedb_protocol::{
    DirectEngine as WireEngine, DirectLevel, DirectPrincipalState, DirectProvisioningStatus,
    DirectReceiptRequest, DirectRevocationEntry, DirectRevocationKind, DirectRevocationState,
    DirectVerifierKind, DirectVerifierRequest, DirectWorkAction, DirectWorkList,
    DirectWorkListItem,
};

use super::application::DirectAccessUseCases;
use super::domain::{DirectEngine, FailureCode, PrincipalName};
use super::ownership::{ObservedPrincipal, ServerIdentity};
use super::plan::{PlannedStatement, Planner};
use super::ports::{
    AdminCredentialVault, DirectControlPlanePort, DirectLocalPort, LocalTemplate, MutationOutcome,
    RevocationSettle, StagedPassword, TargetDatabasePort, TargetSession,
};
use super::revocation::{MutationState, RevocationTarget, RevokeApplyRequest};
use super::types::{AdminCredential, DirectScope, PreflightFacts, Secret, TargetEndpoint};
use super::verifier::{generate_member_password, postgres_scram_verifier};
use crate::error::{AppError, AppResult};
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};

#[derive(Default)]
struct Log {
    statements: Vec<String>,
    mutations: Vec<Value>,
    receipts: Vec<DirectReceiptRequest>,
    settled: Vec<(String, &'static str)>,
}

#[derive(Clone)]
struct World {
    log: Arc<Mutex<Log>>,
    credential: bool,
    /// Principal ids whose DROP/REVOKE statements the database refuses.
    failing: Vec<String>,
    /// Whether the administrator account may end other accounts' sessions.
    can_end_sessions: bool,
    items: Arc<Vec<DirectWorkListItem>>,
}

#[derive(Clone)]
struct FakeVault(World);
#[derive(Clone)]
struct FakeTarget(World);
struct FakeSession(World, Option<String>);
#[derive(Clone)]
struct FakeControl(World);
#[derive(Clone)]
struct FakeLocal;

impl AdminCredentialVault for FakeVault {
    fn store(&self, _: &DirectScope, _: &AdminCredential) -> AppResult<()> {
        Ok(())
    }
    fn fetch(&self, _: &DirectScope) -> AppResult<Option<AdminCredential>> {
        self.0
            .credential
            .then(|| AdminCredential::new("admin".into(), Secret::new("pw".into()), None))
            .transpose()
    }
    fn contains(&self, _: &DirectScope) -> AppResult<bool> {
        Ok(self.0.credential)
    }
    fn delete(&self, _: &DirectScope) -> AppResult<()> {
        Ok(())
    }
}

impl TargetDatabasePort for FakeTarget {
    type Session = FakeSession;
    async fn open(
        &self,
        _: &TargetEndpoint,
        _: &AdminCredential,
    ) -> Result<FakeSession, FailureCode> {
        Ok(FakeSession(self.0.clone(), None))
    }
}

impl TargetSession for FakeSession {
    async fn version(&mut self) -> Result<String, FailureCode> {
        Ok("160002".into())
    }
    async fn fingerprint(&mut self) -> Result<String, FailureCode> {
        Ok("fingerprint-1".into())
    }
    async fn preflight(&mut self, _: bool) -> Result<PreflightFacts, FailureCode> {
        Err(FailureCode::Network)
    }
    async fn observe(&mut self, name: &PrincipalName) -> Result<ObservedPrincipal, FailureCode> {
        self.1 = Some(name.as_str().to_owned());
        let item = self
            .0
            .items
            .iter()
            .find(|i| i.principal_name == name.as_str())
            .unwrap();
        Ok(ObservedPrincipal {
            name_exists: true,
            marker: super::domain::Marker::parse(&item.marker),
            identity: Some(ServerIdentity::PostgresRoleOid(42)),
            owned_objects: 0,
            unexpected_memberships: 0,
        })
    }
    async fn execute(&mut self, plan: &[PlannedStatement]) -> Result<(), FailureCode> {
        for statement in plan {
            let who = self.1.clone().unwrap_or_default();
            let refused = self
                .0
                .failing
                .iter()
                .any(|name| statement.sql.contains(name))
                && (statement.sql.starts_with("DROP") || statement.sql.starts_with("REVOKE"));
            let _ = who;
            if refused {
                return Err(FailureCode::PermissionDenied);
            }
            lock_unpoisoned(&self.0.log)
                .statements
                .push(statement.sql.clone());
        }
        Ok(())
    }
    async fn terminate_sessions(
        &mut self,
        _: &Planner,
        _: &PrincipalName,
    ) -> Result<bool, FailureCode> {
        Ok(self.0.can_end_sessions)
    }
    async fn close(self) {}
}

fn entry_for(
    scope: &DirectScope,
    id: Uuid,
    member: &str,
    kind: DirectRevocationKind,
    target_level: DirectLevel,
) -> DirectRevocationEntry {
    DirectRevocationEntry {
        id: id.to_string(),
        connection_id: scope.connection_id.to_string(),
        member_id: member.to_owned(),
        principal_name: None,
        kind,
        target_level,
        state: DirectRevocationState::Pending,
        created_at: "2026-01-01T00:00:00Z".into(),
    }
}

impl DirectControlPlanePort for FakeControl {
    async fn register(
        &self,
        _: &AccountId,
        _: WorkspaceId,
        _: Value,
    ) -> AppResult<(ConnectionId, i64)> {
        Err(AppError::Network("unused".into()))
    }
    async fn principal_status(&self, _: &DirectScope) -> AppResult<DirectProvisioningStatus> {
        Err(AppError::Network("unused".into()))
    }
    async fn put_verifier(
        &self,
        _: &DirectScope,
        _: &DirectVerifierRequest,
    ) -> AppResult<DirectProvisioningStatus> {
        Err(AppError::Network("unused".into()))
    }
    async fn work(&self, scope: &DirectScope) -> AppResult<DirectWorkList> {
        Ok(DirectWorkList {
            connection_id: scope.connection_id.to_string(),
            engine: WireEngine::Postgres,
            scope: vec!["public".into()],
            scope_revision: 1,
            write_ceiling: true,
            server_fingerprint: Some("fingerprint-1".into()),
            items: self.0.items.to_vec(),
            revocations: Vec::new(),
        })
    }
    async fn claim(
        &self,
        _: &DirectScope,
        _: &str,
        ids: &[String],
    ) -> AppResult<Vec<DirectWorkListItem>> {
        Ok(self
            .0
            .items
            .iter()
            .filter(|i| ids.contains(&i.principal_id))
            .cloned()
            .collect())
    }
    async fn receipt(&self, _: &DirectScope, request: &DirectReceiptRequest) -> AppResult<()> {
        assert!(
            request.validate(),
            "receipts must satisfy the wire contract"
        );
        lock_unpoisoned(&self.0.log).receipts.push(request.clone());
        Ok(())
    }
    async fn list_revocations(
        &self,
        _: &AccountId,
        _: WorkspaceId,
    ) -> AppResult<Vec<DirectRevocationEntry>> {
        Ok(Vec::new())
    }
    async fn create_revocations(
        &self,
        scope: &DirectScope,
        kind: DirectRevocationKind,
        member_ids: &[String],
        target_level: DirectLevel,
    ) -> AppResult<Vec<DirectRevocationEntry>> {
        Ok(member_ids
            .iter()
            .map(|m| entry_for(scope, Uuid::new_v4(), m, kind, target_level))
            .collect())
    }
    async fn settle_revocation(
        &self,
        _: &AccountId,
        _: WorkspaceId,
        id: &str,
        state: RevocationSettle,
    ) -> AppResult<()> {
        let label = if state == RevocationSettle::Applied {
            "applied"
        } else {
            "cancelled"
        };
        lock_unpoisoned(&self.0.log)
            .settled
            .push((id.to_owned(), label));
        Ok(())
    }
    async fn mutate(&self, _: &AccountId, operation: Value) -> AppResult<MutationOutcome> {
        lock_unpoisoned(&self.0.log).mutations.push(operation);
        Ok(MutationOutcome::Done)
    }
}

impl DirectLocalPort for FakeLocal {
    async fn template(&self, _: &DirectScope) -> AppResult<LocalTemplate> {
        Ok(LocalTemplate {
            engine: DirectEngine::Postgres,
            host: "db.example.test".into(),
            port: 5432,
            database: "app".into(),
            sslmode: "verify-full".into(),
        })
    }
    async fn prefill(&self, _: ConnectionId) -> AppResult<(LocalTemplate, Option<String>)> {
        Err(AppError::Network("unused".into()))
    }
    async fn provisioned(&self) -> AppResult<Vec<DirectScope>> {
        Ok(Vec::new())
    }
    async fn device_id(&self, _: &DirectScope) -> AppResult<String> {
        Ok("device-1".into())
    }
    fn stage_password(&self, _: &str) -> AppResult<StagedPassword> {
        Ok(StagedPassword(Uuid::nil()))
    }
    fn discard_password(&self, _: StagedPassword) {}
    async fn bind_password(
        &self,
        _: &DirectScope,
        _: StagedPassword,
        _: Option<&str>,
    ) -> AppResult<()> {
        Ok(())
    }
    async fn apply_principal(&self, _: &DirectScope, _: Option<&str>) -> AppResult<()> {
        Ok(())
    }
}

fn item(index: u8, member: &str) -> DirectWorkListItem {
    let password = generate_member_password().unwrap();
    DirectWorkListItem {
        principal_id: Uuid::new_v4().to_string(),
        member_id: member.to_owned(),
        principal_name: format!("dopedb_{index:020x}"),
        marker: format!("{:043}", index),
        verifier_kind: DirectVerifierKind::ScramSha256,
        verifier: postgres_scram_verifier(&password).unwrap(),
        verifier_version: 1,
        applied_verifier_version: 1,
        applied_level: DirectLevel::Write,
        desired_level: DirectLevel::Write,
        state: DirectPrincipalState::Ready,
        server_role_oid: Some("42".into()),
        claim_expires_at: None,
        action: DirectWorkAction::Idle,
    }
}

type Coordinator = DirectAccessUseCases<FakeVault, FakeTarget, FakeControl, FakeLocal>;

fn coordinator(
    credential: bool,
    failing: &[&DirectWorkListItem],
    items: &[DirectWorkListItem],
) -> (Coordinator, Arc<Mutex<Log>>) {
    coordinator_with(true, credential, failing, items)
}

fn coordinator_with(
    can_end_sessions: bool,
    credential: bool,
    failing: &[&DirectWorkListItem],
    items: &[DirectWorkListItem],
) -> (Coordinator, Arc<Mutex<Log>>) {
    let world = World {
        log: Arc::default(),
        credential,
        can_end_sessions,
        failing: failing.iter().map(|i| i.principal_name.clone()).collect(),
        items: Arc::new(items.to_vec()),
    };
    let log = world.log.clone();
    (
        DirectAccessUseCases::new(
            FakeVault(world.clone()),
            FakeTarget(world.clone()),
            FakeControl(world),
            FakeLocal,
        ),
        log,
    )
}

fn request(
    kind: DirectRevocationKind,
    scope: &DirectScope,
    members: &[&DirectWorkListItem],
    mutation: Value,
) -> RevokeApplyRequest {
    request_levels(kind, scope, &[(DirectLevel::None, members)], mutation)
}

/// One target per level on the same connection.
fn request_levels(
    kind: DirectRevocationKind,
    scope: &DirectScope,
    levels: &[(DirectLevel, &[&DirectWorkListItem])],
    mutation: Value,
) -> RevokeApplyRequest {
    RevokeApplyRequest {
        account_id: scope.account_id.clone(),
        workspace_id: scope.workspace_id,
        kind,
        targets: levels
            .iter()
            .map(|(target_level, members)| RevocationTarget {
                connection_id: scope.connection_id,
                target_level: *target_level,
                member_ids: members.iter().map(|m| m.member_id.clone()).collect(),
            })
            .collect(),
        mutation,
        credentials: Vec::new(),
    }
}

pub(super) async fn assert_revocation_ordering_contract() {
    let scope = DirectScope {
        account_id: AccountId::new("account-1").unwrap(),
        workspace_id: WorkspaceId::from(Uuid::from_u128(100)),
        connection_id: ConnectionId::from(Uuid::from_u128(200)),
    };
    let signed_in = [scope.account_id.clone()];
    let a = item(1, &Uuid::from_u128(11).to_string());
    let b = item(2, &Uuid::from_u128(12).to_string());
    let all = [a.clone(), b.clone()];
    let remove = |member: &DirectWorkListItem| json!({"kind": "removeMember", "workspaceId": scope.workspace_id, "memberId": member.member_id});
    let team_off = json!({
        "kind": "setTeamReadAccess", "workspaceId": scope.workspace_id,
        "connectionId": scope.connection_id, "enabled": false,
    });

    // Success: drop on the database, receipt, then the mutation, then settle.
    let (ok, log) = coordinator(true, &[], &all);
    let outcome = ok
        .revoke_apply(
            &signed_in,
            request(
                DirectRevocationKind::MemberRemoved,
                &scope,
                &[&a],
                remove(&a),
            ),
        )
        .await
        .unwrap();
    assert_eq!(outcome.mutation, MutationState::Done);
    assert_eq!((outcome.applied.len(), outcome.pending.len()), (1, 0));
    {
        let log = lock_unpoisoned(&log);
        assert!(log
            .statements
            .iter()
            .any(|sql| sql.starts_with("DROP ROLE")));
        assert_eq!(log.receipts.len(), 1);
        assert_eq!(log.mutations.len(), 1);
        assert_eq!(log.settled.len(), 1);
    }

    // Role lowering can leave different levels per account: one accepts none (dropped),
    // the other read (revoked to read, kept). A write target is refused.
    let (mixed, log) = coordinator(true, &[], &all);
    let outcome = mixed
        .revoke_apply(
            &signed_in,
            request_levels(
                DirectRevocationKind::RoleLowered,
                &scope,
                &[(DirectLevel::None, &[&a]), (DirectLevel::Read, &[&b])],
                remove(&a),
            ),
        )
        .await
        .unwrap();
    assert_eq!(outcome.mutation, MutationState::Done);
    assert_eq!((outcome.applied.len(), outcome.pending.len()), (2, 0));
    assert!(!outcome.open_sessions_may_persist);
    {
        let log = lock_unpoisoned(&log);
        let dropped = log
            .statements
            .iter()
            .filter(|sql| sql.starts_with("DROP ROLE"))
            .count();
        assert_eq!(dropped, 1, "only the none-target account is dropped");
        let levels: Vec<_> = log.receipts.iter().map(|r| r.applied_level).collect();
        assert!(
            levels.contains(&DirectLevel::Read),
            "the read target stays: {levels:?}"
        );
    }
    assert!(mixed
        .revoke_apply(
            &signed_in,
            request_levels(
                DirectRevocationKind::RoleLowered,
                &scope,
                &[(DirectLevel::Write, &[&a])],
                remove(&a),
            ),
        )
        .await
        .is_err());

    // An administrator account that cannot end sessions still revokes and drops, and the
    // outcome says already-open sessions may persist.
    let (limited, log) = coordinator_with(false, true, &[], &all);
    let outcome = limited
        .revoke_apply(
            &signed_in,
            request(
                DirectRevocationKind::MemberRemoved,
                &scope,
                &[&a],
                remove(&a),
            ),
        )
        .await
        .unwrap();
    assert_eq!(outcome.mutation, MutationState::Done);
    assert!(outcome.open_sessions_may_persist);
    assert!(lock_unpoisoned(&log)
        .statements
        .iter()
        .any(|sql| sql.starts_with("DROP ROLE")));

    // A refused database revoke never reaches the control-plane mutation.
    let (refused, log) = coordinator(true, &[&a], &all);
    let outcome = refused
        .revoke_apply(
            &signed_in,
            request(
                DirectRevocationKind::MemberRemoved,
                &scope,
                &[&a],
                remove(&a),
            ),
        )
        .await
        .unwrap();
    assert_eq!(outcome.mutation, MutationState::NotAttempted);
    assert_eq!(
        (
            outcome.applied.len(),
            outcome.pending.len(),
            outcome.failed.len()
        ),
        (0, 1, 1)
    );
    assert!(lock_unpoisoned(&log).mutations.is_empty());

    // No administrator credential: blocked, no database or control-plane effect.
    let (blocked, log) = coordinator(false, &[], &all);
    let outcome = blocked
        .revoke_apply(
            &signed_in,
            request(
                DirectRevocationKind::MemberRemoved,
                &scope,
                &[&a],
                remove(&a),
            ),
        )
        .await
        .unwrap();
    assert_eq!(
        outcome.blocked_no_credential,
        vec![scope.connection_id.to_string()]
    );
    assert_eq!(outcome.pending.len(), 1);
    {
        let log = lock_unpoisoned(&log);
        assert!(log.statements.is_empty() && log.receipts.is_empty() && log.mutations.is_empty());
    }

    // Team read-off is all-or-nothing: one refused principal blocks the single change.
    let (partial, log) = coordinator(true, &[&b], &all);
    let outcome = partial
        .revoke_apply(
            &signed_in,
            request(
                DirectRevocationKind::TeamReadOff,
                &scope,
                &[&a, &b],
                team_off.clone(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(outcome.mutation, MutationState::NotAttempted);
    assert!(outcome.applied.is_empty() && outcome.pending.len() == 2);
    assert!(lock_unpoisoned(&log).mutations.is_empty());
    let (whole, log) = coordinator(true, &[], &all);
    let outcome = whole
        .revoke_apply(
            &signed_in,
            request(
                DirectRevocationKind::TeamReadOff,
                &scope,
                &[&a, &b],
                team_off,
            ),
        )
        .await
        .unwrap();
    assert_eq!(
        (outcome.mutation, outcome.applied.len()),
        (MutationState::Done, 2)
    );
    assert_eq!(lock_unpoisoned(&log).mutations.len(), 1);

    // Deleting the database settles its own items on the server.
    let delete = json!({
        "kind": "deleteSharedConnection", "workspaceId": scope.workspace_id,
        "connectionId": scope.connection_id, "expectedRevision": 3,
    });
    let (deleted, log) = coordinator(true, &[], &all);
    let outcome = deleted
        .revoke_apply(
            &signed_in,
            request(DirectRevocationKind::DbDeleted, &scope, &[&a], delete),
        )
        .await
        .unwrap();
    assert_eq!(outcome.applied.len(), 1);
    assert!(lock_unpoisoned(&log).settled.is_empty());
}
