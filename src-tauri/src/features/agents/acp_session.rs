//! ACP session projections, permissions, and replay-buffer state.

use super::*;

impl AcpSession {
    pub(super) fn summary(&self) -> AcpSessionSummary {
        lock_unpoisoned(&self.summary).clone()
    }

    pub(super) fn sender(&self) -> AppResult<tokio::sync::mpsc::UnboundedSender<SessionCommand>> {
        lock_unpoisoned(&self.command)
            .clone()
            .ok_or_else(|| session_unavailable(self.summary().provider))
    }

    pub(super) fn focus(&self, after_sequence: Option<u64>) -> AppResult<AcpSessionFocus> {
        let events = lock_unpoisoned(&self.events);
        let earliest = events.events.front().map(|entry| entry.event.sequence);
        let replay_truncated = after_sequence
            .zip(earliest)
            .is_some_and(|(after, first)| after.saturating_add(1) < first);
        Ok(AcpSessionFocus {
            session: self.summary(),
            events: events
                .events
                .iter()
                .filter(|entry| after_sequence.is_none_or(|after| entry.event.sequence > after))
                .map(|entry| entry.event.clone())
                .collect(),
            replay_truncated,
            broker_session_id: Some(uuid::Uuid::from(self.broker_session_id)),
        })
    }

    pub(super) fn set_acp_session_id(&self, id: String) {
        let mut summary = lock_unpoisoned(&self.summary);
        summary.acp_session_id = Some(id);
        summary.updated_at = Utc::now();
    }

    pub(super) fn clear_acp_session_id(&self) {
        let mut summary = lock_unpoisoned(&self.summary);
        summary.acp_session_id = None;
        summary.updated_at = Utc::now();
    }

    pub(super) fn set_title_from_prompt(&self, prompt: &str) {
        let mut summary = lock_unpoisoned(&self.summary);
        if !summary.title.is_empty() && summary.title != UNTITLED_SESSION_TITLE {
            return;
        }
        let title = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
        summary.title = truncate_chars(&title, 56);
        summary.updated_at = Utc::now();
    }

    pub(super) fn set_lifecycle(&self, lifecycle: AcpSessionLifecycle, error: Option<String>) {
        let _push_order = lock_unpoisoned(&self.push_order);
        if !self.accepting_events.load(Ordering::SeqCst) {
            return;
        }
        {
            let mut summary = lock_unpoisoned(&self.summary);
            summary.lifecycle = lifecycle;
            summary.error = error;
            summary.updated_at = Utc::now();
        }
        self.push_unlocked(AcpSessionEventPayload::Status { lifecycle });
        if matches!(
            lifecycle,
            AcpSessionLifecycle::Closed | AcpSessionLifecycle::Failed
        ) {
            self.accepting_events.store(false, Ordering::SeqCst);
            let _ = self.persistence_queue.send(PersistenceCommand::Shutdown);
        }
    }

    pub(super) fn set_interrupted(&self, reason: &'static str) {
        let _push_order = lock_unpoisoned(&self.push_order);
        if !self.accepting_events.load(Ordering::SeqCst) {
            return;
        }
        {
            let mut summary = lock_unpoisoned(&self.summary);
            summary.lifecycle = AcpSessionLifecycle::Failed;
            summary.error = Some(reason.into());
            summary.updated_at = Utc::now();
        }
        self.push_unlocked(AcpSessionEventPayload::Error {
            message: reason.into(),
        });
        self.push_unlocked(AcpSessionEventPayload::Status {
            lifecycle: AcpSessionLifecycle::Failed,
        });
        self.accepting_events.store(false, Ordering::SeqCst);
        let _ = self.persistence_queue.send(PersistenceCommand::Shutdown);
    }

    pub(super) fn push(&self, payload: AcpSessionEventPayload) {
        let _push_order = lock_unpoisoned(&self.push_order);
        if self.accepting_events.load(Ordering::SeqCst) {
            self.push_unlocked(payload);
        }
    }

    pub(super) fn push_unlocked(&self, payload: AcpSessionEventPayload) {
        let event = AcpSessionEvent {
            session_id: self.id,
            sequence: self.next_sequence.fetch_add(1, Ordering::SeqCst),
            created_at: Utc::now(),
            payload,
        };
        let event_bytes = persistence::event_bytes(&event);
        {
            let mut events = lock_unpoisoned(&self.events);
            events.push(event.clone(), event_bytes);
        }
        {
            let mut summary = lock_unpoisoned(&self.summary);
            summary.updated_at = event.created_at;
        }
        let boundary = persistence::is_boundary(&event.payload);
        self.persistence.begin();
        let request = PersistenceRequest {
            summary: boundary.then(|| self.summary()),
            event: event.clone(),
            bytes: event_bytes,
            immediate: boundary,
        };
        if let Err(error) = self
            .persistence_queue
            .send(PersistenceCommand::Event(Box::new(request)))
        {
            self.persistence.finish();
            let PersistenceCommand::Event(request) = error.0 else {
                unreachable!("only ACP event commands increment persistence tracking")
            };
            tracing::warn!(
                session_id = %request.event.session_id,
                sequence = request.event.sequence,
                "could not queue ACP session event persistence"
            );
        }
        self.emit(Some(event.clone()));
    }

    pub(super) fn emit(&self, event: Option<AcpSessionEvent>) {
        let streamed_chunk = event
            .as_ref()
            .is_some_and(|event| !persistence::is_boundary(&event.payload));
        self.event_sink.emit_changed(AcpSessionChanged {
            session: (!streamed_chunk).then(|| self.summary()),
            event,
        });
    }

    pub(super) fn register_permission(
        &self,
        request_id: String,
        allowed: HashSet<String>,
        response: oneshot::Sender<Option<String>>,
    ) {
        lock_unpoisoned(&self.permissions)
            .insert(request_id, PendingPermission { allowed, response });
    }

    pub(super) fn respond_permission(
        &self,
        request_id: &str,
        option_id: Option<String>,
    ) -> AppResult<()> {
        let mut permissions = lock_unpoisoned(&self.permissions);
        // The request must still be pending, and only an offered option answers it.
        let Some(pending) = permissions.get(request_id) else {
            return Err(AppError::NotFound(
                agent_error::PERMISSION_UNAVAILABLE.into(),
            ));
        };
        if option_id
            .as_ref()
            .is_some_and(|option| !pending.allowed.contains(option))
        {
            return Err(AppError::Blocked {
                reason: agent_error::PERMISSION_UNAVAILABLE.into(),
            });
        }
        let pending = permissions
            .remove(request_id)
            .expect("pending permission was checked while holding the same lock");
        drop(permissions);
        let persisted_option = option_id.clone();
        let _push_order = lock_unpoisoned(&self.push_order);
        pending
            .response
            .send(option_id)
            .map_err(|_| AppError::Agent(agent_error::PERMISSION_UNAVAILABLE.into()))?;
        self.push_unlocked(AcpSessionEventPayload::PermissionResponse {
            request_id: request_id.to_owned(),
            option_id: persisted_option,
        });
        Ok(())
    }

    pub(super) fn cancel_pending_permissions(&self) {
        let pending = {
            let mut permissions = lock_unpoisoned(&self.permissions);
            permissions.drain().collect::<Vec<_>>()
        };
        for (request_id, permission) in pending {
            let _push_order = lock_unpoisoned(&self.push_order);
            if permission.response.send(None).is_ok() {
                self.push_unlocked(AcpSessionEventPayload::PermissionResponse {
                    request_id,
                    option_id: None,
                });
            }
        }
    }

    pub(super) fn allows_config_option(&self, config_id: &str, value: &str) -> bool {
        lock_unpoisoned(&self.config_options)
            .get(config_id)
            .is_some_and(|values| values.contains(value))
    }
}

impl ReplayBuffer {
    pub(super) fn from_events(events: VecDeque<AcpSessionEvent>) -> Self {
        let mut replay = Self {
            events: VecDeque::with_capacity(events.len().min(MAX_REPLAY_EVENTS)),
            bytes: 0,
        };
        for event in events {
            let bytes = persistence::event_bytes(&event);
            replay.push(event, bytes);
        }
        replay
    }

    /// Append one event. A streamed text chunk that continues the previous
    /// chunk of the same message is folded into that entry (which takes the
    /// newest sequence), so the replay bound counts conversation events rather
    /// than tokens and a long answer cannot evict the start of the conversation.
    pub(super) fn push(&mut self, event: AcpSessionEvent, bytes: usize) {
        if let Some(last) = self.events.back_mut() {
            if let Some(added) = persistence::append_text_chunk(&mut last.event, &event) {
                last.bytes = last.bytes.saturating_add(added);
                self.bytes = self.bytes.saturating_add(added);
                return;
            }
        }
        self.bytes = self.bytes.saturating_add(bytes);
        self.events.push_back(ReplayEvent { event, bytes });
        while self.events.len() > MAX_REPLAY_EVENTS || self.bytes > MAX_REPLAY_BYTES {
            let Some(removed) = self.events.pop_front() else {
                self.bytes = 0;
                break;
            };
            self.bytes = self.bytes.saturating_sub(removed.bytes);
        }
    }
}
