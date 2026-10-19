//! Administrator-device synchronization of principals with the work list.
//!
//! One pass claims the work the control plane derived (create, alter verifier,
//! change level, re-grant, drop), proves ownership of every principal before any
//! ALTER, REVOKE, or DROP, runs the fixed plans through one short-lived administrator
//! connection, and answers each item with a receipt that carries only categorical
//! results. Pending revocation items follow the same ownership rules and are shared
//! with the synchronous coordinator in `revocation`.

use serde::Serialize;

use dopedb_protocol::{
    DirectLevel, DirectPrincipalState, DirectReceiptFrom, DirectReceiptRequest, DirectReceiptTo,
    DirectWorkAction, DirectWorkList, DirectWorkListItem,
};

use super::application::DirectAccessUseCases;
use super::domain::{
    AccessLevel, DirectEngine, FailureCode, Marker, PrincipalName, PrincipalState, Scope,
    ServerVersion,
};
use super::ownership::{
    check_creatable, prove_ownership, CreateDecision, ProvenOwnership, Receipt, ServerIdentity,
};
use super::plan::Planner;
use super::ports::{
    AdminCredentialVault, DirectControlPlanePort, DirectLocalPort, TargetDatabasePort,
    TargetSession,
};
use super::types::{AdminCredential, DirectScope};
use crate::error::AppResult;

pub(super) fn level_of(level: DirectLevel) -> AccessLevel {
    match level {
        DirectLevel::None => AccessLevel::None,
        DirectLevel::Read => AccessLevel::Read,
        DirectLevel::Write => AccessLevel::Write,
    }
}

pub(super) fn wire_level(level: AccessLevel) -> DirectLevel {
    match level {
        AccessLevel::None => DirectLevel::None,
        AccessLevel::Read => DirectLevel::Read,
        AccessLevel::Write => DirectLevel::Write,
    }
}

fn state_of(state: DirectPrincipalState) -> PrincipalState {
    match state {
        DirectPrincipalState::Requested => PrincipalState::Requested,
        DirectPrincipalState::Applying => PrincipalState::Applying,
        DirectPrincipalState::Ready => PrincipalState::Ready,
        DirectPrincipalState::Failed => PrincipalState::Failed,
        DirectPrincipalState::DropPending => PrincipalState::DropPending,
        DirectPrincipalState::Dropped => PrincipalState::Dropped,
    }
}

fn wire_failure(code: FailureCode) -> dopedb_protocol::DirectFailureCode {
    use dopedb_protocol::DirectFailureCode as W;
    match code {
        FailureCode::MarkerMismatch => W::MarkerMismatch,
        FailureCode::OidMismatch => W::OidMismatch,
        FailureCode::OwnsObjects => W::OwnsObjects,
        FailureCode::UnexpectedMembership => W::UnexpectedMembership,
        FailureCode::GrantorInsufficient => W::GrantorInsufficient,
        FailureCode::VersionUnsupported => W::VersionUnsupported,
        FailureCode::EndpointChanged => W::EndpointChanged,
        FailureCode::PermissionDenied => W::PermissionDenied,
        FailureCode::Network => W::Network,
        FailureCode::NameConflict => W::NameConflict,
        FailureCode::CredentialMissing => W::CredentialMissing,
    }
}

pub(super) fn identity_text(identity: &ServerIdentity) -> String {
    match identity {
        ServerIdentity::PostgresRoleOid(oid) => oid.to_string(),
        ServerIdentity::MysqlServerUuid(uuid) => uuid.clone(),
    }
}

fn parse_identity(
    engine: DirectEngine,
    value: Option<&str>,
) -> Result<Option<ServerIdentity>, FailureCode> {
    let Some(value) = value else { return Ok(None) };
    match engine {
        DirectEngine::Postgres => value
            .parse::<u32>()
            .map(|oid| Some(ServerIdentity::PostgresRoleOid(oid)))
            .map_err(|_| FailureCode::OidMismatch),
        DirectEngine::Mysql => Ok(Some(ServerIdentity::MysqlServerUuid(value.to_owned()))),
    }
}

/// Ownership receipt as the control plane recorded it.
pub(super) fn receipt_of(
    engine: DirectEngine,
    item: &DirectWorkListItem,
) -> Result<Receipt, FailureCode> {
    Ok(Receipt {
        state: state_of(item.state),
        name: PrincipalName::parse(&item.principal_name).ok_or(FailureCode::MarkerMismatch)?,
        marker: Marker::parse(&item.marker).ok_or(FailureCode::MarkerMismatch)?,
        identity: parse_identity(engine, item.server_role_oid.as_deref())?,
    })
}

/// A connected administrator session with everything one pass needs.
pub(super) struct Prepared<S> {
    pub(super) session: S,
    pub(super) planner: Planner,
    pub(super) work: DirectWorkList,
    pub(super) fingerprint: String,
    pub(super) device_id: String,
}

/// Why a pass could not start. Unreachable carries the categorical reason.
pub(super) enum PrepareError {
    Unreachable(FailureCode),
    App(crate::error::AppError),
}

impl From<crate::error::AppError> for PrepareError {
    fn from(error: crate::error::AppError) -> Self {
        Self::App(error)
    }
}

/// What a pass did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncReport {
    pub(crate) skipped: Option<SyncSkip>,
    pub(crate) failure_code: Option<FailureCode>,
    pub(crate) claimed: u32,
    pub(crate) applied: u32,
    pub(crate) failed: u32,
    pub(crate) revocations_applied: u32,
    pub(crate) revocations_pending: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SyncSkip {
    NoCredential,
    Busy,
    Unreachable,
}

/// Outcome of revoking one member's principal on the target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RevokeEffect {
    Dropped,
    Lowered(AccessLevel),
    /// The control plane's recorded level already satisfies the target.
    Unchanged,
}

impl<V, T, C, L> DirectAccessUseCases<V, T, C, L>
where
    V: AdminCredentialVault,
    T: TargetDatabasePort,
    C: DirectControlPlanePort,
    L: DirectLocalPort,
{
    /// Open the administrator session, read the work list, and verify the target is
    /// still the server the principals were created on.
    pub(super) async fn prepare(
        &self,
        scope: &DirectScope,
        credential: &AdminCredential,
    ) -> Result<Prepared<T::Session>, PrepareError> {
        let endpoint = self.endpoint_for(scope, credential).await?;
        let work = self.control.work(scope).await?;
        let device_id = self.local.device_id(scope).await?;
        let mut session = self
            .target
            .open(&endpoint, credential)
            .await
            .map_err(PrepareError::Unreachable)?;
        let checked = async {
            let version = ServerVersion::check(work.engine_direct(), &session.version().await?)?;
            let fingerprint = session.fingerprint().await?;
            if work
                .server_fingerprint
                .as_deref()
                .is_some_and(|expected| expected != fingerprint)
            {
                return Err(FailureCode::EndpointChanged);
            }
            let names = Scope::new(work.engine_direct(), work.scope.clone())
                .ok_or(FailureCode::PermissionDenied)?;
            let planner = Planner::new(work.engine_direct(), version, names)?;
            Ok((planner, fingerprint))
        }
        .await;
        match checked {
            Ok((planner, fingerprint)) => Ok(Prepared {
                session,
                planner,
                work,
                fingerprint,
                device_id,
            }),
            Err(code) => {
                session.close().await;
                Err(PrepareError::Unreachable(code))
            }
        }
    }

    /// Run one synchronization pass for a database whose administrator credential
    /// this device holds. `wait` blocks behind another administrator action;
    /// otherwise a busy device is skipped. `regrant` also refreshes PostgreSQL
    /// grants so tables created since the last pass become readable.
    pub(crate) async fn sync_once(
        &self,
        scope: &DirectScope,
        wait: bool,
        regrant: bool,
    ) -> AppResult<SyncReport> {
        let _guard = if wait {
            self.device_lock.lock().await
        } else {
            match self.device_lock.try_lock() {
                Ok(guard) => guard,
                Err(_) => {
                    return Ok(SyncReport {
                        skipped: Some(SyncSkip::Busy),
                        ..SyncReport::default()
                    })
                }
            }
        };
        let Some(credential) = self.vault.fetch(scope)? else {
            return Ok(SyncReport {
                skipped: Some(SyncSkip::NoCredential),
                ..SyncReport::default()
            });
        };
        let mut prepared = match self.prepare(scope, &credential).await {
            Ok(prepared) => prepared,
            Err(PrepareError::Unreachable(code)) => {
                return Ok(SyncReport {
                    skipped: Some(SyncSkip::Unreachable),
                    failure_code: Some(code),
                    ..SyncReport::default()
                })
            }
            Err(PrepareError::App(error)) => return Err(error),
        };
        let mut report = SyncReport::default();
        let outcome = self
            .run_pass(&mut prepared, scope, regrant, &mut report)
            .await;
        prepared.session.close().await;
        outcome?;
        Ok(report)
    }

    async fn run_pass(
        &self,
        prepared: &mut Prepared<T::Session>,
        scope: &DirectScope,
        regrant: bool,
        report: &mut SyncReport,
    ) -> AppResult<()> {
        let work = prepared.work.clone();
        let engine = work.engine_direct();
        // Pending revocation caps are already folded into `desiredLevel` by the
        // server, so applying and revoking never fight over the same principal.
        let applying: Vec<String> = work
            .items
            .iter()
            .filter(|item| item.action == DirectWorkAction::Apply)
            .map(|item| item.principal_id.clone())
            .collect();
        let dropping: Vec<String> = work
            .items
            .iter()
            .filter(|item| item.action == DirectWorkAction::Drop)
            .map(|item| item.principal_id.clone())
            .collect();
        let mut touched = Vec::new();
        if !applying.is_empty() {
            let claimed = self
                .control
                .claim(scope, &prepared.device_id, &applying)
                .await?;
            report.claimed += claimed.len() as u32;
            for item in claimed
                .iter()
                .filter(|item| item.action != DirectWorkAction::Drop)
            {
                touched.push(item.principal_id.clone());
                if self.apply_item(prepared, scope, item).await? {
                    report.applied += 1;
                } else {
                    report.failed += 1;
                }
            }
        }
        if !dropping.is_empty() {
            let claimed = self
                .control
                .claim(scope, &prepared.device_id, &dropping)
                .await?;
            report.claimed += claimed.len() as u32;
            for item in &claimed {
                touched.push(item.principal_id.clone());
                let result = self
                    .revoke_member(
                        &mut prepared.session,
                        &prepared.planner,
                        engine,
                        item,
                        AccessLevel::None,
                    )
                    .await;
                if self
                    .post_revoke_receipt(prepared, scope, item, DirectLevel::None, result)
                    .await?
                {
                    report.applied += 1;
                } else {
                    report.failed += 1;
                }
            }
        }
        let pending: Vec<_> = work
            .revocations
            .iter()
            .filter(|entry| {
                entry.state == dopedb_protocol::DirectRevocationState::Pending
                    && entry.connection_id == scope.connection_id.to_string()
            })
            .cloned()
            .collect();
        if !pending.is_empty() {
            let (applied, still_pending) = self
                .process_pending_revocations(prepared, scope, &pending)
                .await?;
            report.revocations_applied += applied;
            report.revocations_pending += still_pending;
        }
        if regrant && engine == DirectEngine::Postgres {
            for item in work.items.iter().filter(|item| {
                item.state == DirectPrincipalState::Ready
                    && item.applied_level != DirectLevel::None
                    && !touched.contains(&item.principal_id)
                    && !pending
                        .iter()
                        .any(|entry| entry.member_id == item.member_id)
            }) {
                // Re-grant is best effort: a principal that cannot be proven is
                // reported by the next real work item, never changed here.
                let _ = self.regrant_item(prepared, item).await;
            }
        }
        Ok(())
    }

    async fn regrant_item(
        &self,
        prepared: &mut Prepared<T::Session>,
        item: &DirectWorkListItem,
    ) -> Result<(), FailureCode> {
        let engine = prepared.work.engine_direct();
        let receipt = receipt_of(engine, item)?;
        let obs = prepared.session.observe(&receipt.name).await?;
        let proven = prove_ownership(&receipt, &obs)?;
        let plan = prepared
            .planner
            .regrant(proven.name(), level_of(item.applied_level));
        prepared.session.execute(&plan).await
    }

    /// Apply one claimed item and answer with its receipt. Returns whether the
    /// principal reached `ready`.
    async fn apply_item(
        &self,
        prepared: &mut Prepared<T::Session>,
        scope: &DirectScope,
        item: &DirectWorkListItem,
    ) -> AppResult<bool> {
        let desired = level_of(item.desired_level);
        let applying = self.try_apply(prepared, item, desired).await;
        let request = match &applying {
            Ok(proven) if desired != AccessLevel::None => DirectReceiptRequest {
                principal_id: item.principal_id.clone(),
                device_id: prepared.device_id.clone(),
                from: DirectReceiptFrom::Applying,
                to: DirectReceiptTo::Ready,
                applied_level: item.desired_level,
                applied_verifier_version: item.verifier_version,
                scope_revision_applied: Some(prepared.work.scope_revision),
                server_role_oid: Some(identity_text(proven.identity())),
                server_fingerprint: Some(prepared.fingerprint.clone()),
                failure_code: None,
            },
            Ok(_) => return Ok(false),
            Err(code) => DirectReceiptRequest {
                principal_id: item.principal_id.clone(),
                device_id: prepared.device_id.clone(),
                from: DirectReceiptFrom::Applying,
                to: DirectReceiptTo::Failed,
                applied_level: item.applied_level,
                applied_verifier_version: item.applied_verifier_version,
                scope_revision_applied: None,
                server_role_oid: item.server_role_oid.clone(),
                server_fingerprint: None,
                failure_code: Some(wire_failure(*code)),
            },
        };
        self.control.receipt(scope, &request).await?;
        Ok(applying.is_ok())
    }

    async fn try_apply(
        &self,
        prepared: &mut Prepared<T::Session>,
        item: &DirectWorkListItem,
        desired: AccessLevel,
    ) -> Result<ProvenOwnership, FailureCode> {
        if desired == AccessLevel::None {
            return Err(FailureCode::PermissionDenied);
        }
        let engine = prepared.work.engine_direct();
        let mut receipt = receipt_of(engine, item)?;
        let applied = level_of(item.applied_level);
        let observation = prepared.session.observe(&receipt.name).await?;
        if applied == AccessLevel::None {
            // New principal, or a previous attempt that died before its receipt.
            let plan = match check_creatable(&receipt, &observation)? {
                CreateDecision::Create => prepared.planner.create(
                    &receipt.name,
                    &receipt.marker,
                    &item.verifier,
                    desired,
                )?,
                CreateDecision::ResumeOwned(proven) => {
                    let mut plan = prepared
                        .planner
                        .alter_verifier(proven.name(), &item.verifier)?;
                    plan.push(prepared.planner.unlock(proven.name()));
                    plan.extend(prepared.planner.regrant(proven.name(), desired));
                    plan
                }
            };
            prepared.session.execute(&plan).await?;
            let fresh = prepared.session.observe(&receipt.name).await?;
            receipt.state = PrincipalState::Applying;
            receipt.identity = None;
            return prove_ownership(&receipt, &fresh);
        }
        let proven = prove_ownership(&receipt, &observation)?;
        let mut plan = Vec::new();
        if item.verifier_version > item.applied_verifier_version {
            plan.extend(
                prepared
                    .planner
                    .alter_verifier(proven.name(), &item.verifier)?,
            );
        }
        if applied != desired {
            plan.extend(
                prepared
                    .planner
                    .change_level(proven.name(), applied, desired),
            );
        } else {
            plan.extend(prepared.planner.regrant(proven.name(), desired));
        }
        prepared.session.execute(&plan).await?;
        if super::domain::lowers_access(applied, desired) {
            // Best effort: privileges are checked per statement, so a session that
            // outlives the revoke cannot use what was removed.
            let _ = prepared
                .session
                .terminate_sessions(&prepared.planner, proven.name())
                .await;
        }
        Ok(proven)
    }

    /// Lower `item`'s principal to `target`, dropping it when `target` is none. The
    /// ownership proof comes first; a principal that is already gone has nothing to
    /// revoke.
    pub(super) async fn revoke_member(
        &self,
        session: &mut T::Session,
        planner: &Planner,
        engine: DirectEngine,
        item: &DirectWorkListItem,
        target: AccessLevel,
    ) -> Result<RevokeEffect, FailureCode> {
        let applied = level_of(item.applied_level);
        if matches!(
            item.state,
            DirectPrincipalState::Requested | DirectPrincipalState::Dropped
        ) || (target != AccessLevel::None && applied <= target)
        {
            return Ok(RevokeEffect::Unchanged);
        }
        let receipt = receipt_of(engine, item)?;
        let observation = session.observe(&receipt.name).await?;
        if !observation.name_exists {
            return if target == AccessLevel::None {
                Ok(RevokeEffect::Dropped)
            } else {
                Err(FailureCode::MarkerMismatch)
            };
        }
        let proven = prove_ownership(&receipt, &observation)?;
        if target == AccessLevel::None {
            // Lock first so no new session starts while the old ones are ended;
            // when the lock or the termination is not permitted the REVOKE and
            // DROP below still remove every privilege.
            let _ = session.execute(&[planner.lock(proven.name())]).await;
            let _ = session.terminate_sessions(planner, proven.name()).await;
            session
                .execute(&planner.drop_principal(proven.name(), applied))
                .await?;
            Ok(RevokeEffect::Dropped)
        } else {
            session
                .execute(&planner.change_level(proven.name(), applied, target))
                .await?;
            let _ = session.terminate_sessions(planner, proven.name()).await;
            Ok(RevokeEffect::Lowered(target))
        }
    }

    /// Answer a revocation with the receipt the server's guard reads. Returns
    /// whether it succeeded.
    pub(super) async fn post_revoke_receipt(
        &self,
        prepared: &Prepared<T::Session>,
        scope: &DirectScope,
        item: &DirectWorkListItem,
        target: DirectLevel,
        result: Result<RevokeEffect, FailureCode>,
    ) -> AppResult<bool> {
        let dropping = target == DirectLevel::None;
        let request = match result {
            Ok(RevokeEffect::Unchanged) => return Ok(true),
            Ok(RevokeEffect::Dropped) => DirectReceiptRequest {
                principal_id: item.principal_id.clone(),
                device_id: prepared.device_id.clone(),
                from: DirectReceiptFrom::DropPending,
                to: DirectReceiptTo::Dropped,
                applied_level: DirectLevel::None,
                applied_verifier_version: item.applied_verifier_version,
                scope_revision_applied: None,
                server_role_oid: None,
                server_fingerprint: None,
                failure_code: None,
            },
            Ok(RevokeEffect::Lowered(level)) => DirectReceiptRequest {
                principal_id: item.principal_id.clone(),
                device_id: prepared.device_id.clone(),
                from: DirectReceiptFrom::Applying,
                to: DirectReceiptTo::Ready,
                applied_level: wire_level(level),
                applied_verifier_version: item.applied_verifier_version,
                scope_revision_applied: Some(prepared.work.scope_revision),
                server_role_oid: item.server_role_oid.clone(),
                server_fingerprint: Some(prepared.fingerprint.clone()),
                failure_code: None,
            },
            Err(code) => DirectReceiptRequest {
                principal_id: item.principal_id.clone(),
                device_id: prepared.device_id.clone(),
                from: if dropping {
                    DirectReceiptFrom::DropPending
                } else {
                    DirectReceiptFrom::Applying
                },
                to: DirectReceiptTo::Failed,
                applied_level: item.applied_level,
                applied_verifier_version: item.applied_verifier_version,
                scope_revision_applied: None,
                server_role_oid: item.server_role_oid.clone(),
                server_fingerprint: None,
                failure_code: Some(wire_failure(code)),
            },
        };
        let succeeded = request.failure_code.is_none();
        self.control.receipt(scope, &request).await?;
        Ok(succeeded)
    }
}

/// `DirectWorkList` carries the protocol engine; the rules use their own.
pub(super) trait WorkListEngine {
    fn engine_direct(&self) -> DirectEngine;
}

impl WorkListEngine for DirectWorkList {
    fn engine_direct(&self) -> DirectEngine {
        match self.engine {
            dopedb_protocol::DirectEngine::Postgres => DirectEngine::Postgres,
            dopedb_protocol::DirectEngine::Mysql => DirectEngine::Mysql,
        }
    }
}
