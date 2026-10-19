//! Wire contracts for direct shared databases between Workspace Cloud and Desktop.
//!
//! Members upload only a public verifier; an administrator device reads a work list and
//! answers with receipts. Nothing here carries a password, an administrator credential or
//! a database username other than the server-generated principal name. Every struct
//! rejects unknown fields so a secret-bearing key can never be accepted silently.

use serde::{Deserialize, Serialize};

use crate::control_plane::{valid_rfc3339_instant, valid_uuid_text};

const SAFE_INTEGER_MAX: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectPrincipalState {
    Requested,
    Applying,
    Ready,
    Failed,
    DropPending,
    Dropped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectProvisioningState {
    NotRequested,
    Requested,
    Applying,
    Ready,
    Failed,
    DropPending,
    Dropped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectLevel {
    None,
    Read,
    Write,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectFailureCode {
    MarkerMismatch,
    OidMismatch,
    OwnsObjects,
    UnexpectedMembership,
    GrantorInsufficient,
    VersionUnsupported,
    EndpointChanged,
    PermissionDenied,
    Network,
    NameConflict,
    CredentialMissing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectRevocationKind {
    MemberRemoved,
    GrantLowered,
    RoleLowered,
    TeamReadOff,
    DbDeleted,
    SelfLeave,
    AccountDeleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectEngine {
    Postgres,
    Mysql,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DirectVerifierKind {
    #[serde(rename = "scram-sha-256")]
    ScramSha256,
    #[serde(rename = "caching_sha2")]
    CachingSha2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectWorkAction {
    Apply,
    Drop,
    Idle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectRevocationState {
    Pending,
    Applied,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectReceiptFrom {
    Applying,
    DropPending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectReceiptTo {
    Ready,
    Failed,
    Dropped,
}

/// Caller's own principal status on a connection response (`provisioning`, additive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectProvisioningStatus {
    pub state: DirectProvisioningState,
    pub level: DirectLevel,
    pub principal_name: Option<String>,
    pub last_synced_at: Option<String>,
    pub failure_code: Option<DirectFailureCode>,
}

impl DirectProvisioningStatus {
    pub fn validate(&self) -> bool {
        use DirectProvisioningState as S;
        self.principal_name.as_deref().is_none_or(valid_principal_name)
            && self.last_synced_at.as_deref().is_none_or(valid_rfc3339_instant)
            && (self.state == S::NotRequested) == self.principal_name.is_none()
            && (self.state == S::Failed) == self.failure_code.is_some()
            && (!matches!(self.state, S::NotRequested | S::Dropped) || self.level == DirectLevel::None)
            && (self.state != S::Ready || self.level != DirectLevel::None)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceMemberGrants {
    pub workspace_id: String,
    pub members: Vec<WorkspaceMemberGrantsMember>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceMemberGrantsMember {
    pub member_id: String,
    pub role: String,
    pub revocation_pending: bool,
    pub grants: Vec<WorkspaceMemberGrantEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceMemberGrantEntry {
    pub connection_id: String,
    pub capability: String,
    pub origin: String,
    pub effective_access_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provisioning: Option<DirectProvisioningStatus>,
}

impl WorkspaceMemberGrants {
    pub fn validate(&self) -> bool {
        valid_uuid_text(&self.workspace_id)
            && self.members.len() <= 1_000
            && self.members.iter().all(|member| {
                !member.member_id.is_empty()
                    && member.member_id.len() <= 128
                    && matches!(
                        member.role.as_str(),
                        "viewer" | "analyst" | "editor" | "admin" | "owner"
                    )
                    && member.grants.len() <= 1_000
                    && member.grants.iter().all(|grant| {
                        valid_uuid_text(&grant.connection_id)
                            && matches!(grant.capability.as_str(), "view" | "read" | "use" | "manage")
                            && match grant.origin.as_str() {
                                "explicit" => true,
                                "team" => matches!(grant.capability.as_str(), "view" | "read"),
                                _ => false,
                            }
                            && matches!(
                                grant.effective_access_mode.as_str(),
                                "view" | "read" | "write" | "manage"
                            )
                            && grant.provisioning.as_ref().is_none_or(|status| status.validate())
                    })
            })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectVerifierRequest {
    pub verifier_kind: DirectVerifierKind,
    pub verifier: String,
}

impl DirectVerifierRequest {
    pub fn validate(&self) -> bool {
        valid_direct_verifier(self.verifier_kind, &self.verifier)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectWorkListItem {
    pub principal_id: String,
    pub member_id: String,
    pub principal_name: String,
    pub marker: String,
    pub verifier_kind: DirectVerifierKind,
    pub verifier: String,
    pub verifier_version: u64,
    pub applied_verifier_version: u64,
    pub applied_level: DirectLevel,
    pub desired_level: DirectLevel,
    pub state: DirectPrincipalState,
    pub server_role_oid: Option<String>,
    pub claim_expires_at: Option<String>,
    pub action: DirectWorkAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectRevocationEntry {
    pub id: String,
    pub connection_id: String,
    pub member_id: String,
    pub principal_name: Option<String>,
    pub kind: DirectRevocationKind,
    pub target_level: DirectLevel,
    pub state: DirectRevocationState,
    pub created_at: String,
}

impl DirectRevocationEntry {
    pub fn validate(&self) -> bool {
        valid_uuid_text(&self.id)
            && valid_uuid_text(&self.connection_id)
            && !self.member_id.is_empty()
            && self.member_id.len() <= 128
            && self.principal_name.as_deref().is_none_or(valid_principal_name)
            && self.target_level != DirectLevel::Write
            && valid_rfc3339_instant(&self.created_at)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectWorkList {
    pub connection_id: String,
    pub engine: DirectEngine,
    pub scope: Vec<String>,
    pub scope_revision: u64,
    pub write_ceiling: bool,
    pub server_fingerprint: Option<String>,
    pub items: Vec<DirectWorkListItem>,
    pub revocations: Vec<DirectRevocationEntry>,
}

impl DirectWorkList {
    pub fn validate(&self) -> bool {
        let kind = match self.engine {
            DirectEngine::Postgres => DirectVerifierKind::ScramSha256,
            DirectEngine::Mysql => DirectVerifierKind::CachingSha2,
        };
        valid_uuid_text(&self.connection_id)
            && valid_direct_scope(self.engine, &self.scope)
            && (1..=SAFE_INTEGER_MAX).contains(&self.scope_revision)
            && self
                .server_fingerprint
                .as_deref()
                .is_none_or(|value| (1..=128).contains(&value.len()))
            && self.items.len() <= 1_000
            && self.revocations.len() <= 1_000
            && self.items.iter().all(|item| {
                !item.member_id.is_empty()
                    && item.member_id.len() <= 128
                    && valid_uuid_text(&item.principal_id)
                    && valid_principal_name(&item.principal_name)
                    && valid_principal_marker(&item.marker)
                    && item.verifier_kind == kind
                    && valid_direct_verifier(kind, &item.verifier)
                    && (1..=SAFE_INTEGER_MAX).contains(&item.verifier_version)
                    && item.applied_verifier_version <= item.verifier_version
                    && item
                        .server_role_oid
                        .as_deref()
                        .is_none_or(|value| (1..=64).contains(&value.len()))
                    && item.claim_expires_at.as_deref().is_none_or(valid_rfc3339_instant)
            })
            && self.revocations.iter().all(DirectRevocationEntry::validate)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectReceiptRequest {
    pub principal_id: String,
    pub device_id: String,
    pub from: DirectReceiptFrom,
    pub to: DirectReceiptTo,
    pub applied_level: DirectLevel,
    pub applied_verifier_version: u64,
    pub scope_revision_applied: Option<u64>,
    pub server_role_oid: Option<String>,
    pub server_fingerprint: Option<String>,
    pub failure_code: Option<DirectFailureCode>,
}

impl DirectReceiptRequest {
    pub fn validate(&self) -> bool {
        use DirectReceiptFrom as F;
        use DirectReceiptTo as T;
        valid_uuid_text(&self.principal_id)
            && (1..=128).contains(&self.device_id.len())
            && (self.from == F::Applying && matches!(self.to, T::Ready | T::Failed)
                || self.from == F::DropPending && matches!(self.to, T::Dropped | T::Failed))
            && (self.to == T::Failed) == self.failure_code.is_some()
            && (self.to != T::Ready
                || (self.applied_level != DirectLevel::None
                    && self.server_role_oid.is_some()
                    && self.server_fingerprint.is_some()))
            && (self.to != T::Dropped || self.applied_level == DirectLevel::None)
            && self.applied_verifier_version <= SAFE_INTEGER_MAX
            && self
                .scope_revision_applied
                .is_none_or(|value| (1..=SAFE_INTEGER_MAX).contains(&value))
            && self
                .server_role_oid
                .as_deref()
                .is_none_or(|value| (1..=64).contains(&value.len()))
            && self
                .server_fingerprint
                .as_deref()
                .is_none_or(|value| (1..=128).contains(&value.len()))
    }
}

/// `dopedb_` plus exactly 20 lowercase hex characters.
pub fn valid_principal_name(value: &str) -> bool {
    value.len() == 27
        && value.starts_with("dopedb_")
        && value[7..]
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// 32 random bytes as unpadded base64url.
pub fn valid_principal_marker(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Exact public-verifier shapes. SCRAM uses 4096 iterations with a 16-byte salt and two
/// 32-byte keys; the MySQL form is `$A$005$` plus 63 crypt-alphabet characters.
pub fn valid_direct_verifier(kind: DirectVerifierKind, verifier: &str) -> bool {
    match kind {
        DirectVerifierKind::ScramSha256 => {
            let Some(rest) = verifier.strip_prefix("SCRAM-SHA-256$4096:") else {
                return false;
            };
            let Some((salt, keys)) = rest.split_once('$') else {
                return false;
            };
            let Some((stored, server)) = keys.split_once(':') else {
                return false;
            };
            exact_base64(salt, 16) && exact_base64(stored, 32) && exact_base64(server, 32)
        }
        DirectVerifierKind::CachingSha2 => verifier.strip_prefix("$A$005$").is_some_and(|rest| {
            rest.len() == 63
                && rest
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'/')
        }),
    }
}

fn base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Canonical padded standard base64 of exactly `bytes` bytes, with zero trailing bits.
fn exact_base64(value: &str, bytes: usize) -> bool {
    let padding = (3 - bytes % 3) % 3;
    if value.len() != bytes.div_ceil(3) * 4 || !value.is_ascii() {
        return false;
    }
    let data = value.len() - padding;
    let raw = value.as_bytes();
    raw[data..].iter().all(|byte| *byte == b'=')
        && raw[..data].iter().all(|byte| base64_value(*byte).is_some())
        && match padding {
            0 => true,
            1 => base64_value(raw[data - 1]).is_some_and(|v| v & 0x3 == 0),
            _ => base64_value(raw[data - 1]).is_some_and(|v| v & 0xf == 0),
        }
}

/// Bounded, duplicate-free PostgreSQL schemas or MySQL databases without quoting characters.
pub fn valid_direct_scope(engine: DirectEngine, scope: &[String]) -> bool {
    !scope.is_empty()
        && scope.len() <= 32
        && scope.iter().enumerate().all(|(index, name)| {
            let lower = name.to_ascii_lowercase();
            !name.is_empty()
                && name.trim() == name
                && !name
                    .chars()
                    .any(|c| c.is_control() || "\"`'\\%".contains(c))
                && !scope[..index].contains(name)
                && match engine {
                    DirectEngine::Postgres => {
                        name.len() <= 63 && !lower.starts_with("pg_") && lower != "information_schema"
                    }
                    DirectEngine::Mysql => {
                        name.chars().count() <= 64
                            && !matches!(
                                lower.as_str(),
                                "mysql" | "information_schema" | "performance_schema" | "sys"
                            )
                    }
                }
        })
}
