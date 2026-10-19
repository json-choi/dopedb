//! Direct access domain types and invariants.
//!
//! Closed vocabularies shared by the planner, ownership proof, and later adapters:
//! supported engines and server versions, the validated sharing scope, the access
//! level ladder with its effective-level mapping, the generated principal name and
//! ownership marker, and the categorical failure codes that are the only error
//! detail ever logged or reported (never raw database errors or SQL).

use std::fmt;

use serde::{Deserialize, Serialize};

/// Engines that support direct principal provisioning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DirectEngine {
    Postgres,
    Mysql,
}

impl DirectEngine {
    pub(crate) fn verifier_kind(self) -> VerifierKind {
        match self {
            Self::Postgres => VerifierKind::ScramSha256,
            Self::Mysql => VerifierKind::CachingSha2,
        }
    }
}

/// Public password verifier families stored in the shared record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum VerifierKind {
    #[serde(rename = "scram-sha-256")]
    ScramSha256,
    #[serde(rename = "caching_sha2")]
    CachingSha2,
}

/// Closed set of categorical failure reasons for a principal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FailureCode {
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

impl FailureCode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::MarkerMismatch => "marker_mismatch",
            Self::OidMismatch => "oid_mismatch",
            Self::OwnsObjects => "owns_objects",
            Self::UnexpectedMembership => "unexpected_membership",
            Self::GrantorInsufficient => "grantor_insufficient",
            Self::VersionUnsupported => "version_unsupported",
            Self::EndpointChanged => "endpoint_changed",
            Self::PermissionDenied => "permission_denied",
            Self::Network => "network",
            Self::NameConflict => "name_conflict",
            Self::CredentialMissing => "credential_missing",
        }
    }
}

impl fmt::Display for FailureCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Lifecycle state of one member principal receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PrincipalState {
    Requested,
    Applying,
    Ready,
    Failed,
    DropPending,
    Dropped,
}

/// Applied or desired privilege level, ordered `None < Read < Write`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AccessLevel {
    None,
    Read,
    Write,
}

/// Workspace grant modes as the control plane stores them. Desktop never computes
/// the effective level (the server projects it into the work list); the mapping is
/// kept compiled only to pin it against the control plane's matrix in tests.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum GrantMode {
    None,
    View,
    Read,
    Write,
    Manage,
}

/// Effective database level for a member. `grant` is `None` when the member has no
/// grant row, is missing, is pending revocation, or the connection is deleted, so
/// callers fold those absences into `Option::None` before calling.
/// `none`/`view` and absent grants give no access, `read` reads, and `write`/`manage`
/// write only while the shared database's write ceiling is on.
#[cfg(test)]
pub(crate) fn effective_level(grant: Option<GrantMode>, write_ceiling: bool) -> AccessLevel {
    match grant {
        None | Some(GrantMode::None) | Some(GrantMode::View) => AccessLevel::None,
        Some(GrantMode::Read) => AccessLevel::Read,
        Some(GrantMode::Write) | Some(GrantMode::Manage) => {
            if write_ceiling {
                AccessLevel::Write
            } else {
                AccessLevel::Read
            }
        }
    }
}

/// True when moving from `applied` to `desired` removes privilege, which the
/// revocation coordinator must apply synchronously.
pub(crate) fn lowers_access(applied: AccessLevel, desired: AccessLevel) -> bool {
    desired < applied
}

/// Oldest supported servers: PostgreSQL 14 and MySQL 8.0.21 (inline `ATTRIBUTE`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct ServerVersion {
    pub(crate) major: u32,
    pub(crate) minor: u32,
    pub(crate) patch: u32,
}

impl ServerVersion {
    /// Parse and gate a version string. PostgreSQL accepts `server_version` text
    /// (`14.5 (Debian ...)`) or the numeric `server_version_num` (`140005`); MySQL
    /// accepts `@@version` (`8.0.35-0ubuntu`). Anything MariaDB-flavoured, malformed,
    /// or older than the floor is `version_unsupported`.
    pub(crate) fn check(engine: DirectEngine, raw: &str) -> Result<Self, FailureCode> {
        let raw = raw.trim();
        if raw.is_empty() || raw.len() > 128 || raw.to_ascii_lowercase().contains("mariadb") {
            return Err(FailureCode::VersionUnsupported);
        }
        let version = match engine {
            DirectEngine::Postgres => Self::parse_postgres(raw)?,
            DirectEngine::Mysql => Self::parse_dotted(raw)?,
        };
        let floor = match engine {
            DirectEngine::Postgres => Self {
                major: 14,
                minor: 0,
                patch: 0,
            },
            DirectEngine::Mysql => Self {
                major: 8,
                minor: 0,
                patch: 21,
            },
        };
        if version < floor {
            return Err(FailureCode::VersionUnsupported);
        }
        Ok(version)
    }

    fn parse_postgres(raw: &str) -> Result<Self, FailureCode> {
        if raw.len() >= 5 && raw.bytes().all(|byte| byte.is_ascii_digit()) {
            let number: u32 = raw.parse().map_err(|_| FailureCode::VersionUnsupported)?;
            return Ok(Self {
                major: number / 10_000,
                minor: number % 10_000,
                patch: 0,
            });
        }
        Self::parse_dotted(raw)
    }

    fn parse_dotted(raw: &str) -> Result<Self, FailureCode> {
        let mut parts = [0u32; 3];
        let mut rest = raw;
        for slot in parts.iter_mut() {
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            if digits == 0 || digits > 6 {
                return Err(FailureCode::VersionUnsupported);
            }
            *slot = rest[..digits]
                .parse()
                .map_err(|_| FailureCode::VersionUnsupported)?;
            rest = &rest[digits..];
            match rest.strip_prefix('.') {
                Some(next) => rest = next,
                None => break,
            }
        }
        Ok(Self {
            major: parts[0],
            minor: parts[1],
            patch: parts[2],
        })
    }
}

/// Maximum number of schemas/databases one shared record may expose.
pub(crate) const MAX_SCOPE_ENTRIES: usize = 32;

/// Validated, ordered, duplicate-free list of PostgreSQL schemas or MySQL databases.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub(crate) struct Scope(Vec<String>);

impl Scope {
    /// Validate names for `engine`. Names are 1..=63 bytes (PostgreSQL) or 1..=64
    /// characters (MySQL), contain no control characters, quotes, backticks,
    /// backslashes, or `%`, are unique, and are not engine system namespaces.
    pub(crate) fn new(engine: DirectEngine, names: Vec<String>) -> Option<Self> {
        if names.is_empty() || names.len() > MAX_SCOPE_ENTRIES {
            return None;
        }
        let mut seen = std::collections::HashSet::new();
        for name in &names {
            if !valid_namespace_name(engine, name) || !seen.insert(name.as_str()) {
                return None;
            }
        }
        Some(Self(names))
    }

    pub(crate) fn names(&self) -> &[String] {
        &self.0
    }
}

fn valid_namespace_name(engine: DirectEngine, name: &str) -> bool {
    let length_ok = match engine {
        DirectEngine::Postgres => (1..=63).contains(&name.len()),
        DirectEngine::Mysql => (1..=64).contains(&name.chars().count()),
    };
    if !length_ok || name != name.trim() {
        return false;
    }
    if name
        .chars()
        .any(|ch| ch.is_control() || matches!(ch, '"' | '`' | '\\' | '%' | '\''))
    {
        return false;
    }
    let lower = name.to_ascii_lowercase();
    match engine {
        DirectEngine::Postgres => !(lower.starts_with("pg_") || lower == "information_schema"),
        DirectEngine::Mysql => !matches!(
            lower.as_str(),
            "mysql" | "information_schema" | "performance_schema" | "sys"
        ),
    }
}

/// Generated principal name: exactly `dopedb_` plus 20 lowercase hex characters.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub(crate) struct PrincipalName(String);

impl PrincipalName {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        let hex = value.strip_prefix("dopedb_")?;
        (hex.len() == 20 && hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
            .then(|| Self(value.to_owned()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for PrincipalName {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).ok_or_else(|| serde::de::Error::custom("invalid principal name"))
    }
}

/// Ownership marker written to the server object and the receipt: 16..=64 URL-safe
/// characters, safe to embed in a SQL string literal and a JSON string unescaped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub(crate) struct Marker(String);

impl Marker {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        ((16..=64).contains(&value.len())
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
        .then(|| Self(value.to_owned()))
    }

    /// PostgreSQL `COMMENT ON ROLE` text; read back from `pg_shdescription`.
    pub(crate) fn postgres_comment(&self) -> String {
        format!("dopedb:v1:{}", self.0)
    }

    /// Extract the marker from observed `COMMENT ON ROLE` text.
    pub(crate) fn from_postgres_comment(comment: &str) -> Option<Self> {
        Self::parse(comment.strip_prefix("dopedb:v1:")?)
    }

    /// MySQL `ATTRIBUTE` JSON; read back from `information_schema.USER_ATTRIBUTES`.
    pub(crate) fn mysql_attribute(&self) -> String {
        format!("{{\"dopedb\":{{\"v\":1,\"m\":\"{}\"}}}}", self.0)
    }

    /// Extract the marker from observed `USER_ATTRIBUTES.ATTRIBUTE` JSON.
    pub(crate) fn from_mysql_attribute(attribute: &str) -> Option<Self> {
        let value: serde_json::Value = serde_json::from_str(attribute).ok()?;
        let object = value.get("dopedb")?;
        if object.get("v")?.as_u64()? != 1 {
            return None;
        }
        Self::parse(object.get("m")?.as_str()?)
    }
}

impl<'de> Deserialize<'de> for Marker {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).ok_or_else(|| serde::de::Error::custom("invalid marker"))
    }
}
