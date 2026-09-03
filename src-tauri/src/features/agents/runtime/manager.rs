use std::collections::{BTreeMap, BTreeSet};
#[cfg(windows)]
use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dopedb_protocol::{AcpPluginId, SignedAcpPluginManifestV1};
use futures::StreamExt;
use reqwest::redirect::{Attempt, Policy};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::archive::{checked_stage_file, extract_verified_archive, verify_content_tree};
use super::domain::{
    AcpPluginInstallationState, AcpPluginLaunchPlan, AcpPluginMutationReceipt, AcpPluginStatus,
    AcpPluginTelemetry, AvailablePluginVersion, InstalledPluginMarker, InstalledPluginVersion,
    PersistedAvailableUpdates, PersistedPluginRecord, PersistedQuarantineState,
    PersistedRuntimeState, QuarantinedPluginVersion, RUNTIME_STATE_SCHEMA_VERSION,
};
use super::verification::{
    sha256_file, verify_artifact, verify_bundled_node, verify_compatibility, verify_manifest,
};

#[path = "manager_install.rs"]
mod install;
#[path = "manager_storage.rs"]
mod storage;

use storage::*;

const MAX_MANIFEST_BYTES: u64 = 128 * 1024;
const MAX_CATALOG_REFS_BYTES: u64 = 256 * 1024;
// Request one more slot than the supported catalog so pagination can never
// make the app silently select an old release.
const MAX_CATALOG_REFS: usize = 99;
const MAX_CATALOG_RELEASE_FALLBACKS: usize = 8;
const MAX_STATE_BYTES: u64 = 1024 * 1024;
const MAX_FAILURE_BYTES: usize = 4 * 1024;
const MAX_QUARANTINE_RECORDS_PER_PLUGIN: usize = 16;
const CATALOG_REFS_URL: &str =
    "https://api.github.com/repos/json-choi/dopedb/git/matching-refs/tags/acp-bundle-v?per_page=100";
const CATALOG_RESOLUTION_TTL: Duration = Duration::from_secs(15 * 60);
const UPDATE_CHECK_INTERVAL: chrono::Duration = chrono::Duration::hours(24);
const OBSOLETE_VERSION_COLLISION_FAILURE: &str =
    "blocked: an installed ACP plugin version conflicts with the signed artifact";

#[derive(Clone)]
pub(crate) struct AcpPluginManager {
    inner: Arc<Inner>,
}

struct Inner {
    root: PathBuf,
    client: reqwest::Client,
    mutation: tokio::sync::Mutex<()>,
    phases: Mutex<BTreeMap<AcpPluginId, AcpPluginInstallationState>>,
    catalog_release: Mutex<Option<CachedCatalogRelease>>,
}

#[derive(Clone)]
struct CachedCatalogRelease {
    tag: String,
    resolved_at: Instant,
}

#[derive(Deserialize)]
struct GitHubTagRef {
    #[serde(rename = "ref")]
    reference: String,
}

impl AcpPluginManager {
    pub(crate) fn new() -> AppResult<Self> {
        Self::with_root(crate::app_paths::data_root()?.join("acp-plugins"))
    }

    fn with_root(root: PathBuf) -> AppResult<Self> {
        prepare_directory(&root)?;
        for child in ["downloads", "staging", "quarantine"] {
            prepare_directory(&root.join(child))?;
        }
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(120))
            .redirect(Policy::custom(safe_redirect))
            .user_agent(format!(
                "DopeDB/{} ACP-plugin-manager",
                env!("CARGO_PKG_VERSION")
            ))
            .build()
            .map_err(|_| AppError::Config("the ACP plugin HTTP client is unavailable".into()))?;
        Ok(Self {
            inner: Arc::new(Inner {
                root,
                client,
                mutation: tokio::sync::Mutex::new(()),
                phases: Mutex::new(BTreeMap::new()),
                catalog_release: Mutex::new(None),
            }),
        })
    }

    pub(crate) fn statuses(&self) -> AppResult<Vec<AcpPluginStatus>> {
        let state = self.load_state()?;
        [AcpPluginId::Claude, AcpPluginId::Codex]
            .into_iter()
            .map(|plugin_id| self.project_status(plugin_id, &state))
            .collect()
    }

    pub(crate) fn has_ready_fallback(&self, plugin_id: AcpPluginId) -> AppResult<bool> {
        let state = self.load_state()?;
        Ok(state
            .plugins
            .get(&plugin_id)
            .is_some_and(record_has_ready_fallback))
    }

    pub(crate) async fn remove(
        &self,
        app: &AppHandle,
        plugin_id: AcpPluginId,
    ) -> AppResult<AcpPluginMutationReceipt> {
        emit_telemetry(app, plugin_id, "remove", "started");
        let _guard = self.inner.mutation.lock().await;
        self.set_phase(plugin_id, AcpPluginInstallationState::Removing)?;
        let result = self.remove_locked(plugin_id);
        self.clear_phase(plugin_id);
        emit_telemetry(
            app,
            plugin_id,
            "remove",
            if result.is_ok() {
                "succeeded"
            } else {
                "failed"
            },
        );
        result
    }

    fn remove_locked(&self, plugin_id: AcpPluginId) -> AppResult<AcpPluginMutationReceipt> {
        let mut state = self.load_state()?;
        let changed = state.plugins.remove(&plugin_id).is_some()
            || fs::symlink_metadata(self.provider_directory(plugin_id)).is_ok();
        let provider = self.provider_directory(plugin_id);
        if fs::symlink_metadata(&provider).is_ok() {
            remove_owned_tree(&self.inner.root, &provider)?;
        }
        self.remove_staging_for(plugin_id)?;
        self.remove_quarantine_for(plugin_id)?;
        let mut quarantine = self.load_quarantine()?;
        quarantine.plugins.remove(&plugin_id);
        self.write_quarantine(&quarantine)?;
        self.clear_available_update(plugin_id)?;
        self.write_state(&state)?;
        Ok(AcpPluginMutationReceipt {
            changed,
            status: self.project_status(plugin_id, &state)?,
        })
    }

    pub(crate) fn set_enabled(
        &self,
        plugin_id: AcpPluginId,
        enabled: bool,
    ) -> AppResult<AcpPluginStatus> {
        let mut state = self.load_state()?;
        let record = state.plugins.entry(plugin_id).or_default();
        if enabled && record.current.is_none() && record.candidate.is_none() {
            return Err(AppError::Blocked {
                reason: "install the ACP adapter plugin before enabling it".into(),
            });
        }
        record.enabled = enabled;
        self.write_state(&state)?;
        self.project_status(plugin_id, &state)
    }

    pub(crate) fn launch_plan(
        &self,
        app: &AppHandle,
        plugin_id: AcpPluginId,
    ) -> AppResult<AcpPluginLaunchPlan> {
        let state = self.load_state()?;
        let record = state.plugins.get(&plugin_id).ok_or_else(|| {
            AppError::NotFound(format!("{} ACP plugin", plugin_id.provider_slug()))
        })?;
        if !record.enabled {
            return Err(AppError::Blocked {
                reason: "this ACP adapter plugin is disabled".into(),
            });
        }
        let (installed, candidate) = record
            .candidate
            .as_ref()
            .map(|version| (version, true))
            .or_else(|| record.current.as_ref().map(|version| (version, false)))
            .or_else(|| {
                record
                    .last_known_good
                    .as_ref()
                    .map(|version| (version, false))
            })
            .ok_or_else(|| AppError::NotFound("a ready ACP plugin version".into()))?;
        let directory = self.installed_directory(plugin_id, installed);
        let marker = self.read_installed_marker(&directory)?;
        verify_manifest(&marker.envelope)?;
        if marker.envelope.manifest.plugin_id != plugin_id
            || marker.envelope.manifest_sha256 != installed.manifest_sha256
            || marker.entrypoint_sha256 != installed.entrypoint_sha256
        {
            return Err(AppError::Blocked {
                reason: "the installed ACP plugin marker changed after activation".into(),
            });
        }
        let entrypoint =
            checked_stage_file(&directory, &marker.envelope.manifest.adapter_entrypoint)?;
        if sha256_file(&entrypoint)? != installed.entrypoint_sha256 {
            return Err(AppError::Blocked {
                reason: "the installed ACP plugin entrypoint changed after activation".into(),
            });
        }
        verify_content_tree(&directory, &marker.envelope.manifest.content_sha256)?;
        let runtime = verify_bundled_node(app)?;
        verify_compatibility(&marker.envelope.manifest, &runtime)?;
        Ok(AcpPluginLaunchPlan {
            adapter_bundle_version: installed.adapter_bundle_version.clone(),
            installation_id: installed.manifest_sha256.clone(),
            node_executable: runtime.executable,
            node_sha256: runtime.executable_sha256,
            adapter_entrypoint: entrypoint,
            adapter_entrypoint_sha256: installed.entrypoint_sha256.clone(),
            candidate,
        })
    }

    pub(crate) fn record_initialize_success(
        &self,
        app: &AppHandle,
        plugin_id: AcpPluginId,
        installation_id: &str,
    ) -> AppResult<AcpPluginStatus> {
        let mut state = self.load_state()?;
        let record = state.plugins.get_mut(&plugin_id).ok_or_else(|| {
            AppError::NotFound(format!("{} ACP plugin", plugin_id.provider_slug()))
        })?;
        if let Some(candidate) = record.candidate.take() {
            if candidate.manifest_sha256 != installation_id {
                record.candidate = Some(candidate);
                return Err(AppError::Blocked {
                    reason: "the ACP plugin success receipt changed candidate identity".into(),
                });
            }
            record.current = Some(candidate.clone());
            record.last_known_good = Some(candidate);
        } else if record
            .current
            .as_ref()
            .is_none_or(|current| current.manifest_sha256 != installation_id)
        {
            return Err(AppError::Blocked {
                reason: "the ACP plugin success receipt is not active".into(),
            });
        }
        record.failure = None;
        self.write_state(&state)?;
        self.prune_unreferenced_versions(plugin_id, &state)?;
        let status = self.project_status(plugin_id, &state)?;
        emit_telemetry(app, plugin_id, "candidate_initialize", "promoted");
        Ok(status)
    }

    pub(crate) fn record_initialize_failure(
        &self,
        app: &AppHandle,
        plugin_id: AcpPluginId,
        installation_id: &str,
        reason: &str,
    ) -> AppResult<AcpPluginStatus> {
        let mut state = self.load_state()?;
        let candidate = {
            let record = state.plugins.get_mut(&plugin_id).ok_or_else(|| {
                AppError::NotFound(format!("{} ACP plugin", plugin_id.provider_slug()))
            })?;
            take_failed_candidate(record, installation_id, reason)?
        };
        // Persist the candidate deactivation before touching its files. A process-exit
        // race on Windows may delay the quarantine rename, but must never make the
        // failed candidate launchable again or hide the last-known-good fallback.
        self.write_state(&state)?;
        let status = self.project_status(plugin_id, &state)?;
        let Some(candidate) = candidate else {
            emit_telemetry(app, plugin_id, "session_initialize", "failed");
            return Ok(status);
        };
        self.quarantine_version(plugin_id, &candidate, reason)?;
        emit_telemetry(app, plugin_id, "candidate_initialize", "quarantined");
        Ok(status)
    }

    fn quarantine_version(
        &self,
        plugin_id: AcpPluginId,
        version: &InstalledPluginVersion,
        reason: &str,
    ) -> AppResult<()> {
        let source = self.installed_directory(plugin_id, version);
        if fs::symlink_metadata(&source).is_ok() {
            let destination_root = self
                .inner
                .root
                .join("quarantine")
                .join(plugin_id.provider_slug());
            prepare_directory(&destination_root)?;
            let destination = destination_root.join(format!(
                "{}-{}",
                version.adapter_bundle_version,
                Uuid::new_v4()
            ));
            fs::rename(source, destination)?;
            sync_directory(&destination_root);
        }
        let mut quarantine = self.load_quarantine()?;
        let records = quarantine.plugins.entry(plugin_id).or_default();
        records.push(QuarantinedPluginVersion {
            adapter_bundle_version: version.adapter_bundle_version.clone(),
            manifest_sha256: version.manifest_sha256.clone(),
            reason: bounded_failure(reason),
        });
        if records.len() > MAX_QUARANTINE_RECORDS_PER_PLUGIN {
            let remove = records.len() - MAX_QUARANTINE_RECORDS_PER_PLUGIN;
            records.drain(..remove);
        }
        self.write_quarantine(&quarantine)
    }

    fn project_status(
        &self,
        plugin_id: AcpPluginId,
        state: &PersistedRuntimeState,
    ) -> AppResult<AcpPluginStatus> {
        let record = state.plugins.get(&plugin_id).cloned().unwrap_or_default();
        let updates = self.load_available_updates()?;
        let available = updates
            .plugins
            .get(&plugin_id)
            .filter(|available| !record_contains_manifest(&record, &available.manifest_sha256));
        let phase = self
            .inner
            .phases
            .lock()
            .map_err(|_| AppError::Config("the ACP plugin phase registry is unavailable".into()))?
            .get(&plugin_id)
            .copied();
        let state = phase.unwrap_or_else(|| {
            if record.candidate.is_some() {
                AcpPluginInstallationState::Staged
            } else if available.is_some() {
                AcpPluginInstallationState::UpdateAvailable
            } else if record.current.is_some() || record.last_known_good.is_some() {
                AcpPluginInstallationState::Ready
            } else if record.failure.is_some() {
                AcpPluginInstallationState::Failed
            } else {
                AcpPluginInstallationState::NotInstalled
            }
        });
        let installed_release_id = record
            .candidate
            .as_ref()
            .or(record.current.as_ref())
            .or(record.last_known_good.as_ref())
            .and_then(|installed| {
                self.release_id_for_installed(plugin_id, installed)
                    .ok()
                    .flatten()
            });
        Ok(AcpPluginStatus {
            plugin_id,
            state,
            enabled: record.enabled,
            installed_version: record
                .current
                .as_ref()
                .map(|version| version.adapter_bundle_version.clone()),
            installed_release_id,
            candidate_version: record
                .candidate
                .as_ref()
                .map(|version| version.adapter_bundle_version.clone()),
            last_known_good_version: record
                .last_known_good
                .as_ref()
                .map(|version| version.adapter_bundle_version.clone()),
            available_version: available.map(|version| version.adapter_version.clone()),
            available_release_id: available.map(|version| version.release_id.clone()),
            failure: record.failure,
        })
    }

    fn release_id_for_installed(
        &self,
        plugin_id: AcpPluginId,
        installed: &InstalledPluginVersion,
    ) -> AppResult<Option<String>> {
        let directory = self.installed_directory(plugin_id, installed);
        let marker = self.read_installed_marker(&directory)?;
        verify_manifest(&marker.envelope)?;
        Ok(release_id_from_manifest(&marker.envelope, plugin_id))
    }

    fn record_failure(&self, plugin_id: AcpPluginId, failure: &str) -> AppResult<()> {
        let mut state = self.load_state()?;
        state.plugins.entry(plugin_id).or_default().failure = Some(bounded_failure(failure));
        self.write_state(&state)
    }

    fn set_phase(
        &self,
        plugin_id: AcpPluginId,
        phase: AcpPluginInstallationState,
    ) -> AppResult<()> {
        self.inner
            .phases
            .lock()
            .map_err(|_| AppError::Config("the ACP plugin phase registry is unavailable".into()))?
            .insert(plugin_id, phase);
        Ok(())
    }

    fn clear_phase(&self, plugin_id: AcpPluginId) {
        if let Ok(mut phases) = self.inner.phases.lock() {
            phases.remove(&plugin_id);
        }
    }
}

fn manifest_url(release_tag: &str, plugin_id: AcpPluginId) -> String {
    format!(
        "https://github.com/json-choi/dopedb/releases/download/{release_tag}/{}.manifest.json",
        plugin_id.provider_slug()
    )
}

fn artifact_url(release_tag: &str, plugin_id: AcpPluginId) -> String {
    format!(
        "https://github.com/json-choi/dopedb/releases/download/{release_tag}/{}.tar.gz",
        plugin_id.provider_slug()
    )
}

fn stable_catalog_tags(refs: Vec<GitHubTagRef>) -> Vec<String> {
    let mut releases = refs
        .into_iter()
        .filter_map(|reference| {
            catalog_release_version(&reference.reference).map(|version| {
                (
                    version,
                    reference.reference["refs/tags/".len()..].to_owned(),
                )
            })
        })
        .collect::<Vec<_>>();
    releases.sort_by_key(|release| std::cmp::Reverse(release.0));
    releases.dedup_by(|left, right| left.1 == right.1);
    releases.into_iter().map(|(_, tag)| tag).collect()
}

fn catalog_release_version(reference: &str) -> Option<(u32, u32, u32, u32)> {
    let value = reference.strip_prefix("refs/tags/acp-bundle-v")?;
    let segments = value.split('.').collect::<Vec<_>>();
    if segments.len() != 4
        || segments[0].len() != 4
        || segments[1].len() != 2
        || segments[2].len() != 2
        || segments
            .iter()
            .any(|segment| segment.is_empty() || !segment.bytes().all(|byte| byte.is_ascii_digit()))
        || (segments[3].len() > 1 && segments[3].starts_with('0'))
    {
        return None;
    }
    let year = segments[0].parse().ok()?;
    let month = segments[1].parse().ok()?;
    let day = segments[2].parse().ok()?;
    let sequence = segments[3].parse().ok()?;
    if sequence == 0 || chrono::NaiveDate::from_ymd_opt(year as i32, month, day).is_none() {
        return None;
    }
    Some((year, month, day, sequence))
}

fn safe_redirect(attempt: Attempt<'_>) -> reqwest::redirect::Action {
    if attempt.previous().len() >= 5 {
        return attempt.stop();
    }
    match attempt.url().host_str() {
        Some(
            "api.github.com"
            | "github.com"
            | "objects.githubusercontent.com"
            | "release-assets.githubusercontent.com",
        ) => attempt.follow(),
        _ => attempt.stop(),
    }
}

#[cfg(test)]
pub(super) fn assert_catalog_release_contract() {
    let tags = stable_catalog_tags(vec![
        GitHubTagRef {
            reference: "refs/tags/acp-bundle-v2026.08.09.9".into(),
        },
        GitHubTagRef {
            reference: "refs/tags/acp-bundle-v2026.08.09.10".into(),
        },
        GitHubTagRef {
            reference: "refs/tags/acp-bundle-v2026.08.10.1-candidate".into(),
        },
        GitHubTagRef {
            reference: "refs/tags/acp-bundle-v2026.02.30.1".into(),
        },
        GitHubTagRef {
            reference: "refs/tags/app-v0.3.34".into(),
        },
    ]);
    assert_eq!(
        tags,
        vec![
            "acp-bundle-v2026.08.09.10".to_owned(),
            "acp-bundle-v2026.08.09.9".to_owned(),
        ]
    );
    assert_eq!(
        artifact_url(&tags[0], AcpPluginId::Claude),
        "https://github.com/json-choi/dopedb/releases/download/acp-bundle-v2026.08.09.10/claude.tar.gz"
    );
}

fn emit_telemetry(
    app: &AppHandle,
    plugin_id: AcpPluginId,
    operation: &'static str,
    outcome: &'static str,
) {
    let _ = app.emit(
        "agent-plugin:telemetry",
        AcpPluginTelemetry {
            provider: plugin_id.provider_slug(),
            operation,
            outcome,
        },
    );
}

fn installation_matches(
    installed: &Option<InstalledPluginVersion>,
    envelope: &SignedAcpPluginManifestV1,
) -> bool {
    installed.as_ref().is_some_and(|installed| {
        installed.adapter_bundle_version == envelope.manifest.adapter_bundle_version
            && installed.manifest_sha256 == envelope.manifest_sha256
    })
}

fn record_contains_manifest(record: &PersistedPluginRecord, manifest_sha256: &str) -> bool {
    [
        record.current.as_ref(),
        record.candidate.as_ref(),
        record.last_known_good.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|installed| installed.manifest_sha256 == manifest_sha256)
}

fn available_update(
    record: &PersistedPluginRecord,
    release_id: String,
    envelope: &SignedAcpPluginManifestV1,
) -> Option<AvailablePluginVersion> {
    (!record_contains_manifest(record, &envelope.manifest_sha256)).then(|| AvailablePluginVersion {
        adapter_version: envelope.manifest.adapter_version.clone(),
        adapter_bundle_version: envelope.manifest.adapter_bundle_version.clone(),
        release_id,
        manifest_sha256: envelope.manifest_sha256.clone(),
    })
}

fn release_id_from_manifest(
    envelope: &SignedAcpPluginManifestV1,
    plugin_id: AcpPluginId,
) -> Option<String> {
    let prefix = "https://github.com/json-choi/dopedb/releases/download/";
    let suffix = format!("/{}.tar.gz", plugin_id.provider_slug());
    let release_id = envelope
        .manifest
        .artifact
        .url
        .strip_prefix(prefix)?
        .strip_suffix(&suffix)?;
    catalog_release_version(&format!("refs/tags/{release_id}"))?;
    (artifact_url(release_id, plugin_id) == envelope.manifest.artifact.url)
        .then(|| release_id.to_owned())
}

fn record_has_ready_fallback(record: &PersistedPluginRecord) -> bool {
    record.candidate.is_none()
        && record.failure.is_some()
        && (record.current.is_some() || record.last_known_good.is_some())
}

fn clear_obsolete_version_collision_failure(record: &mut PersistedPluginRecord) {
    if record.failure.as_deref() == Some(OBSOLETE_VERSION_COLLISION_FAILURE) {
        record.failure = None;
    }
}

fn take_failed_candidate(
    record: &mut PersistedPluginRecord,
    installation_id: &str,
    reason: &str,
) -> AppResult<Option<InstalledPluginVersion>> {
    let Some(candidate) = record.candidate.take() else {
        record.failure = Some(bounded_failure(reason));
        return Ok(None);
    };
    if candidate.manifest_sha256 != installation_id {
        record.candidate = Some(candidate);
        return Err(AppError::Blocked {
            reason: "the ACP plugin failure receipt changed candidate identity".into(),
        });
    }
    record.failure = Some(bounded_failure(reason));
    Ok(Some(candidate))
}

#[cfg(test)]
pub(super) fn assert_candidate_fallback_contract() {
    let stable = InstalledPluginVersion {
        adapter_bundle_version: "1.0.0".into(),
        manifest_sha256: "a".repeat(64),
        entrypoint_sha256: "b".repeat(64),
    };
    let candidate = InstalledPluginVersion {
        adapter_bundle_version: "1.0.0".into(),
        manifest_sha256: "c".repeat(64),
        entrypoint_sha256: "d".repeat(64),
    };
    let mut record = PersistedPluginRecord {
        enabled: true,
        current: Some(stable.clone()),
        candidate: Some(candidate.clone()),
        last_known_good: Some(stable),
        failure: None,
        last_checked_at: None,
    };

    let failed =
        take_failed_candidate(&mut record, &candidate.manifest_sha256, "startup timed out")
            .expect("the active candidate can be failed")
            .expect("the failed version remains available for quarantine");

    assert_eq!(failed, candidate);
    assert!(record.candidate.is_none());
    assert_eq!(
        record
            .current
            .as_ref()
            .map(|value| value.adapter_bundle_version.as_str()),
        Some("1.0.0")
    );
    assert_eq!(
        record
            .last_known_good
            .as_ref()
            .map(|value| value.adapter_bundle_version.as_str()),
        Some("1.0.0")
    );
    assert_eq!(record.failure.as_deref(), Some("startup timed out"));
    assert!(record_has_ready_fallback(&record));
}

#[cfg(test)]
pub(super) fn assert_installation_identity_contract() {
    let temporary = tempfile::tempdir().expect("temporary ACP plugin root is available");
    let manager = AcpPluginManager::with_root(temporary.path().join("plugins"))
        .expect("ACP plugin manager accepts a private temporary root");
    let stable = InstalledPluginVersion {
        adapter_bundle_version: "1.0.0".into(),
        manifest_sha256: "a".repeat(64),
        entrypoint_sha256: "b".repeat(64),
    };
    let rebuilt = InstalledPluginVersion {
        adapter_bundle_version: "1.0.0".into(),
        manifest_sha256: "c".repeat(64),
        entrypoint_sha256: "d".repeat(64),
    };

    assert_ne!(
        manager.content_directory(AcpPluginId::Claude, &stable.manifest_sha256),
        manager.content_directory(AcpPluginId::Claude, &rebuilt.manifest_sha256),
        "two signed distributions of one upstream version need distinct paths"
    );
    assert!(!record_contains_manifest(
        &PersistedPluginRecord {
            enabled: true,
            current: Some(stable.clone()),
            ..PersistedPluginRecord::default()
        },
        &rebuilt.manifest_sha256,
    ));

    let legacy =
        manager.legacy_version_directory(AcpPluginId::Claude, &stable.adapter_bundle_version);
    prepare_directory(&legacy).expect("legacy version directory can be represented");
    assert_eq!(
        manager.installed_directory(AcpPluginId::Claude, &stable),
        legacy,
        "an existing version-keyed install remains launchable"
    );

    let content = manager.content_directory(AcpPluginId::Claude, &stable.manifest_sha256);
    prepare_directory(&content).expect("content-addressed directory can be represented");
    assert_eq!(
        manager.installed_directory(AcpPluginId::Claude, &stable),
        content,
        "content-addressed storage takes precedence after migration"
    );
    let mut migrated = PersistedPluginRecord {
        failure: Some(OBSOLETE_VERSION_COLLISION_FAILURE.into()),
        ..PersistedPluginRecord::default()
    };
    clear_obsolete_version_collision_failure(&mut migrated);
    assert!(migrated.failure.is_none());

    let mut preserved = PersistedPluginRecord {
        failure: Some("network: artifact download failed".into()),
        ..PersistedPluginRecord::default()
    };
    clear_obsolete_version_collision_failure(&mut preserved);
    assert_eq!(
        preserved.failure.as_deref(),
        Some("network: artifact download failed"),
        "unrelated install failures remain visible"
    );
}
