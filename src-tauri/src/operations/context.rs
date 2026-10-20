//! Scope-derived operation policy and actor context.
//!
//! These functions belong to the Operation boundary rather than any individual
//! application service. They derive immutable policy/identity values from one
//! authority pin and never perform I/O.

use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::kernel::access::{AccountScope, PinnedConnection};
use crate::kernel::environment::EnvironmentKind;
use crate::model::SafetySettings;

use super::{
    canonical_hash, OperationActor, OperationActorKind, OperationActorProvenance,
    OperationApprover, OperationRecord, OperationRiskLevel,
};

pub(crate) const CRITICAL_CONFIRMATION: &str = "RUN CRITICAL";
pub(crate) const PRODUCTION_CONFIRMATION: &str = "PROD";

pub(crate) struct CapturedOperationPolicy {
    pub(crate) snapshot: Value,
    pub(crate) revision: String,
}

/// Derive the additional human confirmation from immutable risk and policy data.
/// Rejection never needs this phrase; approval does.
pub(crate) fn required_confirmation(record: &OperationRecord) -> Option<&'static str> {
    if !record.kind.may_mutate_target() {
        return None;
    }
    if record.risk_level == OperationRiskLevel::Critical {
        return Some(CRITICAL_CONFIRMATION);
    }
    policy_requires_production_confirmation(&record.policy_snapshot)
        .then_some(PRODUCTION_CONFIRMATION)
}

/// Whether a captured policy snapshot names a production effective environment. The
/// snapshot carries the connection's effective environment (the most sensitive Project
/// environment it is bound to, else its own label), never the bare connection label.
pub(crate) fn policy_requires_production_confirmation(policy_snapshot: &Value) -> bool {
    policy_snapshot
        .get("environment")
        .and_then(Value::as_str)
        .and_then(EnvironmentKind::parse)
        == Some(EnvironmentKind::Production)
}

pub(crate) fn capture_policy(
    pin: &PinnedConnection,
    settings: &SafetySettings,
) -> AppResult<CapturedOperationPolicy> {
    let snapshot = json!({
        "accountScope": pin.scope.account_scope.storage_key(),
        "bindingRevision": pin.binding_revision,
        "bindingUpdatedAt": pin.binding_updated_at,
        "connectionRevision": pin.connection_revision,
        "credentialMode": pin.profile.credential_mode,
        "environment": pin.profile.effective_env,
        "safety": settings,
        "scopeGeneration": pin.scope.generation,
        "workspaceAccess": pin.profile.workspace_access,
        "workspaceId": pin.scope.workspace_id,
    });
    let revision = canonical_hash(&snapshot)?;
    Ok(CapturedOperationPolicy { snapshot, revision })
}

pub(crate) fn actor_for_pin(pin: &PinnedConnection, origin_surface: String) -> OperationActor {
    let (kind, id, local_account_id, workspace_account_id) = match &pin.scope.account_scope {
        AccountScope::Personal => (
            OperationActorKind::LocalUser,
            "local-user".to_string(),
            Some("local-user".to_string()),
            None,
        ),
        AccountScope::WorkspaceUser(id) => (
            OperationActorKind::WorkspaceUser,
            id.clone(),
            None,
            Some(id.clone()),
        ),
    };
    OperationActor {
        kind,
        id,
        provenance: OperationActorProvenance {
            local_account_id,
            workspace_account_id,
            origin_surface,
            ..OperationActorProvenance::default()
        },
    }
}

pub(crate) fn agent_actor_for_pin(
    pin: &PinnedConnection,
    actor_id: String,
    origin_surface: String,
) -> OperationActor {
    let (local_account_id, workspace_account_id) = match &pin.scope.account_scope {
        AccountScope::Personal => (Some("local-user".into()), None),
        AccountScope::WorkspaceUser(id) => (None, Some(id.clone())),
    };
    OperationActor {
        kind: OperationActorKind::Agent,
        id: actor_id,
        provenance: OperationActorProvenance {
            local_account_id,
            workspace_account_id,
            origin_surface,
            ..OperationActorProvenance::default()
        },
    }
}

pub(crate) fn approver_for_pin(pin: &PinnedConnection) -> OperationApprover {
    match &pin.scope.account_scope {
        AccountScope::Personal => OperationApprover {
            kind: OperationActorKind::LocalUser,
            id: "local-user".into(),
        },
        AccountScope::WorkspaceUser(id) => OperationApprover {
            kind: OperationActorKind::WorkspaceUser,
            id: id.clone(),
        },
    }
}

pub(crate) fn ensure_operation_scope(
    record: &OperationRecord,
    pin: &PinnedConnection,
) -> AppResult<()> {
    let matches = record.workspace_id == pin.scope.workspace_id
        && record.account_scope == pin.scope.account_scope.storage_key()
        && record.connection_id == pin.connection_id
        && record.connection_revision == pin.connection_revision;
    if matches {
        Ok(())
    } else {
        Err(AppError::Blocked {
            reason: "operation scope or connection revision changed after the proposal was created"
                .into(),
        })
    }
}
