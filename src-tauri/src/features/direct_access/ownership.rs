//! Ownership proof for direct shared database principals.
//!
//! Before any ALTER, REVOKE, or DROP the worker must prove the principal on the
//! server is exactly the one this workspace created. A name prefix is never
//! evidence. The proof combines the stored receipt (state, name, marker, server
//! identity) with facts the adapter observed on the server; every shortfall maps to
//! one categorical [`FailureCode`] and the caller must then touch nothing.

use super::domain::{FailureCode, Marker, PrincipalName, PrincipalState};

/// Server identity that pins a receipt to one server: the PostgreSQL role oid or
/// the MySQL `@@server_uuid`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ServerIdentity {
    PostgresRoleOid(u32),
    MysqlServerUuid(String),
}

/// What the control-plane receipt says about the principal.
#[derive(Debug, Clone)]
pub(crate) struct Receipt {
    pub(crate) state: PrincipalState,
    pub(crate) name: PrincipalName,
    pub(crate) marker: Marker,
    /// Recorded on first successful apply; `None` before.
    pub(crate) identity: Option<ServerIdentity>,
}

/// What the adapter observed for the principal name on the server.
#[derive(Debug, Clone)]
pub(crate) struct ObservedPrincipal {
    pub(crate) name_exists: bool,
    /// Parsed marker, `None` when the object carries no DopeDB marker.
    pub(crate) marker: Option<Marker>,
    pub(crate) identity: Option<ServerIdentity>,
    /// PostgreSQL `pg_shdepend` owned objects (0 for MySQL).
    pub(crate) owned_objects: u64,
    /// Role memberships other than those DopeDB itself created (none are created).
    pub(crate) unexpected_memberships: u32,
}

/// Proof token: only [`prove_ownership`] constructs it, and destructive plans take it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProvenOwnership {
    name: PrincipalName,
    identity: ServerIdentity,
}

impl ProvenOwnership {
    pub(crate) fn name(&self) -> &PrincipalName {
        &self.name
    }

    pub(crate) fn identity(&self) -> &ServerIdentity {
        &self.identity
    }
}

/// Decision for the create path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CreateDecision {
    /// The name is free; create it.
    Create,
    /// A previous attempt already created our marked principal; continue with it.
    ResumeOwned(ProvenOwnership),
}

/// Prove ownership for ALTER/REVOKE/DROP. The receipt must be in a state where a
/// server object may legitimately exist, the object must exist with our exact
/// marker and server identity, and must own nothing and hold no foreign membership.
pub(crate) fn prove_ownership(
    receipt: &Receipt,
    observed: &ObservedPrincipal,
) -> Result<ProvenOwnership, FailureCode> {
    if !matches!(
        receipt.state,
        PrincipalState::Applying
            | PrincipalState::Ready
            | PrincipalState::Failed
            | PrincipalState::DropPending
    ) || !observed.name_exists
    {
        // Nothing provable: no receipt that permits an object, or no object.
        return Err(FailureCode::MarkerMismatch);
    }
    match &observed.marker {
        None => return Err(FailureCode::NameConflict),
        Some(found) if found != &receipt.marker => return Err(FailureCode::MarkerMismatch),
        Some(_) => {}
    }
    let identity = match (&receipt.identity, &observed.identity) {
        (Some(expected), Some(found)) if expected == found => found.clone(),
        // First apply: the identity is learned from the marked object itself.
        (None, Some(found)) if receipt.state == PrincipalState::Applying => found.clone(),
        _ => return Err(FailureCode::OidMismatch),
    };
    if observed.owned_objects > 0 {
        return Err(FailureCode::OwnsObjects);
    }
    if observed.unexpected_memberships > 0 {
        return Err(FailureCode::UnexpectedMembership);
    }
    Ok(ProvenOwnership {
        name: receipt.name.clone(),
        identity,
    })
}

/// Decide whether the create path may proceed. A name that exists without our exact
/// marker is a conflict and nothing is touched.
pub(crate) fn check_creatable(
    receipt: &Receipt,
    observed: &ObservedPrincipal,
) -> Result<CreateDecision, FailureCode> {
    if !matches!(
        receipt.state,
        PrincipalState::Requested | PrincipalState::Applying | PrincipalState::Failed
    ) {
        return Err(FailureCode::MarkerMismatch);
    }
    if !observed.name_exists {
        return Ok(CreateDecision::Create);
    }
    if observed.marker.as_ref() != Some(&receipt.marker) {
        return Err(FailureCode::NameConflict);
    }
    let mut resumable = receipt.clone();
    resumable.state = PrincipalState::Applying;
    prove_ownership(&resumable, observed).map(CreateDecision::ResumeOwned)
}
