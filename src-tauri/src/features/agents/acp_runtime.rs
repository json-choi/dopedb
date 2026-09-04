//! ACP session admission, lifecycle commands, and runtime coordination.

use super::*;

impl AcpRuntime {
    pub(crate) fn new(store: Store, knowledge: KnowledgeFeature, broker: BrokerRuntime) -> Self {
        Self {
            sessions_persistence: Arc::new(StoreAcpSessionPersistence::new(store)),
            knowledge_scope: Arc::new(FeatureKnowledgeScopePort::new(knowledge)),
            broker,
            sessions: Arc::new(DashMap::new()),
            persistence: Arc::new(PersistenceTracker::default()),
        }
    }

    pub(crate) async fn list(&self) -> AppResult<Vec<AcpSessionSummary>> {
        let current_scope = self.sessions_persistence.active_resource_scope().await?;
        let mut sessions = self
            .sessions_persistence
            .list_sessions()
            .await?
            .into_iter()
            .map(|session| {
                let id = session.id;
                let session = if self.sessions.contains_key(&id) {
                    session
                } else {
                    detached_session_projection(session)
                };
                (id, session)
            })
            .collect::<HashMap<_, _>>();
        for entry in self.sessions.iter() {
            if same_storage_scope(&entry.value().storage_scope, &current_scope) {
                let summary = entry.value().summary();
                sessions.insert(summary.id, summary);
            }
        }
        let mut sessions = sessions.into_values().collect::<Vec<_>>();
        sessions.sort_by_key(|session| session.created_at);
        Ok(sessions)
    }

    pub(crate) async fn focus(
        &self,
        id: AcpSessionId,
        after_sequence: Option<u64>,
    ) -> AppResult<AcpSessionFocus> {
        let current_scope = self.sessions_persistence.active_resource_scope().await?;
        if let Some(session) = self.sessions.get(&id) {
            if same_storage_scope(&session.storage_scope, &current_scope) {
                return session.focus(after_sequence);
            }
        }
        self.sessions_persistence
            .focus_session(id, after_sequence)
            .await
            .map(detached_focus_projection)
    }

    pub(crate) async fn start(
        &self,
        connection_id: ConnectionId,
        provider: AgentProvider,
        resources: AcpResourceRequest,
        ports: DesktopAcpRuntimePorts,
    ) -> AppResult<AcpSessionFocus> {
        let first = self
            .launch(connection_id, provider, resources.clone(), &ports, None)
            .await;
        if first.is_err() && ports.process.has_ready_fallback(provider)? {
            return self
                .launch(connection_id, provider, resources, &ports, None)
                .await;
        }
        first
    }

    pub(crate) async fn resume(
        &self,
        id: AcpSessionId,
        ports: DesktopAcpRuntimePorts,
    ) -> AppResult<AcpSessionFocus> {
        if let Some(existing) = self.sessions.get(&id) {
            if !matches!(
                existing.summary().lifecycle,
                AcpSessionLifecycle::Closed | AcpSessionLifecycle::Failed
            ) {
                return Err(AppError::Blocked {
                    reason: "the Agent session is already running".into(),
                });
            }
        }
        let focus = self.sessions_persistence.focus_session(id, None).await?;
        if focus.session.acp_session_id.is_none() {
            return Err(AppError::Blocked {
                reason: "this Agent session has no resumable ACP identity".into(),
            });
        }
        let connection_id = focus.session.connection_id;
        let provider = focus.session.provider;
        let first = self
            .launch(
                connection_id,
                provider,
                AcpResourceRequest::default(),
                &ports,
                Some(ResumeSeed {
                    summary: focus.session,
                    events: focus.events,
                }),
            )
            .await;
        if first.is_err() && ports.process.has_ready_fallback(provider)? {
            let focus = self.sessions_persistence.focus_session(id, None).await?;
            return self
                .launch(
                    connection_id,
                    provider,
                    AcpResourceRequest::default(),
                    &ports,
                    Some(ResumeSeed {
                        summary: focus.session,
                        events: focus.events,
                    }),
                )
                .await;
        }
        first
    }

    async fn launch(
        &self,
        connection_id: ConnectionId,
        provider: AgentProvider,
        resources: AcpResourceRequest,
        ports: &DesktopAcpRuntimePorts,
        resume_seed: Option<ResumeSeed>,
    ) -> AppResult<AcpSessionFocus> {
        let AcpResourceRequest {
            resource_scopes: requested_resource_scopes,
            write_connection_id: requested_write_connection_id,
        } = resources;
        if self
            .sessions
            .iter()
            .filter(|entry| {
                !matches!(
                    entry.value().summary().lifecycle,
                    AcpSessionLifecycle::Closed | AcpSessionLifecycle::Failed
                )
            })
            .count()
            >= MAX_ACTIVE_SESSIONS
        {
            return Err(AppError::Blocked {
                reason: format!("at most {MAX_ACTIVE_SESSIONS} Agent sessions may run at once"),
            });
        }

        let prepared_process = ports.process.prepare(provider).await?;
        let registration = prepared_process.registration()?;
        let connection = self
            .sessions_persistence
            .pin_connection(connection_id)
            .await?;
        let (knowledge_scopes, write_connection_id) = match resume_seed.as_ref() {
            Some(seed) => (
                knowledge_scope::summary_scopes(&seed.summary)?,
                seed.summary.write_connection_id,
            ),
            None => {
                let selections = &requested_resource_scopes;
                if selections.is_empty() || selections.len() > 16 {
                    return Err(AppError::Blocked {
                        reason: "select at least one Project resource before starting the Agent"
                            .into(),
                    });
                }
                let mut environment_ids = HashSet::new();
                let mut scopes = Vec::with_capacity(selections.len());
                for selection in selections {
                    if !environment_ids.insert(selection.project_environment_id) {
                        return Err(AppError::Blocked {
                            reason:
                                "the selected Agent resource scopes contain a duplicate Environment"
                                    .into(),
                        });
                    }
                    let authority = self
                        .sessions_persistence
                        .pin_connection(ConnectionId::from(selection.authority_connection_id))
                        .await?;
                    if !same_storage_scope(&connection.scope, &authority.scope) {
                        return Err(AppError::Blocked {
                            reason: "the selected Agent resources belong to another workspace or account"
                                .into(),
                        });
                    }
                    let mut scope = self
                        .knowledge_scope
                        .resolve(&authority, Some(selection.project_environment_id))
                        .await?
                        .ok_or_else(|| AppError::Blocked {
                            reason: "the selected Project resource scope is unavailable".into(),
                        })?;
                    narrow_resource_scope(
                        &mut scope,
                        &selection.connection_ids,
                        &selection.source_ids,
                    )?;
                    scopes.push(scope);
                }
                let projects = scopes
                    .iter()
                    .map(|scope| scope.project_id)
                    .collect::<HashSet<_>>();
                let selected_connections = scopes
                    .iter()
                    .flat_map(|scope| scope.connections.iter())
                    .map(|scoped| scoped.connection_id)
                    .collect::<HashSet<_>>();
                let selected_sources = scopes
                    .iter()
                    .flat_map(|scope| scope.sources.iter())
                    .map(|source| source.source_id)
                    .collect::<HashSet<_>>();
                let selected_connection_count = scopes
                    .iter()
                    .map(|scope| scope.connections.len())
                    .sum::<usize>();
                let selected_source_count = scopes
                    .iter()
                    .map(|scope| scope.sources.len())
                    .sum::<usize>();
                let anchor_is_selected_or_authority = selected_connections
                    .contains(&Uuid::from(connection_id))
                    || scopes
                        .iter()
                        .any(|scope| scope.authority_connection_id == Uuid::from(connection_id));
                if projects.len() != 1
                    || projects.contains(&Uuid::nil())
                    || selected_connections.len() != selected_connection_count
                    || selected_sources.len() != selected_source_count
                    || selected_connections.len() > 32
                    || selected_sources.len() > 100
                    || !anchor_is_selected_or_authority
                {
                    return Err(AppError::Blocked {
                        reason:
                            "the selected Agent resources must be one exact Project resource set"
                                .into(),
                    });
                }
                if let Some(write_connection_id) = requested_write_connection_id {
                    if !selected_connections.contains(&write_connection_id) {
                        return Err(AppError::Blocked {
                            reason: "the Agent write target is outside the selected database set"
                                .into(),
                        });
                    }
                }
                (scopes, requested_write_connection_id)
            }
        };
        let knowledge_account_scope = connection
            .scope
            .selected_account_id
            .as_deref()
            .unwrap_or_else(|| connection.scope.account_scope.storage_key());
        for scope in &knowledge_scopes {
            self.knowledge_scope
                .verify(
                    scope,
                    connection.scope.workspace_id,
                    knowledge_account_scope,
                )
                .await?;
        }

        let now = Utc::now();
        let (id, summary, events, resume) = match resume_seed {
            Some(seed) => {
                if seed.summary.connection_id != connection_id {
                    return Err(AppError::Blocked {
                        reason: "the Agent session belongs to another connection".into(),
                    });
                }
                if seed.summary.provider != provider {
                    return Err(AppError::Blocked {
                        reason: "the Agent session belongs to another provider".into(),
                    });
                }
                let previous_last_sequence =
                    seed.events.last().map(|event| event.sequence).unwrap_or(0);
                let acp_session_id = seed
                    .summary
                    .acp_session_id
                    .clone()
                    .expect("resume eligibility was checked before launch");
                let mut summary = seed.summary;
                summary.lifecycle = AcpSessionLifecycle::Starting;
                summary.error = None;
                summary.updated_at = now;
                (
                    summary.id,
                    summary,
                    VecDeque::from(seed.events),
                    Some(ResumeContext {
                        acp_session_id,
                        previous_last_sequence,
                    }),
                )
            }
            None => {
                let id = AcpSessionId::from(Uuid::new_v4());
                (
                    id,
                    AcpSessionSummary {
                        id,
                        connection_id,
                        provider,
                        title: "New Agent session".into(),
                        lifecycle: AcpSessionLifecycle::Starting,
                        acp_session_id: None,
                        knowledge_scopes: knowledge_scopes.clone(),
                        write_connection_id,
                        error: None,
                        created_at: now,
                        updated_at: now,
                    },
                    VecDeque::new(),
                    None,
                )
            }
        };
        let next_sequence = events
            .back()
            .map(|event| event.sequence)
            .unwrap_or(0)
            .checked_add(1)
            .ok_or_else(|| AppError::Config("the ACP event sequence was exhausted".into()))?;
        let selected_resource_context =
            knowledge_scope::resource_context(&knowledge_scopes, write_connection_id);
        let broker_session_id = TerminalSessionId::from(Uuid::new_v4());
        let issued = self.broker.sessions().issue_agent_with_knowledge(
            broker_session_id,
            &connection,
            BrokerCapability::ALL,
            ACP_CAPABILITY_TTL,
            registration,
            AgentKnowledgeAuthorization {
                scopes: knowledge_scopes,
                write_connection_id: write_connection_id.map(ConnectionId::from),
            },
        )?;
        let token = Zeroizing::new(issued.token().to_owned());
        drop(issued);
        let launch = prepared_process.bind(token, self.broker.runtime_file());
        if let Err(error) = self
            .sessions_persistence
            .persist_session(&connection.scope, &summary)
            .await
        {
            self.broker.sessions().revoke(broker_session_id);
            return Err(error);
        }
        let (persistence_queue, persistence_requests) = tokio::sync::mpsc::unbounded_channel();
        let replay = ReplayBuffer::from_events(events);
        let session = Arc::new(AcpSession {
            id,
            connection_id,
            broker_session_id,
            storage_scope: connection.scope.clone(),
            sessions_persistence: self.sessions_persistence.clone(),
            persistence: self.persistence.clone(),
            summary: Mutex::new(summary),
            events: Mutex::new(replay),
            persistence_queue,
            push_order: Mutex::new(()),
            accepting_events: AtomicBool::new(true),
            next_sequence: AtomicU64::new(next_sequence),
            busy: AtomicBool::new(false),
            command: Mutex::new(None),
            permissions: Mutex::new(HashMap::new()),
            config_options: Mutex::new(HashMap::new()),
            terminated: AtomicBool::new(false),
            termination: Notify::new(),
            event_sink: ports.events.clone(),
        });
        self.sessions.insert(id, session.clone());

        let sessions_persistence = self.sessions_persistence.clone();
        let persistence_scope = connection.scope.clone();
        let persistence_tracker = self.persistence.clone();
        tokio::spawn(persistence::run_worker(
            id,
            sessions_persistence,
            persistence_scope,
            persistence_tracker,
            persistence_requests,
        ));

        let (command_tx, command_rx) = tokio::sync::mpsc::unbounded_channel();
        *lock_unpoisoned(&session.command) = Some(command_tx);
        let (ready_tx, ready_rx) = oneshot::channel();
        let ready = Arc::new(Mutex::new(Some(ready_tx)));
        let startup_cancel = CancellationToken::new();
        let broker = self.broker.clone();
        let worker_session = session.clone();
        let worker_startup_cancel = startup_cancel.clone();
        tokio::spawn(async move {
            run_session(
                worker_session,
                launch,
                command_rx,
                SessionRuntimeContext {
                    broker,
                    connection_context: selected_resource_context,
                    resume,
                    ready,
                    startup_cancel: worker_startup_cancel,
                },
            )
            .await;
        });

        match tokio::time::timeout(ACP_START_TIMEOUT, ready_rx).await {
            Ok(Ok(Ok(()))) => session.focus(None),
            Ok(Ok(Err(error))) => Err(error),
            Ok(Err(_)) => Err(AppError::Agent(format!(
                "the {} ACP startup task stopped before initialization",
                provider_name(provider)
            ))),
            Err(_) => {
                let message = startup_timeout_message(provider);
                startup_cancel.cancel();
                if tokio::time::timeout(
                    ACP_START_CLEANUP_TIMEOUT,
                    wait_for_session_termination(&session),
                )
                .await
                .is_err()
                {
                    tracing::warn!(
                        session_id = %id,
                        provider = provider_name(provider),
                        "ACP startup cancellation did not finish before fallback evaluation"
                    );
                }
                Err(AppError::Timeout(message))
            }
        }
    }

    pub(crate) fn prompt(
        &self,
        id: AcpSessionId,
        text: String,
        context: AcpPromptContext,
    ) -> AppResult<()> {
        let session = self.session(id)?;
        let text = prompt::normalize(text)?;
        prompt::validate_context(&context)?;
        prompt::validate_scope(&context, &session.summary())?;
        if session.summary().lifecycle != AcpSessionLifecycle::Ready {
            return Err(AppError::Blocked {
                reason: "the Agent session is not ready for a new prompt".into(),
            });
        }
        if session
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(AppError::Blocked {
                reason: "the Agent is already working on a prompt".into(),
            });
        }
        if session
            .sender()?
            .send(SessionCommand::Prompt {
                text,
                context: Box::new(context),
            })
            .is_err()
        {
            session.busy.store(false, Ordering::SeqCst);
            return Err(AppError::Agent(format!(
                "the {} ACP session is no longer available",
                provider_name(session.summary().provider)
            )));
        }
        Ok(())
    }

    pub(crate) async fn cancel(&self, id: AcpSessionId) -> AppResult<()> {
        let Some(session) = self.sessions.get(&id).map(|entry| entry.value().clone()) else {
            // A persisted conversation can outlive the process that owned its ACP
            // adapter (for example after a dev reload or a second app instance).
            // There is no live turn to signal, but validating the scoped record makes
            // cancellation idempotent instead of surfacing a misleading not-found.
            self.sessions_persistence.focus_session(id, None).await?;
            return Ok(());
        };
        session.cancel_pending_permissions();
        session.sender()?.send(SessionCommand::Cancel).map_err(|_| {
            AppError::Agent(format!(
                "the {} ACP session is no longer available",
                provider_name(session.summary().provider)
            ))
        })
    }

    pub(crate) fn respond_permission(
        &self,
        id: AcpSessionId,
        request_id: &str,
        option_id: Option<String>,
    ) -> AppResult<()> {
        let session = self.session(id)?;
        session.respond_permission(request_id, option_id)
    }

    pub(crate) fn close(&self, id: AcpSessionId) -> AppResult<()> {
        let session = self.session(id)?;
        if session.summary().lifecycle == AcpSessionLifecycle::Closed {
            return Ok(());
        }
        session.cancel_pending_permissions();
        if let Ok(sender) = session.sender() {
            let _ = sender.send(SessionCommand::Close);
        }
        self.broker.sessions().revoke(session.broker_session_id);
        session.busy.store(false, Ordering::SeqCst);
        session.set_lifecycle(AcpSessionLifecycle::Closed, None);
        Ok(())
    }

    pub(crate) async fn set_config_option(
        &self,
        id: AcpSessionId,
        config_id: String,
        value: String,
    ) -> AppResult<()> {
        let session = self.session(id)?;
        validate_config_option_value(&config_id, &value)?;
        if !session.allows_config_option(&config_id, &value) {
            return Err(AppError::Blocked {
                reason: "the ACP adapter did not advertise that model option".into(),
            });
        }
        if session.summary().lifecycle != AcpSessionLifecycle::Ready {
            return Err(AppError::Blocked {
                reason: "the Agent session is not ready to change configuration".into(),
            });
        }
        let (response_tx, response_rx) = oneshot::channel();
        session
            .sender()?
            .send(SessionCommand::SetConfigOption {
                config_id,
                value,
                response: response_tx,
            })
            .map_err(|_| {
                AppError::Agent(format!(
                    "the {} ACP session is no longer available",
                    provider_name(session.summary().provider)
                ))
            })?;
        response_rx.await.map_err(|_| {
            AppError::Agent(format!(
                "the {} ACP session stopped before applying its configuration",
                provider_name(session.summary().provider)
            ))
        })?
    }

    pub(crate) async fn stop_provider_and_wait(
        &self,
        provider: AgentProvider,
        timeout: Duration,
    ) -> AppResult<usize> {
        let sessions = self
            .sessions
            .iter()
            .filter_map(|entry| {
                (entry.value().summary().provider == provider
                    && !entry.value().terminated.load(Ordering::SeqCst))
                .then_some((*entry.key(), entry.value().clone()))
            })
            .collect::<Vec<_>>();
        for (id, _) in &sessions {
            let _ = self.close(*id);
        }
        let wait = async {
            for (_, session) in &sessions {
                wait_for_session_termination(session).await;
            }
        };
        tokio::time::timeout(timeout, wait).await.map_err(|_| {
            AppError::Timeout(
                "the Agent process did not stop, so its adapter plugin was not removed".into(),
            )
        })?;
        Ok(sessions.len())
    }

    pub(crate) fn shutdown_all(&self) {
        let ids = self
            .sessions
            .iter()
            .map(|entry| *entry.key())
            .collect::<Vec<_>>();
        for id in ids {
            let _ = self.close(id);
        }
    }

    pub(crate) async fn flush_persistence(&self, timeout: Duration) {
        let _ = tokio::time::timeout(timeout, self.persistence.wait_for_idle()).await;
    }

    fn session(&self, id: AcpSessionId) -> AppResult<Arc<AcpSession>> {
        self.sessions
            .get(&id)
            .map(|entry| entry.value().clone())
            .ok_or_else(|| AppError::NotFound("Agent session not found".into()))
    }

    pub(super) fn interrupt(&self, id: AcpSessionId, reason: &'static str) {
        let Ok(session) = self.session(id) else {
            return;
        };
        session.cancel_pending_permissions();
        // Persist the authoritative interruption reason before asking the actor
        // to exit. If Close wins the scheduler race first, run_session would only
        // be able to observe an unexplained adapter EOF.
        session.set_interrupted(reason);
        if let Ok(sender) = session.sender() {
            let _ = sender.send(SessionCommand::Close);
        }
        self.broker.sessions().revoke(session.broker_session_id);
        session.busy.store(false, Ordering::SeqCst);
    }
}
