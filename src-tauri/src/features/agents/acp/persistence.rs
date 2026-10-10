//! Workspace-scoped ACP session persistence port and ordered batch worker.
//!
//! Streamed message and thought chunks are folded into one stored event per
//! message run, so the bounded history keeps whole conversations instead of
//! letting one long answer evict everything before it.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::Notify;

use crate::error::AppResult;
use crate::kernel::access::{ActiveResourceScope, PinnedConnection};
use crate::kernel::identity::{AcpSessionId, ConnectionId};
use crate::store::Store;

use super::super::domain::{
    AcpSessionEvent, AcpSessionEventPayload, AcpSessionFocus, AcpSessionSummary,
};

const MAX_EVENT_BYTES: usize = 512 * 1024;
/// Text folded into one stored chunk event; JSON escaping stays below the
/// per-event storage limit even for worst-case text.
const MAX_COALESCED_TEXT_BYTES: usize = 192 * 1024;
/// Boundaries (tool calls, turn ends, permissions) flush at once; a streaming
/// answer is rewritten at most this often instead of once per token batch.
const PERSIST_BATCH_DELAY: Duration = Duration::from_millis(750);
const MAX_PERSIST_BATCH_EVENTS: usize = 64;
const MAX_PERSIST_BATCH_BYTES: usize = 256 * 1024;

type PersistenceFuture<'a, T> = Pin<Box<dyn Future<Output = AppResult<T>> + Send + 'a>>;

pub(super) trait AcpSessionPersistencePort: Send + Sync {
    fn active_resource_scope(&self) -> PersistenceFuture<'_, ActiveResourceScope>;
    fn list_sessions(&self) -> PersistenceFuture<'_, Vec<AcpSessionSummary>>;
    fn focus_session(
        &self,
        id: AcpSessionId,
        after_sequence: Option<u64>,
    ) -> PersistenceFuture<'_, AcpSessionFocus>;
    fn pin_connection(&self, id: ConnectionId) -> PersistenceFuture<'_, PinnedConnection>;
    fn persist_session<'a>(
        &'a self,
        scope: &'a ActiveResourceScope,
        summary: &'a AcpSessionSummary,
    ) -> PersistenceFuture<'a, ()>;
    fn persist_events<'a>(
        &'a self,
        scope: &'a ActiveResourceScope,
        summary: &'a AcpSessionSummary,
        events: &'a [AcpSessionEvent],
        replaced_sequences: &'a [u64],
    ) -> PersistenceFuture<'a, ()>;
}

pub(super) struct StoreAcpSessionPersistence {
    store: Store,
}

impl StoreAcpSessionPersistence {
    pub(super) fn new(store: Store) -> Self {
        Self { store }
    }
}

impl AcpSessionPersistencePort for StoreAcpSessionPersistence {
    fn active_resource_scope(&self) -> PersistenceFuture<'_, ActiveResourceScope> {
        Box::pin(self.store.active_resource_scope())
    }

    fn list_sessions(&self) -> PersistenceFuture<'_, Vec<AcpSessionSummary>> {
        Box::pin(self.store.list_agent_acp_sessions())
    }

    fn focus_session(
        &self,
        id: AcpSessionId,
        after_sequence: Option<u64>,
    ) -> PersistenceFuture<'_, AcpSessionFocus> {
        Box::pin(self.store.focus_agent_acp_session(id, after_sequence))
    }

    fn pin_connection(&self, id: ConnectionId) -> PersistenceFuture<'_, PinnedConnection> {
        Box::pin(self.store.pin_connection_for_read(id.into()))
    }

    fn persist_session<'a>(
        &'a self,
        scope: &'a ActiveResourceScope,
        summary: &'a AcpSessionSummary,
    ) -> PersistenceFuture<'a, ()> {
        Box::pin(self.store.persist_agent_acp_session(scope, summary))
    }

    fn persist_events<'a>(
        &'a self,
        scope: &'a ActiveResourceScope,
        summary: &'a AcpSessionSummary,
        events: &'a [AcpSessionEvent],
        replaced_sequences: &'a [u64],
    ) -> PersistenceFuture<'a, ()> {
        Box::pin(self.store.persist_agent_acp_event_batch(
            scope,
            summary,
            events,
            replaced_sequences,
        ))
    }
}

pub(super) struct PersistenceRequest {
    /// Boundary events carry the current summary; streamed chunks reuse the
    /// worker's last summary with a newer timestamp instead of cloning it.
    pub(super) summary: Option<AcpSessionSummary>,
    pub(super) event: AcpSessionEvent,
    pub(super) bytes: usize,
    pub(super) immediate: bool,
}

/// The stored row of the message run being streamed, kept across batches so a
/// continuing answer replaces its previous row instead of adding new ones.
struct OpenRun {
    event: AcpSessionEvent,
    persisted_sequence: Option<u64>,
    dirty: bool,
}

#[derive(Default)]
struct PersistBatch {
    writes: Vec<AcpSessionEvent>,
    replaced: Vec<u64>,
}

impl PersistBatch {
    fn flush_run(&mut self, run: &mut OpenRun) {
        if !run.dirty {
            return;
        }
        if let Some(previous) = run
            .persisted_sequence
            .filter(|previous| *previous != run.event.sequence)
        {
            self.replaced.push(previous);
        }
        self.writes.push(run.event.clone());
        run.persisted_sequence = Some(run.event.sequence);
        run.dirty = false;
    }

    fn add(&mut self, run: &mut Option<OpenRun>, event: AcpSessionEvent) {
        if is_text_chunk(&event.payload) {
            if let Some(open) = run.as_mut() {
                if append_text_chunk(&mut open.event, &event).is_some() {
                    open.dirty = true;
                    return;
                }
            }
            if let Some(mut finished) = run.take() {
                self.flush_run(&mut finished);
            }
            *run = Some(OpenRun {
                event,
                persisted_sequence: None,
                dirty: true,
            });
            return;
        }
        if let Some(mut finished) = run.take() {
            self.flush_run(&mut finished);
        }
        self.writes.push(event);
    }
}

pub(super) enum PersistenceCommand {
    Event(Box<PersistenceRequest>),
    Shutdown,
}

#[derive(Default)]
pub(super) struct PersistenceTracker {
    pending: AtomicUsize,
    idle: Notify,
}

impl PersistenceTracker {
    pub(super) fn begin(&self) {
        self.pending.fetch_add(1, Ordering::SeqCst);
    }

    pub(super) fn finish(&self) {
        self.finish_many(1);
    }

    fn finish_many(&self, count: usize) {
        debug_assert!(count > 0);
        if self.pending.fetch_sub(count, Ordering::SeqCst) == count {
            self.idle.notify_waiters();
        }
    }

    pub(super) async fn wait_for_idle(&self) {
        loop {
            let notified = self.idle.notified();
            if self.pending.load(Ordering::SeqCst) == 0 {
                return;
            }
            notified.await;
        }
    }
}

pub(super) async fn run_worker(
    initial_summary: AcpSessionSummary,
    persistence: Arc<dyn AcpSessionPersistencePort>,
    scope: ActiveResourceScope,
    tracker: Arc<PersistenceTracker>,
    mut requests: tokio::sync::mpsc::UnboundedReceiver<PersistenceCommand>,
) {
    let session_id = initial_summary.id;
    let mut closed = false;
    let mut summary = initial_summary;
    let mut run: Option<OpenRun> = None;
    while !closed {
        let first = match requests.recv().await {
            Some(PersistenceCommand::Event(request)) => request,
            Some(PersistenceCommand::Shutdown) | None => break,
        };
        let mut batch = PersistBatch::default();
        let mut request_count = 1;
        let mut bytes = first.bytes;
        let mut immediate = first.immediate;
        let mut latest_at = first.event.created_at;
        if let Some(current) = first.summary {
            summary = current;
        }
        batch.add(&mut run, first.event);
        let deadline = tokio::time::Instant::now() + PERSIST_BATCH_DELAY;

        while !immediate
            && request_count < MAX_PERSIST_BATCH_EVENTS
            && bytes < MAX_PERSIST_BATCH_BYTES
        {
            match tokio::time::timeout_at(deadline, requests.recv()).await {
                Ok(Some(PersistenceCommand::Event(request))) => {
                    request_count += 1;
                    bytes = bytes.saturating_add(request.bytes);
                    immediate = request.immediate;
                    latest_at = request.event.created_at;
                    if let Some(current) = request.summary {
                        summary = current;
                    }
                    batch.add(&mut run, request.event);
                }
                Ok(Some(PersistenceCommand::Shutdown)) | Ok(None) => {
                    closed = true;
                    break;
                }
                Err(_) => break,
            }
        }
        if let Some(open) = run.as_mut() {
            batch.flush_run(open);
        }
        if summary.updated_at < latest_at {
            summary.updated_at = latest_at;
        }
        let events = batch.writes;
        let first_sequence = events
            .first()
            .map(|event| event.sequence)
            .unwrap_or_default();
        let last_sequence = events
            .last()
            .map(|event| event.sequence)
            .unwrap_or_default();
        let event_count = events.len();
        if let Err(error) = persistence
            .persist_events(&scope, &summary, &events, &batch.replaced)
            .await
        {
            tracing::warn!(
                %session_id,
                first_sequence,
                last_sequence,
                event_count,
                %error,
                "could not persist ACP session event batch"
            );
        } else {
            tracing::trace!(
                %session_id,
                first_sequence,
                last_sequence,
                event_count,
                immediate,
                "persisted ACP session event batch"
            );
        }
        tracker.finish_many(request_count);
    }
}

fn is_text_chunk(payload: &AcpSessionEventPayload) -> bool {
    !is_boundary(payload)
}

/// Fold `next` into `target` when both are streamed text chunks of the same
/// kind and message. The folded event takes the newest sequence, so a replay
/// that covers it also covers every chunk it absorbed. Returns the added bytes.
pub(super) fn append_text_chunk(
    target: &mut AcpSessionEvent,
    next: &AcpSessionEvent,
) -> Option<usize> {
    let (
        AcpSessionEventPayload::SessionUpdate { update: current },
        AcpSessionEventPayload::SessionUpdate { update: incoming },
    ) = (&mut target.payload, &next.payload)
    else {
        return None;
    };
    let kind = incoming.get("sessionUpdate").and_then(Value::as_str)?;
    if !matches!(kind, "agent_message_chunk" | "agent_thought_chunk")
        || current.get("sessionUpdate").and_then(Value::as_str) != Some(kind)
        || current.get("messageId") != incoming.get("messageId")
    {
        return None;
    }
    let content = incoming.get("content")?;
    if content.get("type").and_then(Value::as_str) != Some("text") {
        return None;
    }
    let addition = content.get("text").and_then(Value::as_str)?;
    let existing = current.get_mut("content")?;
    if existing.get("type").and_then(Value::as_str) != Some("text") {
        return None;
    }
    let Some(Value::String(text)) = existing.get_mut("text") else {
        return None;
    };
    if text.len().saturating_add(addition.len()) > MAX_COALESCED_TEXT_BYTES {
        return None;
    }
    text.push_str(addition);
    target.sequence = next.sequence;
    target.created_at = next.created_at;
    Some(addition.len())
}

pub(super) fn is_boundary(payload: &AcpSessionEventPayload) -> bool {
    !matches!(
        payload,
        AcpSessionEventPayload::SessionUpdate { update }
            if matches!(
                update.get("sessionUpdate").and_then(serde_json::Value::as_str),
                Some("agent_message_chunk" | "agent_thought_chunk")
            )
    )
}

pub(super) fn event_bytes(event: &AcpSessionEvent) -> usize {
    serde_json::to_vec(event)
        .map(|encoded| encoded.len())
        .unwrap_or(MAX_EVENT_BYTES)
}
