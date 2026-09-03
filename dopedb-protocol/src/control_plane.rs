//! Versioned, credential-bearing Workspace control-plane wire contracts.
//!
//! These types describe HTTPS payloads shared by Workspace Cloud and Desktop.
//! They contain no transport, storage, or authority behavior. Parsed secret
//! fields own zeroizing strings. Desktop separately zeroizes the response bytes
//! it explicitly accumulates; buffers owned by HTTP/TLS libraries are outside
//! this contract's guarantees.

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

pub const CONTROL_PLANE_CONTRACTS_SCHEMA_VERSION: u32 = 1;
/// Desktop and Workspace Cloud must agree on this header before a managed
/// credential can cross the HTTPS boundary.
pub const MANAGED_LEASE_CONTRACT_VERSION: &str = "access-v5";
const JAVASCRIPT_MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Workspace sync cursors cross a JavaScript number boundary in Cloud and must
/// remain exact before Desktop serializes them into the request URL.
pub const fn valid_workspace_sync_cursor(cursor: Option<i64>) -> bool {
    match cursor {
        Some(value) => value >= 0 && value <= JAVASCRIPT_MAX_SAFE_INTEGER,
        None => true,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedAccessMode {
    Read,
    Write,
    Schema,
}

impl ManagedAccessMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
            Self::Schema => "schema",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedLeaseRequest {
    pub access_mode: ManagedAccessMode,
}

impl ManagedLeaseRequest {
    /// Re-assert the semantic request contract at the Rust transport boundary.
    /// The enum and strict serde shape make every constructed value valid today.
    pub const fn validate(&self) -> bool {
        matches!(
            self.access_mode,
            ManagedAccessMode::Read | ManagedAccessMode::Write | ManagedAccessMode::Schema
        )
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedLeaseResponse {
    pub lease: ManagedLeasePayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedLeasePayload {
    pub id: String,
    pub provider: String,
    pub engine: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: Zeroizing<String>,
    pub sslmode: String,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    pub tls_server_ca_pem: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    pub connector: Option<ManagedConnectorPayload>,
    pub access_mode: ManagedAccessMode,
    pub expires_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedConnectorPayload {
    pub kind: String,
    pub instance_connection_name: String,
    pub access_token: Zeroizing<String>,
    pub network_mode: String,
}

impl ManagedLeaseResponse {
    /// Validate the same semantic lease constraints enforced by Workspace Cloud.
    /// This deliberately returns no field values so credential material cannot
    /// enter validation errors or logs.
    pub fn validate(&self) -> bool {
        self.lease.validate()
    }
}

impl ManagedLeasePayload {
    fn validate(&self) -> bool {
        let connector_is_valid = self.connector.as_ref().is_some_and(|connector| {
            connector.kind == "gcpCloudSqlAuthProxy"
                && text_len(&connector.instance_connection_name) <= 300
                && !connector.instance_connection_name.is_empty()
                && text_len(&connector.access_token) <= 64 * 1024
                && !connector.access_token.is_empty()
                && !connector.access_token.chars().any(js_whitespace)
                && matches!(
                    connector.network_mode.as_str(),
                    "PUBLIC" | "PRIVATE_SERVICES_ACCESS" | "PRIVATE_SERVICE_CONNECT"
                )
        });
        let is_gcp = self.provider == "gcpCloudSql";

        valid_uuid_text(&self.id)
            && matches!(
                self.provider.as_str(),
                "neon" | "planetScale" | "gcpCloudSql" | "generic"
            )
            && matches!(self.engine.as_str(), "postgres" | "mysql")
            && !self.host.is_empty()
            && text_len(&self.host) <= 512
            && !self.host.contains("://")
            && !self.host.chars().any(js_whitespace)
            && self.port > 0
            && !self.database.is_empty()
            && text_len(&self.database) <= 512
            && !self.username.is_empty()
            && text_len(&self.username) <= 512
            && !self.password.is_empty()
            && text_len(&self.password) <= 64 * 1024
            && matches!(self.sslmode.as_str(), "verify-ca" | "verify-full")
            && self.tls_server_ca_pem.is_none()
            && (is_gcp == self.connector.is_some())
            && (!is_gcp || connector_is_valid)
            && (is_gcp || self.sslmode == "verify-full")
            && (self.access_mode != ManagedAccessMode::Schema
                || (matches!(self.provider.as_str(), "neon" | "gcpCloudSql")
                    && self.engine == "postgres"))
            && valid_rfc3339_instant(&self.expires_at)
    }
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn text_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn js_whitespace(character: char) -> bool {
    character.is_whitespace() || character == '\u{feff}'
}

fn valid_uuid_text(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|index| bytes[*index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
        && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'A' | b'b' | b'B')
        && Uuid::parse_str(value).is_ok()
}

fn valid_rfc3339_instant(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || ![4, 7, 10, 13, 16]
            .iter()
            .all(|index| bytes.get(*index).is_some())
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || !bytes[..19]
            .iter()
            .enumerate()
            .all(|(index, byte)| [4, 7, 10, 13, 16].contains(&index) || byte.is_ascii_digit())
        || &bytes[17..19] > b"59"
    {
        return false;
    }
    let suffix = &bytes[19..];
    let valid_suffix = suffix == b"Z"
        || (suffix.len() == 6
            && matches!(suffix[0], b'+' | b'-')
            && suffix[1..3].iter().all(u8::is_ascii_digit)
            && suffix[3] == b':'
            && suffix[4..6].iter().all(u8::is_ascii_digit))
        || (suffix.len() >= 3
            && suffix[0] == b'.'
            && suffix[1..]
                .iter()
                .position(|byte| !byte.is_ascii_digit())
                .is_some_and(|offset| {
                    let suffix_start = offset + 1;
                    suffix_start > 1
                        && (suffix[suffix_start..] == *b"Z"
                            || (suffix.len() == suffix_start + 6
                                && matches!(suffix[suffix_start], b'+' | b'-')
                                && suffix[suffix_start + 1..suffix_start + 3]
                                    .iter()
                                    .all(u8::is_ascii_digit)
                                && suffix[suffix_start + 3] == b':'
                                && suffix[suffix_start + 4..].iter().all(u8::is_ascii_digit)))
                }));
    valid_suffix && DateTime::parse_from_rfc3339(value).is_ok()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSyncPageResponse {
    #[serde(deserialize_with = "deserialize_contract_uuid")]
    pub workspace_id: Uuid,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub previous_cursor: Option<i64>,
    pub next_cursor: i64,
    pub has_more: bool,
    pub reset: bool,
    pub refresh: WorkspaceSyncCollections,
    pub tombstones: WorkspaceSyncCollections,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceSyncCollections {
    pub connections: bool,
    pub analyses: bool,
}

impl WorkspaceSyncPageResponse {
    /// Validate ordering against the request that produced this page. The cloud
    /// response is intentionally payload-free; a valid marker only selects which
    /// independently authorized collection must be reconciled.
    pub fn valid_for(&self, workspace_id: Uuid, cursor: Option<i64>) -> bool {
        self.workspace_id == workspace_id
            && valid_workspace_sync_cursor(cursor)
            && self
                .previous_cursor
                .is_none_or(|value| valid_workspace_sync_cursor(Some(value)))
            && valid_workspace_sync_cursor(Some(self.next_cursor))
            && self.previous_cursor == cursor
            && (self.reset || !cursor.is_some_and(|value| self.next_cursor < value))
            && (!self.reset
                || (cursor.is_some_and(|value| self.next_cursor != value) && !self.has_more))
            && (cursor.is_some() || (!self.reset && !self.has_more))
            && (!(cursor.is_none() || self.reset)
                || (self.refresh.connections && self.refresh.analyses))
            && (!self.has_more || cursor.is_some_and(|value| self.next_cursor > value))
            && (!self.tombstones.connections || self.refresh.connections)
            && (!self.tombstones.analyses || self.refresh.analyses)
    }
}

fn deserialize_contract_uuid<'de, D>(deserializer: D) -> Result<Uuid, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    valid_uuid_text(&value)
        .then(|| Uuid::parse_str(&value).ok())
        .flatten()
        .ok_or_else(|| serde::de::Error::custom("invalid contract UUID"))
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}
