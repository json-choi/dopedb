//! ACP adapter process execution, turn handling, and protocol validation.

use super::*;

pub(super) struct ResumeSeed {
    pub(super) summary: AcpSessionSummary,
    pub(super) events: Vec<AcpSessionEvent>,
}

pub(super) struct ResumeContext {
    pub(super) acp_session_id: String,
}

pub(super) struct SessionRuntimeContext {
    pub(super) broker: BrokerRuntime,
    pub(super) connection_context: String,
    pub(super) resume: Option<ResumeContext>,
    pub(super) ready: Arc<Mutex<Option<oneshot::Sender<AppResult<()>>>>>,
    pub(super) startup_cancel: CancellationToken,
}

pub(super) async fn run_session(
    session: Arc<AcpSession>,
    mut launch: AcpProcess,
    mut commands: tokio::sync::mpsc::UnboundedReceiver<SessionCommand>,
    context: SessionRuntimeContext,
) {
    let SessionRuntimeContext {
        broker,
        connection_context,
        resume,
        ready,
        startup_cancel,
    } = context;
    let candidate_receipt = launch.candidate_receipt();
    let plugin_id = candidate_receipt.plugin_id();
    let plugin_version = candidate_receipt.plugin_version().to_owned();
    let plugin_candidate = candidate_receipt.is_candidate();
    let plugin_activated = Arc::new(AtomicBool::new(!plugin_candidate));
    let activation_for_connection = plugin_activated.clone();
    let receipt_for_connection = candidate_receipt.clone();
    let version_for_connection = plugin_version.clone();
    let config = launch.agent_config(session.broker_session_id, session.connection_id);
    let agent = AcpAgent::new(config);
    let notification_session = session.clone();
    let permission_session = session.clone();
    let connection_session = session.clone();
    let ready_for_connection = ready.clone();

    let connection = agent_client_protocol::Client
        .builder()
        .name("DopeDB ACP client")
        .on_receive_notification(
            async move |notification: SessionNotification, _connection| {
                // `session/load` streams the provider's own history before it
                // answers. DopeDB already shows its bounded local transcript, so
                // replaying it again would duplicate the conversation and turn the
                // pinned context blocks into visible user messages.
                if notification_session
                    .replaying_history
                    .load(Ordering::SeqCst)
                {
                    return Ok(());
                }
                // An adapter may change its own options mid-session (for example a
                // mode switch after plan approval). Re-project the full advertised
                // set so the allowed values and the visible selection stay exact.
                if let SessionUpdate::ConfigOptionUpdate(update) = &notification.update {
                    push_session_configuration(
                        &notification_session,
                        Some(update.config_options.clone()),
                    );
                    return Ok(());
                }
                match bounded_json_value(&notification.update, "ACP session update") {
                    Ok(update) => {
                        notification_session.push(AcpSessionEventPayload::SessionUpdate { update });
                    }
                    Err(error) => {
                        notification_session.push(AcpSessionEventPayload::Error {
                            message: agent_error::with_detail(agent_error::EVENT_DROPPED, error),
                        });
                    }
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest,
                        responder,
                        _connection: ConnectionTo<Agent>| {
                let permission_session = permission_session.clone();
                let request_id = Uuid::new_v4().to_string();
                let options = request
                    .options
                    .iter()
                    .map(|option| AcpPermissionOption {
                        id: option.option_id.to_string(),
                        name: option.name.clone(),
                        kind: permission_kind(option.kind).into(),
                    })
                    .collect::<Vec<_>>();
                if let Err(message) = validate_permission_options(&options) {
                    permission_session.push(AcpSessionEventPayload::Error { message });
                    return responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Cancelled,
                    ));
                }
                let allowed = options
                    .iter()
                    .map(|option| option.id.clone())
                    .collect::<HashSet<_>>();
                let tool_call =
                    match bounded_json_value(&request.tool_call, "ACP permission tool call") {
                        Ok(tool_call) => tool_call,
                        Err(message) => {
                            permission_session.push(AcpSessionEventPayload::Error { message });
                            return responder.respond(RequestPermissionResponse::new(
                                RequestPermissionOutcome::Cancelled,
                            ));
                        }
                    };
                let (response_tx, response_rx) = oneshot::channel();
                permission_session.register_permission(request_id.clone(), allowed, response_tx);
                permission_session.set_lifecycle(AcpSessionLifecycle::WaitingPermission, None);
                permission_session.push(AcpSessionEventPayload::PermissionRequest {
                    request_id,
                    tool_call,
                    options,
                });

                let outcome = match response_rx.await.ok().flatten() {
                    Some(option_id) => RequestPermissionOutcome::Selected(
                        SelectedPermissionOutcome::new(option_id),
                    ),
                    None => RequestPermissionOutcome::Cancelled,
                };
                if permission_session.busy.load(Ordering::SeqCst) {
                    permission_session.set_lifecycle(AcpSessionLifecycle::Running, None);
                }
                responder.respond(RequestPermissionResponse::new(outcome))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, async move |connection| {
            let initialize = InitializeRequest::new(ProtocolVersion::V1).client_info(
                Implementation::new("dopedb", env!("CARGO_PKG_VERSION")).title("DopeDB"),
            );
            let initialized = connection.send_request(initialize).block_task().await?;
            let (acp_session_id, config_options) = if let Some(resume) = resume {
                if !initialized.agent_capabilities.load_session {
                    let message = agent_error::for_provider(
                        agent_error::NOT_RESUMABLE,
                        connection_session.summary().provider,
                    );
                    complete_ready(&ready_for_connection, Err(AppError::Agent(message.clone())));
                    connection_session.set_lifecycle(AcpSessionLifecycle::Failed, Some(message));
                    return Ok(());
                }
                let acp_session_id = SessionId::from(resume.acp_session_id);
                connection_session
                    .replaying_history
                    .store(true, Ordering::SeqCst);
                let loaded = connection
                    .send_request(
                        LoadSessionRequest::new(acp_session_id.clone(), launch.working_directory())
                            .mcp_servers(vec![launch.mcp_server(
                                connection_session.broker_session_id,
                                connection_session.connection_id,
                            )]),
                    )
                    .block_task()
                    .await;
                connection_session
                    .replaying_history
                    .store(false, Ordering::SeqCst);
                let loaded = match loaded {
                    Ok(loaded) => loaded,
                    Err(error) => {
                        if resume_history_unavailable(&error.to_string()) {
                            connection_session.clear_acp_session_id();
                        }
                        return Err(error);
                    }
                };
                (acp_session_id, loaded.config_options)
            } else {
                let created = connection
                    .send_request(
                        NewSessionRequest::new(launch.working_directory()).mcp_servers(vec![
                            launch.mcp_server(
                                connection_session.broker_session_id,
                                connection_session.connection_id,
                            ),
                        ]),
                    )
                    .block_task()
                    .await?;
                (created.session_id, created.config_options)
            };
            connection_session.set_acp_session_id(acp_session_id.to_string());
            push_session_configuration(&connection_session, config_options);
            if plugin_candidate {
                match receipt_for_connection.record_initialize_success() {
                    Ok(()) => activation_for_connection.store(true, Ordering::SeqCst),
                    Err(error) => tracing::warn!(
                        %error,
                        plugin_id = plugin_id.as_str(),
                        plugin_version = %version_for_connection,
                        "ACP plugin initialized but its candidate promotion was deferred"
                    ),
                }
            } else if let Err(error) = receipt_for_connection.record_ready_success() {
                tracing::warn!(
                    %error,
                    plugin_id = plugin_id.as_str(),
                    plugin_version = %version_for_connection,
                    "ACP plugin fallback initialized but its stale failure was not cleared"
                );
            }
            connection_session.set_lifecycle(AcpSessionLifecycle::Ready, None);
            complete_ready(&ready_for_connection, Ok(()));

            while let Some(command) = commands.recv().await {
                match command {
                    SessionCommand::Prompt { text, context } => {
                        connection_session.set_title_from_prompt(&text);
                        let attachments = prompt::attachments(&context);
                        connection_session.push(AcpSessionEventPayload::UserMessage {
                            text: text.clone(),
                            attachments,
                        });
                        connection_session.set_lifecycle(AcpSessionLifecycle::Running, None);
                        let blocks = prompt::content(&connection_context, &context, text);
                        if !run_turn(
                            &connection,
                            &acp_session_id,
                            blocks,
                            &connection_session,
                            &mut commands,
                        )
                        .await?
                        {
                            break;
                        }
                    }
                    SessionCommand::Cancel => {
                        connection
                            .send_notification(CancelNotification::new(acp_session_id.clone()))?;
                    }
                    SessionCommand::SetConfigOption {
                        config_id,
                        value,
                        response,
                    } => {
                        let result = connection
                            .send_request(SetSessionConfigOptionRequest::new(
                                acp_session_id.clone(),
                                config_id,
                                value.as_str(),
                            ))
                            .block_task()
                            .await
                            .map(|updated| {
                                push_session_configuration(
                                    &connection_session,
                                    Some(updated.config_options),
                                );
                            })
                            .map_err(|error| {
                                AppError::Agent(actionable_acp_error(
                                    connection_session.summary().provider,
                                    &error.to_string(),
                                ))
                            });
                        let _ = response.send(result);
                    }
                    SessionCommand::Close => break,
                }
            }
            Ok(())
        });
    tokio::pin!(connection);
    let result = tokio::select! {
        result = &mut connection => result.map_err(|error| {
            actionable_acp_error(session.summary().provider, &error.to_string())
        }),
        () = startup_cancel.cancelled() => {
            if session.startup_cancelled_by_user.load(Ordering::SeqCst) {
                Err(AGENT_START_CANCELLED.to_owned())
            } else {
                Err(startup_timeout_message(session.summary().provider))
            }
        }
    };

    session.busy.store(false, Ordering::SeqCst);
    session.cancel_pending_permissions();
    *lock_unpoisoned(&session.command) = None;
    broker.sessions().revoke(session.broker_session_id);

    match result {
        Ok(()) => {
            complete_ready(&ready, Ok(()));
            if !matches!(
                session.summary().lifecycle,
                AcpSessionLifecycle::Closed | AcpSessionLifecycle::Failed
            ) {
                // Only an explicit close marks a conversation Closed. EOF from an
                // adapter process while the session is otherwise live is an
                // interruption and must remain visible and resumable instead of
                // silently discarding an unfinished answer.
                session.set_interrupted(AGENT_PROCESS_CLOSED);
            }
        }
        Err(message) if session.startup_cancelled_by_user.load(Ordering::SeqCst) => {
            // A person stopped a slow start: not an adapter failure, so the
            // candidate is not quarantined and no error is recorded.
            complete_ready(&ready, Err(AppError::Agent(message)));
            session.set_lifecycle(AcpSessionLifecycle::Closed, None);
        }
        Err(message) => {
            if plugin_candidate && !plugin_activated.load(Ordering::SeqCst) {
                if let Err(state_error) = candidate_receipt.record_initialize_failure(&message) {
                    tracing::warn!(
                        error = %state_error,
                        plugin_id = plugin_id.as_str(),
                        plugin_version = %plugin_version,
                        "could not quarantine a failed ACP plugin candidate"
                    );
                }
            }
            complete_ready(&ready, Err(AppError::Agent(message.clone())));
            session.push(AcpSessionEventPayload::Error {
                message: message.clone(),
            });
            session.set_lifecycle(AcpSessionLifecycle::Failed, Some(message));
        }
    }
    session.terminated.store(true, Ordering::SeqCst);
    session.termination.notify_waiters();
}

async fn run_turn(
    connection: &ConnectionTo<Agent>,
    acp_session_id: &agent_client_protocol::schema::v1::SessionId,
    blocks: Vec<ContentBlock>,
    session: &Arc<AcpSession>,
    commands: &mut tokio::sync::mpsc::UnboundedReceiver<SessionCommand>,
) -> Result<bool, agent_client_protocol::Error> {
    let request = connection
        .send_request(PromptRequest::new(acp_session_id.clone(), blocks))
        .block_task();
    tokio::pin!(request);
    loop {
        tokio::select! {
            response = &mut request => {
                session.busy.store(false, Ordering::SeqCst);
                match response {
                    Ok(response) => {
                        let stop_reason = serde_json::to_value(response.stop_reason)
                            .ok()
                            .and_then(|value| value.as_str().map(str::to_owned))
                            .unwrap_or_else(|| format!("{:?}", response.stop_reason));
                        session.push(AcpSessionEventPayload::TurnEnd { stop_reason });
                        session.set_lifecycle(AcpSessionLifecycle::Ready, None);
                        return Ok(true);
                    }
                    Err(error) => {
                        let message =
                            actionable_acp_error(session.summary().provider, &error.to_string());
                        session.push(AcpSessionEventPayload::Error { message });
                        if connection.is_incoming_closed() {
                            return Err(error);
                        }
                        session.set_lifecycle(AcpSessionLifecycle::Ready, None);
                        return Ok(true);
                    }
                }
            }
            command = commands.recv() => {
                match command {
                    Some(SessionCommand::Cancel) => {
                        session.cancel_pending_permissions();
                        connection.send_notification(CancelNotification::new(acp_session_id.clone()))?;
                    }
                    Some(SessionCommand::Close) | None => {
                        session.cancel_pending_permissions();
                        connection.send_notification(CancelNotification::new(acp_session_id.clone()))?;
                        session.busy.store(false, Ordering::SeqCst);
                        return Ok(false);
                    }
                    Some(SessionCommand::Prompt { .. }) => {
                        // The runtime's atomic busy gate prevents this path. Ignore a
                        // stale duplicate rather than interleaving ACP prompt turns.
                    }
                    Some(SessionCommand::SetConfigOption { response, .. }) => {
                        // The configuration cannot change during a turn.
                        let _ = response.send(Err(AppError::Blocked {
                            reason: agent_error::CONFIG_UNAVAILABLE.into(),
                        }));
                    }
                }
            }
        }
    }
}

fn push_session_configuration(
    session: &AcpSession,
    config_options: Option<Vec<SessionConfigOption>>,
) {
    let config_options = config_options.unwrap_or_default();
    if config_options.len() > MAX_CONFIG_OPTIONS {
        lock_unpoisoned(&session.config_options).clear();
        session.push(AcpSessionEventPayload::Error {
            message: agent_error::with_detail(
                agent_error::CONFIG_UNAVAILABLE,
                format_args!("more than {MAX_CONFIG_OPTIONS} configuration options"),
            ),
        });
        return;
    }
    match bounded_json_value(&config_options, "ACP session configuration") {
        Ok(serde_json::Value::Array(config_options)) => {
            let (config_options, allowed) = configuration::project_options(config_options);
            *lock_unpoisoned(&session.config_options) = allowed;
            session.push(AcpSessionEventPayload::SessionConfiguration { config_options });
        }
        Ok(_) => {
            lock_unpoisoned(&session.config_options).clear();
            session.push(AcpSessionEventPayload::Error {
                message: agent_error::CONFIG_UNAVAILABLE.into(),
            });
        }
        Err(message) => {
            lock_unpoisoned(&session.config_options).clear();
            session.push(AcpSessionEventPayload::Error { message });
        }
    }
}

fn bounded_json_value<T: serde::Serialize>(
    value: &T,
    label: &str,
) -> Result<serde_json::Value, String> {
    let dropped = |detail: String| agent_error::with_detail(agent_error::EVENT_DROPPED, detail);
    let bytes = serde_json::to_vec(value).map_err(|error| dropped(format!("{label}: {error}")))?;
    if bytes.len() > MAX_EVENT_BYTES {
        return Err(dropped(format!(
            "{label} exceeded the {MAX_EVENT_BYTES}-byte replay limit"
        )));
    }
    serde_json::from_slice(&bytes).map_err(|error| dropped(format!("{label}: {error}")))
}

/// An invalid permission request is cancelled; the code names why for copy.
fn validate_permission_options(options: &[AcpPermissionOption]) -> Result<(), String> {
    let invalid = |detail: &str| {
        Err(agent_error::with_detail(
            agent_error::PERMISSION_UNAVAILABLE,
            detail,
        ))
    };
    if options.is_empty() || options.len() > MAX_PERMISSION_OPTIONS {
        return invalid("invalid option count");
    }
    if options.iter().any(|option| {
        option.id.is_empty()
            || option.name.trim().is_empty()
            || option.id.len() > MAX_PERMISSION_OPTION_BYTES
            || option.name.len() > MAX_PERMISSION_OPTION_BYTES
    }) {
        return invalid("invalid option");
    }
    let unique_ids = options
        .iter()
        .map(|option| option.id.as_str())
        .collect::<HashSet<_>>();
    if unique_ids.len() != options.len() {
        return invalid("duplicate options");
    }
    Ok(())
}

pub(super) fn validate_config_option_value(config_id: &str, value: &str) -> AppResult<()> {
    if config_id.trim().is_empty() || value.trim().is_empty() {
        return Err(AppError::Config(agent_error::CONFIG_UNAVAILABLE.into()));
    }
    if config_id.len() > MAX_CONFIG_OPTION_ID_BYTES || value.len() > MAX_CONFIG_OPTION_VALUE_BYTES {
        return Err(AppError::Blocked {
            reason: agent_error::CONFIG_UNAVAILABLE.into(),
        });
    }
    Ok(())
}

fn permission_kind(kind: PermissionOptionKind) -> &'static str {
    match kind {
        PermissionOptionKind::AllowOnce => "allowOnce",
        PermissionOptionKind::AllowAlways => "allowAlways",
        PermissionOptionKind::RejectOnce => "rejectOnce",
        PermissionOptionKind::RejectAlways => "rejectAlways",
        _ => "unknown",
    }
}

/// Classifies an adapter failure by code; anything else stays the provider's own
/// explanation, carried as a detail under the provider-error code.
fn actionable_acp_error(provider: AgentProvider, message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if resume_history_unavailable(&lower) {
        return agent_error::for_provider(agent_error::HISTORY_UNAVAILABLE, provider);
    }
    if lower.contains("auth") || lower.contains("login") || lower.contains("unauthorized") {
        return agent_error::for_provider(agent_error::CLI_NOT_AUTHENTICATED, provider);
    }
    agent_error::with_detail(
        &agent_error::for_provider(agent_error::PROVIDER_ERROR, provider),
        message,
    )
}

fn resume_history_unavailable(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let identifies_history =
        lower.contains("rollout") || lower.contains("thread") || lower.contains("session");
    let reports_missing = lower.contains("not found")
        || lower.contains("no rollout found")
        || lower.contains("does not exist")
        || lower.contains("unknown session");
    identifies_history && reports_missing
}

/// The ACP session of this provider is no longer available to take a command.
pub(super) fn session_unavailable(provider: AgentProvider) -> AppError {
    AppError::Agent(agent_error::for_provider(
        agent_error::SESSION_UNAVAILABLE,
        provider,
    ))
}

/// True when a person cancelled the adapter start; no fallback launch follows.
pub(super) fn is_start_cancelled(error: &AppError) -> bool {
    matches!(error, AppError::Agent(message) if message == AGENT_START_CANCELLED)
}

pub(super) fn provider_name(provider: AgentProvider) -> &'static str {
    match provider {
        AgentProvider::Claude => "Claude",
        AgentProvider::Codex => "Codex",
    }
}

pub(super) fn startup_timeout_message(provider: AgentProvider) -> String {
    agent_error::with_detail(
        &agent_error::for_provider(agent_error::START_TIMED_OUT, provider),
        format_args!("{} seconds", ACP_START_TIMEOUT.as_secs()),
    )
}

fn complete_ready(
    ready: &Arc<Mutex<Option<oneshot::Sender<AppResult<()>>>>>,
    result: AppResult<()>,
) {
    if let Some(sender) = lock_unpoisoned(ready).take() {
        let _ = sender.send(result);
    }
}

pub(super) async fn wait_for_session_termination(session: &AcpSession) {
    loop {
        let notified = session.termination.notified();
        if session.terminated.load(Ordering::SeqCst) {
            return;
        }
        notified.await;
    }
}

pub(super) fn same_storage_scope(left: &ActiveResourceScope, right: &ActiveResourceScope) -> bool {
    left.workspace_id == right.workspace_id
        && left.account_scope.storage_key() == right.account_scope.storage_key()
        && left.selected_account_id == right.selected_account_id
}

/// A resource check that could not run now, as opposed to an answer that the
/// pinned resource no longer exists or changed.
pub(super) fn scope_check_is_transient(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Network(_)
            | AppError::Timeout(_)
            | AppError::RetryLater { .. }
            | AppError::Io(_)
            | AppError::AuthenticationRequired(_)
    )
}

pub(super) fn truncate_chars(value: &str, max: usize) -> String {
    let mut chars = value.chars();
    let text = chars.by_ref().take(max).collect::<String>();
    if chars.next().is_some() {
        format!("{text}…")
    } else {
        text
    }
}
