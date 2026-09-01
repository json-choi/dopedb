//! Connection context admission, leasing, and exact-scope authorization.

use super::*;

impl ConnectionContext {
    pub(crate) fn pin(&self) -> &PinnedConnection {
        &self.pin
    }

    pub(crate) async fn connect(self) -> AppResult<ConnectionLease> {
        self.connect_to_database(None).await
    }

    /// Open the same authorized server identity against one selected database.
    ///
    /// The durable profile, workspace/account pin, credential binding, and RBAC
    /// generation remain authoritative. Only the target database varies, and it is
    /// part of the pool cache identity so a lease can never receive a pool opened for
    /// another database.
    pub(crate) async fn connect_to_database(
        mut self,
        database: Option<String>,
    ) -> AppResult<ConnectionLease> {
        let target_database =
            resolve_target_database(&self.pin.profile, database.as_deref(), &self.authorization)?;
        let mut target_profile = self.pin.profile.clone();
        target_profile.database.clone_from(&target_database);
        'reopen: loop {
            if self.provider_binding_fence_epoch != self.manager.provider_binding_fence_epoch() {
                self.authorization = authorize_pin(
                    self.manager.inner.remote_authority.as_ref(),
                    self.manager.inner.provider_local.as_ref(),
                    &self.pin,
                    self.access,
                )
                .await?;
                self.provider_binding_fence_epoch = self.manager.provider_binding_fence_epoch();
                // A fence may have raced the reauthorization. Restart rather
                // than hand an old binding identity to cache admission.
                if self.provider_binding_fence_epoch != self.manager.provider_binding_fence_epoch()
                {
                    continue;
                }
            }
            let key = ConnectionCacheKey::new(
                &self.pin,
                self.access,
                self.authorization.provider_local_target.as_ref(),
                self.authorization.provider_local_pin.as_ref(),
                &target_database,
            );
            let slot = self
                .manager
                .inner
                .slots
                .entry(key.clone())
                .or_insert_with(|| Arc::new(Mutex::new(ConnectionSlot::default())))
                .clone();
            // `authorize_pin` completed immediately before this lookup. Preserve
            // that fresh response only while the slot can be acquired without an
            // await. Contention, retirement, or pool opening keeps the existing
            // reauthorization path so revocation and generation changes remain
            // fail-closed at the eventual hand-off.
            let mut authority_requires_refresh = false;

            loop {
                let mut state = match slot.try_lock() {
                    Ok(state) => state,
                    Err(_) => {
                        authority_requires_refresh = true;
                        slot.lock().await
                    }
                };
                if let Some(entry) = state.entry.as_ref() {
                    let is_expired = cache_entry_expired(entry);
                    if !is_expired {
                        let entry = Arc::clone(entry);
                        drop(state);
                        // A contended slot may have spent meaningful time waiting
                        // for another task to open or retire a pool. Refresh only in
                        // that case; an immediate hit already carries the response
                        // obtained at this hand-off boundary.
                        if self.pin.requires_remote_rbac {
                            let refreshed = if cached_handoff_needs_remote_refresh(
                                true,
                                authority_requires_refresh,
                            ) {
                                Some(
                                    match authorize_pin(
                                        self.manager.inner.remote_authority.as_ref(),
                                        self.manager.inner.provider_local.as_ref(),
                                        &self.pin,
                                        self.access,
                                    )
                                    .await
                                    {
                                        Ok(refreshed) => refreshed,
                                        Err(error) => {
                                            // A provider-local revocation or pin failure is a cache
                                            // revocation, not merely a failed request. Detach before
                                            // returning so no later caller can receive this pool.
                                            drop(entry);
                                            let retired =
                                                self.manager.detach_keys(vec![key.clone()]).await;
                                            retire_entries(retired).await;
                                            return Err(error);
                                        }
                                    },
                                )
                            } else {
                                None
                            };
                            let handoff_authorization =
                                refreshed.as_ref().unwrap_or(&self.authorization);
                            let cache_identity_changed = ConnectionCacheKey::new(
                                &self.pin,
                                self.access,
                                handoff_authorization.provider_local_target.as_ref(),
                                handoff_authorization.provider_local_pin.as_ref(),
                                &target_database,
                            ) != key;
                            let target_expiry_shrank = provider_target_expiry_shrank(
                                &entry,
                                handoff_authorization.provider_local_target.as_ref(),
                            )?;
                            if cache_identity_changed {
                                drop(entry);
                                let retired = self.manager.detach_keys(vec![key.clone()]).await;
                                retire_entries(retired).await;
                                if let Some(refreshed) = refreshed {
                                    self.authorization = refreshed;
                                }
                                continue 'reopen;
                            }
                            if target_expiry_shrank {
                                let retired = {
                                    let mut state = slot.lock().await;
                                    if state
                                        .entry
                                        .as_ref()
                                        .is_some_and(|current| Arc::ptr_eq(current, &entry))
                                    {
                                        state.entry.take()
                                    } else {
                                        None
                                    }
                                };
                                drop(entry);
                                if let Some(retired) = retired {
                                    retire_entries(vec![retired]).await;
                                }
                                if let Some(refreshed) = refreshed {
                                    self.authorization = refreshed;
                                }
                                continue 'reopen;
                            }
                            if let Some(refreshed) = refreshed {
                                self.authorization = refreshed;
                            }
                            self.provider_binding_fence_epoch =
                                self.manager.provider_binding_fence_epoch();
                        }
                        if !self.manager.pin_is_current(&self.pin).await? {
                            return Err(scope_changed());
                        }
                        if self.provider_binding_fence_epoch
                            != self.manager.provider_binding_fence_epoch()
                        {
                            drop(entry);
                            continue 'reopen;
                        }
                        // Online authorization can outlive the retirement timer. Check
                        // again at the exact hand-off boundary and detach only this
                        // generation; never return a lease whose safety margin elapsed.
                        if cache_entry_expired(&entry) {
                            let retired = {
                                let mut state = slot.lock().await;
                                if state
                                    .entry
                                    .as_ref()
                                    .is_some_and(|current| Arc::ptr_eq(current, &entry))
                                {
                                    state.entry.take()
                                } else {
                                    None
                                }
                            };
                            drop(entry);
                            if let Some(retired) = retired {
                                retire_entries(vec![retired]).await;
                            }
                            continue;
                        }
                        // A cache hit releases the slot while it reauthorizes. Another
                        // caller can revoke or rotate this exact generation during that
                        // await, detach it, and leave us holding the last Arc. Reacquire
                        // the original slot at the final linearization point: only the
                        // still-mapped Arc with the same immutable generation may escape
                        // as a lease. This also prevents an ABA replacement under `key`.
                        let entry_generation = entry.generation;
                        let is_current_handoff = {
                            let state = slot.lock().await;
                            state.entry.as_ref().is_some_and(|current| {
                                Arc::ptr_eq(current, &entry)
                                    && current.generation == entry_generation
                                    && !cache_entry_expired(current)
                                    && self.provider_binding_fence_epoch
                                        == self.manager.provider_binding_fence_epoch()
                            })
                        };
                        if !is_current_handoff {
                            drop(entry);
                            continue 'reopen;
                        }
                        return Ok(ConnectionLease {
                            pin: self.pin,
                            target_database,
                            entry,
                            _scope_guard: self
                                .scope_guard
                                .take()
                                .expect("connection context owns one scope guard"),
                        });
                    }
                }

                if let Some(error) = state.managed_open_retry_error() {
                    drop(state);
                    return Err(error);
                }

                let expired = state.entry.take();
                if expired.is_some() {
                    drop(state);
                    retire_entries(expired.into_iter().collect()).await;
                    authority_requires_refresh = true;
                    continue;
                }

                let opened = connect_authorized(
                    Arc::clone(&self.manager.inner.remote_authority),
                    Arc::clone(&self.manager.inner.provider_local),
                    &self.pin,
                    &target_profile,
                    &self.authorization,
                    self.access,
                )
                .await;
                let opened = match opened {
                    Ok(opened) => opened,
                    Err(error) => {
                        if self.pin.profile.credential_mode == WorkspaceCredentialMode::Managed {
                            state.remember_managed_open_failure(&error);
                        }
                        drop(state);
                        return Err(error);
                    }
                };
                state.clear_managed_open_failure();
                if self.pin.requires_remote_rbac {
                    let reauthorized = match authorize_pin(
                        self.manager.inner.remote_authority.as_ref(),
                        self.manager.inner.provider_local.as_ref(),
                        &self.pin,
                        self.access,
                    )
                    .await
                    {
                        Ok(value) => value,
                        Err(error) => {
                            drop(state);
                            retire_opened(opened).await;
                            return Err(error);
                        }
                    };
                    if ConnectionCacheKey::new(
                        &self.pin,
                        self.access,
                        reauthorized.provider_local_target.as_ref(),
                        reauthorized.provider_local_pin.as_ref(),
                        &target_database,
                    ) != key
                    {
                        drop(state);
                        retire_opened(opened).await;
                        self.authorization = reauthorized;
                        continue 'reopen;
                    }
                    if opened_provider_target_expiry_shrank(
                        &opened,
                        reauthorized.provider_local_target.as_ref(),
                    )? {
                        drop(state);
                        retire_opened(opened).await;
                        self.authorization = reauthorized;
                        continue 'reopen;
                    }
                    self.authorization = reauthorized;
                    self.provider_binding_fence_epoch = self.manager.provider_binding_fence_epoch();
                }
                match self.manager.pin_is_current(&self.pin).await {
                    Ok(true) => {}
                    Ok(false) => {
                        drop(state);
                        retire_opened(opened).await;
                        return Err(scope_changed());
                    }
                    Err(error) => {
                        drop(state);
                        retire_opened(opened).await;
                        return Err(error);
                    }
                }

                let generation = self
                    .manager
                    .inner
                    .next_generation
                    .fetch_add(1, Ordering::Relaxed);
                if self.provider_binding_fence_epoch != self.manager.provider_binding_fence_epoch()
                {
                    drop(state);
                    retire_opened(opened).await;
                    continue 'reopen;
                }
                if opened
                    .retire_at
                    .is_some_and(|retire_at| retire_at <= Instant::now())
                {
                    drop(state);
                    retire_opened(opened).await;
                    return Err(AppError::Network(
                        "managed database access expired while opening the connection".into(),
                    ));
                }
                let OpenedLive {
                    live,
                    retire_at,
                    managed_lease,
                    ssh_tunnel,
                    cloud_sql_proxy,
                } = opened;
                let entry = Arc::new(CacheEntry {
                    live,
                    generation,
                    retire_at,
                    managed_lease: StdMutex::new(managed_lease),
                    ssh_tunnel: StdMutex::new(ssh_tunnel),
                    cloud_sql_proxy: StdMutex::new(cloud_sql_proxy),
                    closed: AtomicBool::new(false),
                });
                if self.access == ConnectionAccess::Schema {
                    // Keep elevated schema authority operation-scoped. Dropping
                    // the returned lease closes the pool and releases the provider
                    // role instead of leaving a reusable DDL session in the cache.
                    drop(state);
                } else {
                    state.entry = Some(Arc::clone(&entry));
                    drop(state);
                    if let Some(retire_at) = retire_at {
                        schedule_expiry(
                            slot,
                            generation,
                            retire_at.saturating_duration_since(Instant::now()),
                        );
                    }
                }
                return Ok(ConnectionLease {
                    pin: self.pin,
                    target_database,
                    entry,
                    _scope_guard: self
                        .scope_guard
                        .take()
                        .expect("connection context owns one scope guard"),
                });
            }
        }
    }

    /// Open and close an uncached pool while retaining the exact scope pin for the
    /// complete reachability check. Connection-form tests intentionally do not warm
    /// the shared pool cache.
    pub(crate) async fn test_fresh(self) -> AppResult<()> {
        let opened = connect_authorized(
            Arc::clone(&self.manager.inner.remote_authority),
            Arc::clone(&self.manager.inner.provider_local),
            &self.pin,
            &self.pin.profile,
            &self.authorization,
            self.access,
        )
        .await?;
        if self.pin.requires_remote_rbac {
            let refreshed = match authorize_pin(
                self.manager.inner.remote_authority.as_ref(),
                self.manager.inner.provider_local.as_ref(),
                &self.pin,
                self.access,
            )
            .await
            {
                Ok(value) => value,
                Err(error) => {
                    retire_opened(opened).await;
                    return Err(error);
                }
            };
            if ConnectionCacheKey::new(
                &self.pin,
                self.access,
                self.authorization.provider_local_target.as_ref(),
                self.authorization.provider_local_pin.as_ref(),
                &self.pin.profile.database,
            ) != ConnectionCacheKey::new(
                &self.pin,
                self.access,
                refreshed.provider_local_target.as_ref(),
                refreshed.provider_local_pin.as_ref(),
                &self.pin.profile.database,
            ) || opened_provider_target_expiry_shrank(
                &opened,
                refreshed.provider_local_target.as_ref(),
            )? {
                retire_opened(opened).await;
                return Err(scope_changed());
            }
        }
        let pin_is_current = match self.manager.pin_is_current(&self.pin).await {
            Ok(current) => current,
            Err(error) => {
                retire_opened(opened).await;
                return Err(error);
            }
        };
        if !pin_is_current
            || opened
                .retire_at
                .is_some_and(|retire_at| retire_at <= Instant::now())
        {
            retire_opened(opened).await;
            return Err(scope_changed());
        }
        let result = async {
            opened.live.test().await?;
            if self.access.is_mutation() {
                let live = opened.live.sql()?;
                if !live.has_writable_pool {
                    return Err(AppError::Blocked {
                        reason: "managed write credential did not open a writable pool".into(),
                    });
                }
                live.write_pool.ping().await?;
            }
            if self.pin.profile.provider == Provider::PlanetScale {
                verify_planetscale_policy(&opened.live, self.pin.profile.engine, self.access)
                    .await?;
            } else if self.pin.profile.provider == Provider::Neon {
                verify_neon_policy(&opened.live, self.pin.profile.engine, self.access).await?;
            } else if self.pin.profile.provider == Provider::GcpCloudSql {
                verify_gcp_cloud_sql_policy(
                    &opened.live,
                    self.pin.profile.engine,
                    self.access,
                    &self.pin.profile.database,
                )
                .await?;
            }
            Ok(())
        }
        .await;
        retire_opened(opened).await;
        result
    }
}
