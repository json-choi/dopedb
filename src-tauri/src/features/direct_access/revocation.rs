//! Revocation protocol: lower access on the database before the control plane
//! commits the change.
//!
//! The coordinator records revocation items, then (when this device holds the
//! administrator credential) revokes or drops each affected principal with an
//! ownership proof and ends its sessions, posts receipts, and only then performs the
//! queued control-plane mutation. Without a credential nothing proceeds: the items
//! stay pending and the result names the databases that are blocked. The same
//! per-principal routine serves deferred items on an administrator device's next poll.
//! Team read-off and shared-database deletion are all-or-nothing: the mutation runs
//! only when every affected principal was revoked.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use dopedb_protocol::{
    DirectFailureCode, DirectLevel, DirectRevocationEntry, DirectRevocationKind,
    DirectRevocationState,
};

use super::application::{require_signed_in, DirectAccessUseCases};
use super::domain::FailureCode;
use super::ports::{
    AdminCredentialVault, DirectControlPlanePort, DirectLocalPort, MutationOutcome,
    RevocationSettle, TargetDatabasePort, TargetSession,
};
use super::sync::{level_of, PrepareError, Prepared, RevokeEffect, WorkListEngine};
use super::types::{AdminCredential, DirectScope, Secret};
use crate::error::{AppError, AppResult};
use crate::kernel::identity::{AccountId, ConnectionId, WorkspaceId};

const MAX_TARGETS: usize = 64;
const MAX_MEMBERS_PER_TARGET: usize = 1_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RevocationTarget {
    pub(crate) connection_id: ConnectionId,
    /// `none` or `read` for this database; never `write`. One connection may appear in
    /// several targets, one per level.
    pub(crate) target_level: DirectLevel,
    pub(crate) member_ids: Vec<String>,
}

/// A credential typed for this action only; saved to the keychain on request once
/// it has proven it can reach the database.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InlineCredential {
    pub(crate) connection_id: ConnectionId,
    pub(crate) username: String,
    pub(crate) password: Secret,
    pub(crate) ssh_alias: Option<String>,
    #[serde(default)]
    pub(crate) save_to_keychain: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RevokeApplyRequest {
    pub(crate) account_id: AccountId,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) kind: DirectRevocationKind,
    pub(crate) targets: Vec<RevocationTarget>,
    /// The access-lowering change, as one closed workspace-administration operation.
    pub(crate) mutation: Value,
    #[serde(default)]
    pub(crate) credentials: Vec<InlineCredential>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevocationRef {
    pub(crate) revocation_id: String,
    pub(crate) connection_id: String,
    pub(crate) member_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevocationFailure {
    pub(crate) connection_id: String,
    pub(crate) member_id: String,
    pub(crate) failure_code: DirectFailureCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MutationState {
    NotAttempted,
    Done,
    RevocationRequired,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevocationOutcome {
    pub(crate) applied: Vec<RevocationRef>,
    pub(crate) pending: Vec<RevocationRef>,
    pub(crate) blocked_no_credential: Vec<String>,
    pub(crate) failed: Vec<RevocationFailure>,
    /// A revoked account's already-open sessions may persist (the administrator
    /// account cannot end sessions), keeping at most PUBLIC rights (PostgreSQL) or the
    /// privileges they had at login (MySQL) until they disconnect.
    pub(crate) open_sessions_may_persist: bool,
    pub(crate) mutation: MutationState,
}

fn reference(entry: &DirectRevocationEntry) -> RevocationRef {
    RevocationRef {
        revocation_id: entry.id.clone(),
        connection_id: entry.connection_id.clone(),
        member_id: entry.member_id.clone(),
    }
}

fn wire_code(code: FailureCode) -> DirectFailureCode {
    match code {
        FailureCode::MarkerMismatch => DirectFailureCode::MarkerMismatch,
        FailureCode::OidMismatch => DirectFailureCode::OidMismatch,
        FailureCode::OwnsObjects => DirectFailureCode::OwnsObjects,
        FailureCode::UnexpectedMembership => DirectFailureCode::UnexpectedMembership,
        FailureCode::GrantorInsufficient => DirectFailureCode::GrantorInsufficient,
        FailureCode::VersionUnsupported => DirectFailureCode::VersionUnsupported,
        FailureCode::EndpointChanged => DirectFailureCode::EndpointChanged,
        FailureCode::PermissionDenied => DirectFailureCode::PermissionDenied,
        FailureCode::Network => DirectFailureCode::Network,
        FailureCode::NameConflict => DirectFailureCode::NameConflict,
        FailureCode::CredentialMissing => DirectFailureCode::CredentialMissing,
    }
}

/// Per-entry result of the database step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EntryResult {
    Revoked,
    /// Another administrator device holds the lease; this entry stays pending.
    NotClaimed,
    Failed(FailureCode),
}

impl<V, T, C, L> DirectAccessUseCases<V, T, C, L>
where
    V: AdminCredentialVault,
    T: TargetDatabasePort,
    C: DirectControlPlanePort,
    L: DirectLocalPort,
{
    /// Revocation steps 1 and 2 of the protocol, synchronously.
    pub(crate) async fn revoke_apply(
        &self,
        signed_in: &[AccountId],
        request: RevokeApplyRequest,
    ) -> AppResult<RevocationOutcome> {
        require_signed_in(signed_in, &request.account_id)?;
        if request.targets.is_empty()
            || request.targets.len() > MAX_TARGETS
            || request.targets.iter().any(|target| {
                target.target_level == DirectLevel::Write
                    || target.member_ids.is_empty()
                    || target.member_ids.len() > MAX_MEMBERS_PER_TARGET
            })
            || request.mutation.get("workspaceId").and_then(Value::as_str)
                != Some(request.workspace_id.to_string().as_str())
        {
            return Err(AppError::Config("the revocation request is invalid".into()));
        }
        // The mutation must belong to the closed administration catalog.
        crate::features::workspace_admin::domain::validate_operation(&request.mutation)?;
        let _guard = self.device_lock.lock().await;

        // Step 1: record the intent, one item per (connection, level, member). A failure
        // undoes the items created so far. Targets of one connection share one database
        // session in step 2, each entry revoked to its own level.
        let mut entries: Vec<(DirectScope, Vec<DirectRevocationEntry>)> = Vec::new();
        for target in &request.targets {
            let scope = DirectScope {
                account_id: request.account_id.clone(),
                workspace_id: request.workspace_id,
                connection_id: target.connection_id,
            };
            match self
                .control
                .create_revocations(
                    &scope,
                    request.kind,
                    &target.member_ids,
                    target.target_level,
                )
                .await
            {
                Ok(created) => {
                    match entries
                        .iter_mut()
                        .find(|(known, _)| known.connection_id == scope.connection_id)
                    {
                        Some((_, existing)) => existing.extend(created),
                        None => entries.push((scope, created)),
                    }
                }
                Err(error) => {
                    for (_, created) in &entries {
                        for entry in created {
                            let _ = self
                                .control
                                .settle_revocation(
                                    &request.account_id,
                                    request.workspace_id,
                                    &entry.id,
                                    RevocationSettle::Cancelled,
                                )
                                .await;
                        }
                    }
                    return Err(error);
                }
            }
        }

        // Step 2: the database side, per connection.
        let mut blocked = Vec::new();
        let mut failed = Vec::new();
        let mut unfinished = false;
        let mut open_sessions = false;
        for (scope, created) in &entries {
            let inline = request
                .credentials
                .iter()
                .find(|credential| credential.connection_id == scope.connection_id);
            let (credential, save) = match inline {
                Some(inline) => (
                    AdminCredential::new(
                        inline.username.clone(),
                        Secret::new(inline.password.as_str().to_owned()),
                        inline.ssh_alias.clone(),
                    )?,
                    inline.save_to_keychain,
                ),
                None => match self.vault.fetch(scope)? {
                    Some(credential) => (credential, false),
                    None => {
                        blocked.push(scope.connection_id.to_string());
                        unfinished = true;
                        continue;
                    }
                },
            };
            let mut prepared = match self.prepare(scope, &credential).await {
                Ok(prepared) => prepared,
                Err(PrepareError::Unreachable(code)) => {
                    failed.extend(created.iter().map(|entry| RevocationFailure {
                        connection_id: entry.connection_id.clone(),
                        member_id: entry.member_id.clone(),
                        failure_code: wire_code(code),
                    }));
                    unfinished = true;
                    continue;
                }
                Err(PrepareError::App(error)) => return Err(error),
            };
            if save && self.vault.store(scope, &credential).is_err() {
                tracing::warn!("administrator credential was not saved to the keychain");
            }
            let revoked = self.revoke_entries(&mut prepared, scope, created).await;
            prepared.session.close().await;
            let (results, persist) = revoked?;
            open_sessions |= persist;
            for (entry, result) in created.iter().zip(results) {
                match result {
                    EntryResult::Revoked => {}
                    EntryResult::NotClaimed => unfinished = true,
                    EntryResult::Failed(code) => {
                        unfinished = true;
                        failed.push(RevocationFailure {
                            connection_id: entry.connection_id.clone(),
                            member_id: entry.member_id.clone(),
                            failure_code: wire_code(code),
                        });
                    }
                }
            }
        }
        let all: Vec<&DirectRevocationEntry> = entries.iter().flat_map(|(_, c)| c.iter()).collect();

        // All-or-nothing: the control-plane change commits only after every
        // affected principal was revoked.
        if unfinished {
            return Ok(RevocationOutcome {
                applied: Vec::new(),
                pending: all.iter().map(|entry| reference(entry)).collect(),
                blocked_no_credential: blocked,
                failed,
                open_sessions_may_persist: open_sessions,
                mutation: MutationState::NotAttempted,
            });
        }
        let mutation = match self
            .control
            .mutate(&request.account_id, request.mutation)
            .await?
        {
            MutationOutcome::Done => MutationState::Done,
            MutationOutcome::RevocationRequired => MutationState::RevocationRequired,
            MutationOutcome::Rejected(_) => MutationState::Rejected,
        };
        let mut applied = Vec::new();
        let mut pending = Vec::new();
        for entry in all {
            // Deleting the shared database settles its own items on the server.
            let settled = mutation == MutationState::Done
                && (request.kind == DirectRevocationKind::DbDeleted
                    || self
                        .control
                        .settle_revocation(
                            &request.account_id,
                            request.workspace_id,
                            &entry.id,
                            RevocationSettle::Applied,
                        )
                        .await
                        .is_ok());
            if settled {
                applied.push(reference(entry));
            } else {
                pending.push(reference(entry));
            }
        }
        Ok(RevocationOutcome {
            applied,
            pending,
            blocked_no_credential: blocked,
            failed,
            open_sessions_may_persist: open_sessions,
            mutation,
        })
    }

    /// Cancel a pending item; the server lifts its cap.
    pub(crate) async fn cancel_revocation(
        &self,
        signed_in: &[AccountId],
        account_id: &AccountId,
        workspace_id: WorkspaceId,
        revocation_id: Uuid,
    ) -> AppResult<()> {
        require_signed_in(signed_in, account_id)?;
        self.control
            .settle_revocation(
                account_id,
                workspace_id,
                &revocation_id.to_string(),
                RevocationSettle::Cancelled,
            )
            .await
    }

    pub(crate) async fn list_revocations(
        &self,
        signed_in: &[AccountId],
        account_id: &AccountId,
        workspace_id: WorkspaceId,
    ) -> AppResult<Vec<DirectRevocationEntry>> {
        require_signed_in(signed_in, account_id)?;
        self.control
            .list_revocations(account_id, workspace_id)
            .await
    }

    /// Claim and revoke the principals of `entries`, one result per entry.
    pub(super) async fn revoke_entries(
        &self,
        prepared: &mut Prepared<T::Session>,
        scope: &DirectScope,
        entries: &[DirectRevocationEntry],
    ) -> AppResult<(Vec<EntryResult>, bool)> {
        let engine = prepared.work.engine_direct();
        let work = prepared.work.clone();
        let mut ids = Vec::new();
        for entry in entries {
            if let Some(item) = work
                .items
                .iter()
                .find(|item| item.member_id == entry.member_id)
            {
                ids.push(item.principal_id.clone());
            }
        }
        let claimed = if ids.is_empty() {
            Vec::new()
        } else {
            self.control.claim(scope, &prepared.device_id, &ids).await?
        };
        let mut results = Vec::with_capacity(entries.len());
        let mut open_sessions = false;
        for entry in entries {
            let Some(item) = work
                .items
                .iter()
                .find(|item| item.member_id == entry.member_id)
            else {
                // No principal was ever requested: nothing to revoke.
                results.push(EntryResult::Revoked);
                continue;
            };
            let Some(claimed_item) = claimed.iter().find(|c| c.principal_id == item.principal_id)
            else {
                results.push(EntryResult::NotClaimed);
                continue;
            };
            let target = level_of(entry.target_level);
            let outcome = self
                .revoke_member(
                    &mut prepared.session,
                    &prepared.planner,
                    engine,
                    claimed_item,
                    target,
                )
                .await;
            let posted = self
                .post_revoke_receipt(prepared, scope, claimed_item, entry.target_level, outcome)
                .await?;
            open_sessions |= posted && outcome.is_ok_and(RevokeEffect::open_sessions);
            results.push(match (posted, outcome) {
                (true, _) => EntryResult::Revoked,
                (false, Err(code)) => EntryResult::Failed(code),
                (false, Ok(_)) => EntryResult::Failed(FailureCode::Network),
            });
        }
        Ok((results, open_sessions))
    }

    /// Deferred items on an administrator device: revoke on the database, then
    /// perform the queued change the administrator recorded and settle. Returns
    /// `(settled, still_pending)`.
    pub(super) async fn process_pending_revocations(
        &self,
        prepared: &mut Prepared<T::Session>,
        scope: &DirectScope,
        entries: &[DirectRevocationEntry],
    ) -> AppResult<(u32, u32)> {
        let (results, _) = self.revoke_entries(prepared, scope, entries).await?;
        // Group all-or-nothing kinds so their single change waits for every entry.
        let mut groups: BTreeMap<(String, &'static str), Vec<usize>> = BTreeMap::new();
        for (index, entry) in entries.iter().enumerate() {
            let key = match entry.kind {
                DirectRevocationKind::TeamReadOff => "team_read_off",
                DirectRevocationKind::DbDeleted => "db_deleted",
                _ => continue,
            };
            groups
                .entry((entry.connection_id.clone(), key))
                .or_default()
                .push(index);
        }
        let mut settled = 0;
        let mut pending = 0;
        for (index, entry) in entries.iter().enumerate() {
            let revoked = results[index] == EntryResult::Revoked;
            let group_ready = groups
                .iter()
                .find(|(_, members)| members.contains(&index))
                .is_none_or(|(_, members)| {
                    members.iter().all(|i| results[*i] == EntryResult::Revoked)
                });
            let done = revoked
                && group_ready
                && self
                    .perform_queued_change(scope, entry)
                    .await
                    .unwrap_or(false);
            if done
                && self
                    .control
                    .settle_revocation(
                        &scope.account_id,
                        scope.workspace_id,
                        &entry.id,
                        RevocationSettle::Applied,
                    )
                    .await
                    .is_ok()
            {
                settled += 1;
            } else {
                pending += 1;
            }
        }
        Ok((settled, pending))
    }

    /// The control-plane change an administrator queued with this item. Kinds whose
    /// parameters the item does not carry (a lowered role's target, a deletion's
    /// content revision) are completed from the administrator's screen, which the
    /// server guard now admits; they stay pending here.
    async fn perform_queued_change(
        &self,
        scope: &DirectScope,
        entry: &DirectRevocationEntry,
    ) -> AppResult<bool> {
        if entry.state != DirectRevocationState::Pending {
            return Ok(false);
        }
        let member = Uuid::parse_str(&entry.member_id).ok();
        let operation = match (entry.kind, member) {
            (DirectRevocationKind::SelfLeave | DirectRevocationKind::AccountDeleted, _) => {
                return Ok(true)
            }
            (DirectRevocationKind::MemberRemoved, Some(member_id)) => json!({
                "kind": "removeMember",
                "workspaceId": scope.workspace_id,
                "memberId": member_id,
            }),
            (DirectRevocationKind::GrantLowered, Some(member_id)) => {
                if entry.target_level == DirectLevel::None {
                    json!({
                        "kind": "removeConnectionAccess",
                        "workspaceId": scope.workspace_id,
                        "connectionId": scope.connection_id,
                        "memberId": member_id,
                    })
                } else {
                    json!({
                        "kind": "lowerConnectionAccess",
                        "workspaceId": scope.workspace_id,
                        "connectionId": scope.connection_id,
                        "memberId": member_id,
                        "capability": "read",
                    })
                }
            }
            (DirectRevocationKind::TeamReadOff, _) => json!({
                "kind": "setTeamReadAccess",
                "workspaceId": scope.workspace_id,
                "connectionId": scope.connection_id,
                "enabled": false,
            }),
            _ => return Ok(false),
        };
        Ok(self.control.mutate(&scope.account_id, operation).await? == MutationOutcome::Done)
    }
}
