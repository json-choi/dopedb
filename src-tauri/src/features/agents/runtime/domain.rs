use std::collections::BTreeMap;
use std::path::PathBuf;

use dopedb_protocol::{AcpPluginId, SignedAcpPluginManifestV2};
use serde::{Deserialize, Serialize};

pub(super) const RUNTIME_STATE_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AcpPluginInstallationState {
    NotInstalled,
    Checking,
    Downloading,
    Verifying,
    Staged,
    Ready,
    UpdateAvailable,
    Removing,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcpPluginStatus {
    pub(crate) plugin_id: AcpPluginId,
    pub(crate) state: AcpPluginInstallationState,
    pub(crate) enabled: bool,
    pub(crate) installed_version: Option<String>,
    pub(crate) installed_release_id: Option<String>,
    pub(crate) candidate_version: Option<String>,
    pub(crate) last_known_good_version: Option<String>,
    pub(crate) available_version: Option<String>,
    pub(crate) available_release_id: Option<String>,
    pub(crate) failure: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcpPluginMutationReceipt {
    pub(crate) changed: bool,
    pub(crate) status: AcpPluginStatus,
}

/// Privacy-bounded operational signal. Versions, paths, errors, and user data
/// deliberately stay out of this renderer event and therefore out of Sentry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcpPluginTelemetry {
    pub(crate) provider: &'static str,
    pub(crate) operation: &'static str,
    pub(crate) outcome: &'static str,
}

#[derive(Debug, Clone)]
pub(crate) struct AcpPluginLaunchPlan {
    pub(crate) adapter_bundle_version: String,
    pub(crate) installation_id: String,
    pub(crate) node_executable: PathBuf,
    pub(crate) node_sha256: String,
    pub(crate) adapter_entrypoint: PathBuf,
    pub(crate) adapter_entrypoint_sha256: String,
    pub(crate) candidate: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PersistedPluginRecord {
    pub(super) enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) current: Option<InstalledPluginVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) candidate: Option<InstalledPluginVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) last_known_good: Option<InstalledPluginVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) failure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) last_checked_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct InstalledPluginVersion {
    pub(super) adapter_bundle_version: String,
    pub(super) manifest_sha256: String,
    pub(super) entrypoint_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AvailablePluginVersion {
    pub(super) adapter_version: String,
    pub(super) adapter_bundle_version: String,
    pub(super) release_id: String,
    pub(super) manifest_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PersistedAvailableUpdates {
    pub(super) schema_version: u16,
    pub(super) plugins: BTreeMap<AcpPluginId, AvailablePluginVersion>,
}

impl Default for PersistedAvailableUpdates {
    fn default() -> Self {
        Self {
            schema_version: RUNTIME_STATE_SCHEMA_VERSION,
            plugins: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PersistedRuntimeState {
    pub(super) schema_version: u16,
    pub(super) plugins: BTreeMap<AcpPluginId, PersistedPluginRecord>,
}

impl Default for PersistedRuntimeState {
    fn default() -> Self {
        Self {
            schema_version: RUNTIME_STATE_SCHEMA_VERSION,
            plugins: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct QuarantinedPluginVersion {
    pub(super) adapter_bundle_version: String,
    pub(super) manifest_sha256: String,
    pub(super) reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PersistedQuarantineState {
    pub(super) schema_version: u16,
    pub(super) plugins: BTreeMap<AcpPluginId, Vec<QuarantinedPluginVersion>>,
}

impl Default for PersistedQuarantineState {
    fn default() -> Self {
        Self {
            schema_version: RUNTIME_STATE_SCHEMA_VERSION,
            plugins: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct InstalledPluginMarker {
    pub(super) schema_version: u16,
    pub(super) envelope: SignedAcpPluginManifestV2,
    pub(super) entrypoint_sha256: String,
}
