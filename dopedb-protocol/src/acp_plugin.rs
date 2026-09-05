//! Closed first-party ACP adapter plugin and signed catalog contracts.
//!
//! The Desktop accepts only the two IDs in this module. A catalog entry can
//! select a version of one of those plugins, but it cannot introduce another
//! executable identity or provider.

use serde::{Deserialize, Serialize};

pub const ACP_PLUGIN_MANIFEST_SCHEMA_VERSION: u16 = 2;
// Bump only when the adapter launch/initialization contract breaks, independently
// of Desktop releases and the private Desktop/CLI command schema.
pub const ACP_PLUGIN_RUNTIME_CONTRACT_VERSION: u16 = 1;
pub const ACP_PLUGIN_PROTOCOL_VERSION: &str = "2025-11-25";
pub const MAX_ACP_PLUGIN_STRING_BYTES: usize = 4 * 1024;
pub const MAX_ACP_PLUGIN_LICENSES: usize = 64;
pub const MAX_ACP_PLUGIN_PACKED_BYTES: u64 = 30 * 1024 * 1024;
pub const MAX_ACP_PLUGIN_UNPACKED_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcpPluginProvider {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum AcpPluginId {
    #[serde(rename = "dopedb.acp.claude")]
    Claude,
    #[serde(rename = "dopedb.acp.codex")]
    Codex,
}

impl AcpPluginId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "dopedb.acp.claude",
            Self::Codex => "dopedb.acp.codex",
        }
    }

    pub const fn provider(self) -> AcpPluginProvider {
        match self {
            Self::Claude => AcpPluginProvider::Claude,
            Self::Codex => AcpPluginProvider::Codex,
        }
    }

    pub const fn provider_slug(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    pub const fn local_cli_environment(self) -> &'static str {
        match self {
            Self::Claude => "CLAUDE_CODE_EXECUTABLE",
            Self::Codex => "CODEX_PATH",
        }
    }

    pub const fn upstream_repository(self) -> &'static str {
        match self {
            Self::Claude => "https://github.com/agentclientprotocol/claude-agent-acp",
            Self::Codex => "https://github.com/agentclientprotocol/codex-acp",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "dopedb.acp.claude" => Some(Self::Claude),
            "dopedb.acp.codex" => Some(Self::Codex),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpPluginUpstream {
    pub repository: String,
    pub tag: String,
    pub commit: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpPluginCompatibility {
    pub acp_protocol_min: String,
    pub acp_protocol_max: String,
    pub node_version_min: String,
    pub node_version_max: String,
    pub runtime_contract_version: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpPluginArtifact {
    pub url: String,
    pub sha256: String,
    pub signature: String,
    pub key_id: String,
    pub packed_bytes: u64,
    pub unpacked_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpPluginLicense {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcpPluginManifestV2 {
    pub schema_version: u16,
    pub plugin_id: AcpPluginId,
    pub provider: AcpPluginProvider,
    pub adapter_version: String,
    pub adapter_bundle_version: String,
    pub adapter_entrypoint: String,
    pub upstream: AcpPluginUpstream,
    pub compatibility: AcpPluginCompatibility,
    pub artifact: AcpPluginArtifact,
    pub licenses: Vec<AcpPluginLicense>,
    pub sbom_sha256: String,
    pub content_sha256: String,
    pub released_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<String>,
    pub rollout_basis_points: u16,
}

impl AcpPluginManifestV2 {
    pub fn validate(&self) -> bool {
        self.schema_version == ACP_PLUGIN_MANIFEST_SCHEMA_VERSION
            && self.provider == self.plugin_id.provider()
            && valid_text(&self.adapter_version)
            && valid_text(&self.adapter_bundle_version)
            && valid_relative_path(&self.adapter_entrypoint)
            && self.upstream.repository == self.plugin_id.upstream_repository()
            && valid_text(&self.upstream.tag)
            && valid_commit(&self.upstream.commit)
            && valid_acp_protocol_version(&self.compatibility.acp_protocol_min)
            && valid_acp_protocol_version(&self.compatibility.acp_protocol_max)
            && self.compatibility.acp_protocol_min <= self.compatibility.acp_protocol_max
            && valid_version(&self.compatibility.node_version_min)
            && valid_version(&self.compatibility.node_version_max)
            && version_at_most(
                &self.compatibility.node_version_min,
                &self.compatibility.node_version_max,
            )
            && self.compatibility.runtime_contract_version > 0
            && valid_artifact_url(&self.artifact.url)
            && valid_sha256(&self.artifact.sha256)
            && valid_signature(&self.artifact.signature)
            && valid_text(&self.artifact.key_id)
            && self.artifact.packed_bytes > 0
            && self.artifact.packed_bytes <= MAX_ACP_PLUGIN_PACKED_BYTES
            && self.artifact.unpacked_bytes >= self.artifact.packed_bytes
            && self.artifact.unpacked_bytes <= MAX_ACP_PLUGIN_UNPACKED_BYTES
            && !self.licenses.is_empty()
            && self.licenses.len() <= MAX_ACP_PLUGIN_LICENSES
            && self
                .licenses
                .iter()
                .all(|license| valid_text(&license.name) && valid_relative_path(&license.path))
            && valid_sha256(&self.sbom_sha256)
            && valid_sha256(&self.content_sha256)
            && valid_timestamp(&self.released_at)
            && self.revoked_at.as_deref().is_none_or(valid_timestamp)
            && self.rollout_basis_points <= 10_000
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedAcpPluginManifestV2 {
    pub manifest: AcpPluginManifestV2,
    pub manifest_sha256: String,
    pub signature: String,
    pub key_id: String,
}

impl SignedAcpPluginManifestV2 {
    pub fn validate_shape(&self) -> bool {
        self.manifest.validate()
            && valid_sha256(&self.manifest_sha256)
            && valid_signature(&self.signature)
            && valid_text(&self.key_id)
    }
}

fn valid_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ACP_PLUGIN_STRING_BYTES
        && !value.contains('\0')
        && !value.chars().any(char::is_control)
}

fn valid_signature(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ACP_PLUGIN_STRING_BYTES
        && !value.contains('\0')
        && !value
            .chars()
            .any(|character| character.is_control() && character != '\n' && character != '\t')
}

fn valid_https_url(value: &str) -> bool {
    valid_text(value) && value.starts_with("https://") && !value.contains(['\\', '\0'])
}

fn valid_artifact_url(value: &str) -> bool {
    valid_https_url(value)
        && value.starts_with("https://github.com/json-choi/dopedb/releases/download/acp-bundle-")
        && value.ends_with(".tar.gz")
}

fn valid_relative_path(value: &str) -> bool {
    valid_text(value)
        && !value.starts_with(['/', '\\'])
        && !value
            .split(['/', '\\'])
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_commit(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_version(value: &str) -> bool {
    valid_text(value) && version_components(value).is_some()
}

fn version_at_most(minimum: &str, maximum: &str) -> bool {
    version_components(minimum)
        .zip(version_components(maximum))
        .is_some_and(|(minimum, maximum)| minimum <= maximum)
}

fn version_components(value: &str) -> Option<(u64, u64, u64)> {
    let mut parts = value.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    parts.next().is_none().then_some((major, minor, patch))
}

fn valid_acp_protocol_version(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
}

fn valid_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 20
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes[19] == b'Z'
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19) || byte.is_ascii_digit()
        })
}
