//! ACP plugin catalog resolution, download, and installed-version management.

use super::*;

impl AcpPluginManager {
    pub(crate) async fn check_installed_updates(&self, app: &AppHandle) {
        if let Err(error) = self.check_updates(app, false).await {
            tracing::warn!(%error, "ACP plugin background update check was deferred");
        }
    }

    pub(crate) async fn check_updates(
        &self,
        app: &AppHandle,
        force: bool,
    ) -> AppResult<Vec<AcpPluginStatus>> {
        let _guard = self.inner.mutation.lock().await;
        let state = self.load_state()?;
        let now = chrono::Utc::now();
        let due = state
            .plugins
            .iter()
            .filter_map(|(plugin_id, record)| {
                let installed = record.current.is_some()
                    || record.candidate.is_some()
                    || record.last_known_good.is_some();
                let checked_recently = record
                    .last_checked_at
                    .as_deref()
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                    .is_some_and(|checked| {
                        now.signed_duration_since(checked.to_utc()) < UPDATE_CHECK_INTERVAL
                    });
                (installed && (force || (record.enabled && !checked_recently)))
                    .then_some(*plugin_id)
            })
            .collect::<Vec<_>>();
        let mut first_error = None;
        for plugin_id in due {
            emit_telemetry(app, plugin_id, "check_update", "started");
            self.set_phase(plugin_id, AcpPluginInstallationState::Checking)?;
            let result = self.check_update_locked(app, plugin_id).await;
            self.clear_phase(plugin_id);
            emit_telemetry(
                app,
                plugin_id,
                "check_update",
                if result.is_ok() {
                    "succeeded"
                } else {
                    "failed"
                },
            );
            if let Err(error) = result {
                first_error.get_or_insert(error);
            }
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        self.statuses()
    }

    async fn check_update_locked(&self, app: &AppHandle, plugin_id: AcpPluginId) -> AppResult<()> {
        let (release_id, envelope) = self.verified_manifest(app, plugin_id, None).await?;
        let mut state = self.load_state()?;
        let record = state.plugins.entry(plugin_id).or_default();
        let mut updates = self.load_available_updates()?;
        if let Some(available) = available_update(record, release_id, &envelope) {
            updates.plugins.insert(plugin_id, available);
        } else {
            updates.plugins.remove(&plugin_id);
        }
        record.last_checked_at = Some(chrono::Utc::now().to_rfc3339());
        self.write_available_updates(&updates)?;
        self.write_state(&state)
    }

    async fn verified_manifest(
        &self,
        app: &AppHandle,
        plugin_id: AcpPluginId,
        expected: Option<&AvailablePluginVersion>,
    ) -> AppResult<(String, SignedAcpPluginManifestV2)> {
        let (release_id, manifest_bytes) = if let Some(expected) = expected {
            let bytes = self
                .try_download_manifest(&expected.release_id, plugin_id)
                .await?
                .ok_or_else(|| {
                    AppError::Network("the selected ACP plugin release is unavailable".into())
                })?;
            (expected.release_id.clone(), bytes)
        } else {
            self.download_manifest(plugin_id).await?
        };
        let envelope: SignedAcpPluginManifestV2 = serde_json::from_slice(&manifest_bytes)
            .map_err(|_| AppError::Network("the ACP plugin manifest is invalid".into()))?;
        if envelope.manifest.plugin_id != plugin_id {
            return Err(AppError::Blocked {
                reason: "the ACP plugin manifest changed the requested plugin identity".into(),
            });
        }
        verify_manifest(&envelope)?;
        if envelope.manifest.artifact.url != artifact_url(&release_id, plugin_id) {
            return Err(AppError::Blocked {
                reason: "the ACP plugin manifest does not belong to its stable release".into(),
            });
        }
        if expected.is_some_and(|expected| {
            expected.manifest_sha256 != envelope.manifest_sha256
                || expected.adapter_version != envelope.manifest.adapter_version
                || expected.adapter_bundle_version != envelope.manifest.adapter_bundle_version
        }) {
            return Err(AppError::Blocked {
                reason: "the selected ACP plugin update changed after review".into(),
            });
        }
        let runtime = verify_bundled_node(app)?;
        verify_compatibility(&envelope.manifest, &runtime)?;
        Ok((release_id, envelope))
    }

    pub(crate) async fn install(
        &self,
        app: &AppHandle,
        plugin_id: AcpPluginId,
    ) -> AppResult<AcpPluginMutationReceipt> {
        emit_telemetry(app, plugin_id, "install_update", "started");
        let _guard = self.inner.mutation.lock().await;
        self.set_phase(plugin_id, AcpPluginInstallationState::Checking)?;
        let result = self.install_locked(app, plugin_id).await;
        self.clear_phase(plugin_id);
        match result {
            Ok(receipt) => {
                emit_telemetry(app, plugin_id, "install_update", "succeeded");
                Ok(receipt)
            }
            Err(error) => {
                let _ = self.record_failure(plugin_id, &error.to_string());
                emit_telemetry(app, plugin_id, "install_update", "failed");
                Err(error)
            }
        }
    }

    async fn install_locked(
        &self,
        app: &AppHandle,
        plugin_id: AcpPluginId,
    ) -> AppResult<AcpPluginMutationReceipt> {
        let updates = self.load_available_updates()?;
        let expected = updates.plugins.get(&plugin_id);
        let (_release_id, envelope) = self.verified_manifest(app, plugin_id, expected).await?;

        let mut state = self.load_state()?;
        let before = state.plugins.get(&plugin_id).cloned().unwrap_or_default();
        if installation_matches(&before.current, &envelope)
            || installation_matches(&before.candidate, &envelope)
        {
            let record = state.plugins.entry(plugin_id).or_default();
            record.enabled = true;
            record.failure = None;
            record.last_checked_at = Some(chrono::Utc::now().to_rfc3339());
            self.write_state(&state)?;
            self.clear_available_update(plugin_id)?;
            return Ok(AcpPluginMutationReceipt {
                changed: false,
                status: self.project_status(plugin_id, &state)?,
            });
        }

        self.set_phase(plugin_id, AcpPluginInstallationState::Downloading)?;
        let download = self.download_artifact(&envelope).await?;
        self.set_phase(plugin_id, AcpPluginInstallationState::Verifying)?;
        if let Err(error) = verify_artifact(&download, &envelope.manifest) {
            let _ = fs::remove_file(&download);
            return Err(error);
        }

        let stage = self.inner.root.join("staging").join(format!(
            "{}-{}",
            plugin_id.provider_slug(),
            Uuid::new_v4()
        ));
        prepare_new_directory(&stage)?;
        let prepared = (|| -> AppResult<InstalledPluginVersion> {
            let entrypoint_sha256 =
                extract_verified_archive(&download, &stage, &envelope.manifest)?;
            let installed = InstalledPluginVersion {
                adapter_bundle_version: envelope.manifest.adapter_bundle_version.clone(),
                manifest_sha256: envelope.manifest_sha256.clone(),
                entrypoint_sha256: entrypoint_sha256.clone(),
            };
            write_new_json(
                &stage.join("installed.json"),
                &InstalledPluginMarker {
                    schema_version: RUNTIME_STATE_SCHEMA_VERSION,
                    envelope: envelope.clone(),
                    entrypoint_sha256,
                },
            )?;
            sync_directory(&stage);
            Ok(installed)
        })();
        let installed = match prepared {
            Ok(installed) => installed,
            Err(error) => {
                let _ = remove_owned_tree(&self.inner.root, &stage);
                let _ = fs::remove_file(&download);
                return Err(error);
            }
        };

        let target = self.content_directory(plugin_id, &installed.manifest_sha256);
        if fs::symlink_metadata(&target).is_ok() {
            prepare_directory(&target)?;
            let existing = self.read_installed_marker(&target)?;
            if existing.envelope.manifest_sha256 != installed.manifest_sha256
                || existing.entrypoint_sha256 != installed.entrypoint_sha256
            {
                let _ = remove_owned_tree(&self.inner.root, &stage);
                let _ = fs::remove_file(&download);
                return Err(AppError::Blocked {
                    reason: "an ACP plugin installation conflicts with its signed digest".into(),
                });
            }
            remove_owned_tree(&self.inner.root, &stage)?;
        } else {
            prepare_directory(target.parent().ok_or_else(|| {
                AppError::Config("the ACP plugin version has no provider directory".into())
            })?)?;
            fs::rename(&stage, &target)?;
            sync_directory(target.parent().expect("provider directory was checked"));
        }
        let _ = fs::remove_file(&download);

        let record = state.plugins.entry(plugin_id).or_default();
        record.enabled = true;
        record.candidate = Some(installed);
        record.failure = None;
        record.last_checked_at = Some(chrono::Utc::now().to_rfc3339());
        self.write_state(&state)?;
        self.clear_available_update(plugin_id)?;
        self.prune_unreferenced_versions(plugin_id, &state)?;
        self.set_phase(plugin_id, AcpPluginInstallationState::Staged)?;
        Ok(AcpPluginMutationReceipt {
            changed: true,
            status: self.project_status(plugin_id, &state)?,
        })
    }

    pub(super) async fn download_manifest(
        &self,
        plugin_id: AcpPluginId,
    ) -> AppResult<(String, Vec<u8>)> {
        if let Some(tag) = self.cached_catalog_release()? {
            if let Some(bytes) = self.try_download_manifest(&tag, plugin_id).await? {
                return Ok((tag, bytes));
            }
            self.clear_cached_catalog_release(&tag)?;
        }

        let refs = self
            .download_bounded(
                self.inner
                    .client
                    .get(CATALOG_REFS_URL)
                    .header(reqwest::header::ACCEPT, "application/vnd.github+json")
                    .header("X-GitHub-Api-Version", "2022-11-28"),
                MAX_CATALOG_REFS_BYTES,
                "catalog index",
                false,
            )
            .await?
            .ok_or_else(|| AppError::Network("the ACP plugin catalog index is missing".into()))?;
        let refs: Vec<GitHubTagRef> = serde_json::from_slice(&refs)
            .map_err(|_| AppError::Network("the ACP plugin catalog index is invalid".into()))?;
        if refs.len() > MAX_CATALOG_REFS {
            return Err(AppError::Network(
                "the ACP plugin catalog index has too many releases".into(),
            ));
        }

        for tag in stable_catalog_tags(refs)
            .into_iter()
            .take(MAX_CATALOG_RELEASE_FALLBACKS)
        {
            if let Some(bytes) = self.try_download_manifest(&tag, plugin_id).await? {
                self.cache_catalog_release(tag.clone())?;
                return Ok((tag, bytes));
            }
        }
        Err(AppError::Network(
            "no published stable ACP plugin release contains this adapter".into(),
        ))
    }

    pub(super) async fn try_download_manifest(
        &self,
        release_tag: &str,
        plugin_id: AcpPluginId,
    ) -> AppResult<Option<Vec<u8>>> {
        self.download_bounded(
            self.inner.client.get(manifest_url(release_tag, plugin_id)),
            MAX_MANIFEST_BYTES,
            "manifest",
            true,
        )
        .await
    }

    pub(super) fn cached_catalog_release(&self) -> AppResult<Option<String>> {
        let cached =
            self.inner.catalog_release.lock().map_err(|_| {
                AppError::Config("the ACP plugin catalog cache is unavailable".into())
            })?;
        Ok(cached
            .as_ref()
            .filter(|entry| entry.resolved_at.elapsed() < CATALOG_RESOLUTION_TTL)
            .map(|entry| entry.tag.clone()))
    }

    pub(super) fn cache_catalog_release(&self, tag: String) -> AppResult<()> {
        *self.inner.catalog_release.lock().map_err(|_| {
            AppError::Config("the ACP plugin catalog cache is unavailable".into())
        })? = Some(CachedCatalogRelease {
            tag,
            resolved_at: Instant::now(),
        });
        Ok(())
    }

    pub(super) fn clear_cached_catalog_release(&self, tag: &str) -> AppResult<()> {
        let mut cached =
            self.inner.catalog_release.lock().map_err(|_| {
                AppError::Config("the ACP plugin catalog cache is unavailable".into())
            })?;
        if cached.as_ref().is_some_and(|entry| entry.tag == tag) {
            *cached = None;
        }
        Ok(())
    }

    pub(super) async fn download_bounded(
        &self,
        request: reqwest::RequestBuilder,
        maximum: u64,
        resource: &str,
        allow_not_found: bool,
    ) -> AppResult<Option<Vec<u8>>> {
        let response = request
            .send()
            .await
            .map_err(|_| AppError::Network(format!("the ACP plugin {resource} request failed")))?;
        if allow_not_found && response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "the ACP plugin {resource} request returned HTTP {}",
                response.status().as_u16()
            )));
        }
        if response
            .content_length()
            .is_some_and(|length| length > maximum)
        {
            return Err(AppError::Network(format!(
                "the ACP plugin {resource} is too large"
            )));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| {
                AppError::Network(format!("the ACP plugin {resource} stream failed"))
            })?;
            if bytes.len().saturating_add(chunk.len()) > maximum as usize {
                return Err(AppError::Network(format!(
                    "the ACP plugin {resource} is too large"
                )));
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() {
            return Err(AppError::Network(format!(
                "the ACP plugin {resource} is empty"
            )));
        }
        Ok(Some(bytes))
    }

    pub(super) async fn download_artifact(
        &self,
        envelope: &SignedAcpPluginManifestV2,
    ) -> AppResult<PathBuf> {
        let path = self.inner.root.join("downloads").join(format!(
            "{}-{}.partial",
            envelope.manifest.plugin_id.provider_slug(),
            Uuid::new_v4()
        ));
        let response = self
            .inner
            .client
            .get(&envelope.manifest.artifact.url)
            .send()
            .await
            .map_err(|_| AppError::Network("the ACP plugin artifact request failed".into()))?;
        if !response.status().is_success() {
            return Err(AppError::Network(format!(
                "the ACP plugin artifact request returned HTTP {}",
                response.status().as_u16()
            )));
        }
        let expected = envelope.manifest.artifact.packed_bytes;
        if response
            .content_length()
            .is_some_and(|length| length != expected)
        {
            return Err(AppError::Network(
                "the ACP plugin artifact length does not match its manifest".into(),
            ));
        }
        let mut options = tokio::fs::OpenOptions::new();
        options.create_new(true).write(true);
        let mut output = options.open(&path).await?;
        let result = async {
            let mut written = 0u64;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| {
                    AppError::Network("the ACP plugin artifact stream failed".into())
                })?;
                written = written.checked_add(chunk.len() as u64).ok_or_else(|| {
                    AppError::Network("the ACP plugin artifact length overflowed".into())
                })?;
                if written > expected {
                    return Err(AppError::Network(
                        "the ACP plugin artifact exceeded its signed size".into(),
                    ));
                }
                output.write_all(&chunk).await?;
            }
            output.flush().await?;
            output.sync_all().await?;
            if written != expected {
                return Err(AppError::Network(
                    "the ACP plugin artifact ended before its signed size".into(),
                ));
            }
            Ok(())
        }
        .await;
        drop(output);
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(error);
        }
        Ok(path)
    }

    pub(super) fn load_state(&self) -> AppResult<PersistedRuntimeState> {
        load_json_or_default(&self.inner.root.join("active.json"))
    }

    pub(super) fn write_state(&self, state: &PersistedRuntimeState) -> AppResult<()> {
        validate_state(state)?;
        write_json_atomic(&self.inner.root.join("active.json"), state)
    }

    pub(super) fn load_available_updates(&self) -> AppResult<PersistedAvailableUpdates> {
        let state = load_json_or_default(&self.inner.root.join("updates.json"))?;
        validate_available_updates(&state)?;
        Ok(state)
    }

    pub(super) fn write_available_updates(
        &self,
        state: &PersistedAvailableUpdates,
    ) -> AppResult<()> {
        validate_available_updates(state)?;
        write_json_atomic(&self.inner.root.join("updates.json"), state)
    }

    pub(super) fn clear_available_update(&self, plugin_id: AcpPluginId) -> AppResult<()> {
        let mut state = self.load_available_updates()?;
        if state.plugins.remove(&plugin_id).is_some() {
            self.write_available_updates(&state)?;
        }
        Ok(())
    }

    pub(super) fn load_quarantine(&self) -> AppResult<PersistedQuarantineState> {
        load_json_or_default(&self.inner.root.join("quarantine.json"))
    }

    pub(super) fn write_quarantine(&self, state: &PersistedQuarantineState) -> AppResult<()> {
        if state.schema_version != RUNTIME_STATE_SCHEMA_VERSION
            || state
                .plugins
                .values()
                .any(|records| records.len() > MAX_QUARANTINE_RECORDS_PER_PLUGIN)
        {
            return Err(AppError::Config(
                "the ACP plugin quarantine state is invalid".into(),
            ));
        }
        write_json_atomic(&self.inner.root.join("quarantine.json"), state)
    }

    pub(super) fn provider_directory(&self, plugin_id: AcpPluginId) -> PathBuf {
        self.inner.root.join(plugin_id.provider_slug())
    }

    pub(super) fn content_directory(
        &self,
        plugin_id: AcpPluginId,
        manifest_sha256: &str,
    ) -> PathBuf {
        self.provider_directory(plugin_id).join(manifest_sha256)
    }

    pub(super) fn installed_directory(
        &self,
        plugin_id: AcpPluginId,
        installed: &InstalledPluginVersion,
    ) -> PathBuf {
        self.content_directory(plugin_id, &installed.manifest_sha256)
    }

    pub(super) fn read_installed_marker(
        &self,
        directory: &Path,
    ) -> AppResult<InstalledPluginMarker> {
        let directory_metadata = fs::symlink_metadata(directory)?;
        if !directory_metadata.file_type().is_dir() {
            return Err(AppError::Blocked {
                reason: "the installed ACP plugin path is not a directory".into(),
            });
        }
        let marker: InstalledPluginMarker = read_json(&directory.join("installed.json"))?;
        if marker.schema_version != RUNTIME_STATE_SCHEMA_VERSION
            || !marker.envelope.validate_shape()
            || !valid_digest(&marker.entrypoint_sha256)
        {
            return Err(AppError::Blocked {
                reason: "the installed ACP plugin marker is invalid".into(),
            });
        }
        Ok(marker)
    }

    pub(super) fn prune_unreferenced_versions(
        &self,
        plugin_id: AcpPluginId,
        state: &PersistedRuntimeState,
    ) -> AppResult<()> {
        let Some(record) = state.plugins.get(&plugin_id) else {
            return Ok(());
        };
        let referenced = [
            record.current.as_ref(),
            record.candidate.as_ref(),
            record.last_known_good.as_ref(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        let keep = referenced
            .iter()
            .map(|installed| installed.manifest_sha256.as_str())
            .collect::<BTreeSet<_>>();
        let provider = self.provider_directory(plugin_id);
        let entries = match fs::read_dir(&provider) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_str().ok_or_else(|| AppError::Blocked {
                reason: "an ACP plugin version directory is not Unicode".into(),
            })?;
            if !keep.contains(name) {
                remove_owned_tree(&self.inner.root, &entry.path())?;
            }
        }
        Ok(())
    }

    pub(super) fn remove_staging_for(&self, plugin_id: AcpPluginId) -> AppResult<()> {
        remove_prefixed_children(
            &self.inner.root,
            &self.inner.root.join("staging"),
            &format!("{}-", plugin_id.provider_slug()),
        )
    }

    pub(super) fn remove_quarantine_for(&self, plugin_id: AcpPluginId) -> AppResult<()> {
        let path = self
            .inner
            .root
            .join("quarantine")
            .join(plugin_id.provider_slug());
        if fs::symlink_metadata(&path).is_ok() {
            remove_owned_tree(&self.inner.root, &path)?;
        }
        Ok(())
    }
}
