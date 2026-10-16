//! Single-writer, capability-bound pull/ACK backpressure for desktop SQL streams.
//!
//! The producer serializes each page once. A durable page is written to its
//! result artifact under that stream's own writer lock — never the registry-wide
//! lock — and the single in-flight page stays in memory so the renderer's pull
//! needs no file read, hash, or parse.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;
use uuid::Uuid;

use crate::executor::read::DESKTOP_STREAM_BATCH_MAX_BYTES;
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::OperationId;
use crate::kernel::sync::lock_unpoisoned;

use super::super::domain::{
    DesktopSqlResultExportFormat, DesktopSqlResultExportProgress, DesktopSqlResultExportReceipt,
    DesktopSqlStreamBatch, DesktopSqlStreamReady, DesktopSqlStreamSinkError,
};
use super::desktop_result_store::{
    DesktopSqlResultAuthority, DesktopSqlResultStore, DesktopSqlResultWriter,
};

pub(super) const MAX_IN_FLIGHT_BATCHES: usize = 1;
pub(super) const STREAM_ACK_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Default)]
pub(crate) struct DesktopSqlStreamRegistry {
    streams: Arc<Mutex<HashMap<OperationId, StreamCredit>>>,
    pending: Arc<Mutex<HashMap<String, PendingStream>>>,
    results: DesktopSqlResultStore,
}

struct PendingStream {
    owner_webview: String,
    cancelled: bool,
    retention: DesktopSqlStreamRetention,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum DesktopSqlStreamRetention {
    Durable,
    Ephemeral,
}

struct StreamCredit {
    next_sequence: u64,
    in_flight: Option<u64>,
    pulled: bool,
    cancelled: bool,
    owner_webview: String,
    capability: String,
    retention: DesktopSqlStreamRetention,
    started: bool,
    result_writer: Option<Arc<Mutex<DesktopSqlResultWriter>>>,
    /// The ephemeral (never persisted) page awaiting its pull.
    ephemeral_batch: Option<DesktopSqlStreamBatch>,
    /// The durable page awaiting its pull. It is already written to the result
    /// artifact; keeping it in memory spares the pull a file read and hash.
    durable_page: Option<DesktopSqlStreamBatch>,
    /// Versioned state change signal. A waiter subscribes before inspecting the
    /// credit, so an ACK between unlock and await is observed rather than lost.
    changed: watch::Sender<u64>,
}

/// The sole owning handle. It closes the retained page if the query/Tauri future
/// is aborted; per-page callbacks receive only [`StreamBorrow`].
pub(super) struct DesktopSqlStreamSession {
    operation_id: OperationId,
    registry: DesktopSqlStreamRegistry,
    active: bool,
}

#[derive(Clone)]
pub(super) struct StreamBorrow {
    operation_id: OperationId,
    registry: DesktopSqlStreamRegistry,
}

impl DesktopSqlStreamRegistry {
    pub(crate) fn reserve_pending(
        &self,
        owner_webview: String,
        capability: String,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        self.reserve_pending_with_retention(
            owner_webview,
            capability,
            DesktopSqlStreamRetention::Durable,
        )
    }

    /// A table page is already bounded by its SQL LIMIT and never becomes a
    /// persistent result artifact. It retains only the single in-flight page
    /// until the owning renderer acknowledges it.
    pub(crate) fn reserve_pending_ephemeral(
        &self,
        owner_webview: String,
        capability: String,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        self.reserve_pending_with_retention(
            owner_webview,
            capability,
            DesktopSqlStreamRetention::Ephemeral,
        )
    }

    fn reserve_pending_with_retention(
        &self,
        owner_webview: String,
        capability: String,
        retention: DesktopSqlStreamRetention,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        Self::validate_capability(&capability)?;
        let mut pending = lock_unpoisoned(&self.pending);
        if pending
            .insert(
                capability,
                PendingStream {
                    owner_webview,
                    cancelled: false,
                    retention,
                },
            )
            .is_some()
        {
            return Err(DesktopSqlStreamSinkError::StreamAlreadyActive);
        }
        Ok(())
    }

    pub(crate) fn bind_pending(
        &self,
        operation_id: OperationId,
        owner_webview: String,
        capability: String,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        let pending = lock_unpoisoned(&self.pending).remove(&capability);
        let Some(pending) = pending else {
            return Err(DesktopSqlStreamSinkError::Cancelled);
        };
        if pending.owner_webview != owner_webview || pending.cancelled {
            return Err(DesktopSqlStreamSinkError::Cancelled);
        }
        self.reserve_with_retention(operation_id, owner_webview, capability, pending.retention)
    }

    pub(crate) fn reserve(
        &self,
        operation_id: OperationId,
        owner_webview: String,
        capability: String,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        self.reserve_with_retention(
            operation_id,
            owner_webview,
            capability,
            DesktopSqlStreamRetention::Durable,
        )
    }

    fn reserve_with_retention(
        &self,
        operation_id: OperationId,
        owner_webview: String,
        capability: String,
        retention: DesktopSqlStreamRetention,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        Self::validate_capability(&capability)?;
        let mut streams = lock_unpoisoned(&self.streams);
        if streams.contains_key(&operation_id) {
            return Err(DesktopSqlStreamSinkError::StreamAlreadyActive);
        }
        let (changed, _) = watch::channel(0_u64);
        streams.insert(
            operation_id,
            StreamCredit {
                next_sequence: 0,
                in_flight: None,
                pulled: false,
                cancelled: false,
                owner_webview,
                capability,
                retention,
                started: false,
                result_writer: None,
                ephemeral_batch: None,
                durable_page: None,
                changed,
            },
        );
        Ok(())
    }

    fn validate_capability(capability: &str) -> Result<(), DesktopSqlStreamSinkError> {
        if capability.len() != 64 || !capability.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(DesktopSqlStreamSinkError::InvalidAcknowledgement);
        }
        Ok(())
    }

    pub(super) fn begin_reserved(
        &self,
        operation_id: OperationId,
        owner_webview: &str,
        capability: &str,
        pin: Option<&PinnedConnection>,
    ) -> Result<DesktopSqlStreamSession, DesktopSqlStreamSinkError> {
        let mut streams = lock_unpoisoned(&self.streams);
        let Some(stream) = streams.get_mut(&operation_id) else {
            return Err(DesktopSqlStreamSinkError::StreamNotActive);
        };
        if stream.owner_webview != owner_webview || stream.capability != capability {
            return Err(DesktopSqlStreamSinkError::InvalidAcknowledgement);
        }
        if stream.started {
            return Err(DesktopSqlStreamSinkError::StreamAlreadyActive);
        }
        // A capability-only cancellation can land after binding but before the
        // executor registers its cancellation slot; never start such a stream.
        if stream.cancelled {
            return Err(DesktopSqlStreamSinkError::Cancelled);
        }
        stream.started = true;
        if stream.retention == DesktopSqlStreamRetention::Durable {
            let pin = pin.ok_or(DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
            stream.result_writer = Some(Arc::new(Mutex::new(DesktopSqlResultWriter::begin(
                operation_id,
                pin,
                owner_webview,
                capability,
            )?)));
        }
        drop(streams);
        Ok(DesktopSqlStreamSession {
            operation_id,
            registry: self.clone(),
            active: true,
        })
    }

    pub(crate) fn is_cancelled(&self, operation_id: OperationId) -> bool {
        lock_unpoisoned(&self.streams)
            .get(&operation_id)
            .is_some_and(|stream| stream.cancelled)
    }

    /// An authenticated, but invalid, owner request stops its own operation.
    /// Capability or webview mismatches deliberately return no detail and must
    /// never let a different renderer cancel a stream it does not own.
    fn reject_owned(stream: &mut StreamCredit) {
        stream.cancelled = true;
        stream
            .changed
            .send_modify(|version| *version = version.saturating_add(1));
    }

    pub(crate) fn pull(
        &self,
        operation_id: OperationId,
        sequence: u64,
        capability: &str,
        owner_webview: &str,
    ) -> Option<DesktopSqlStreamBatch> {
        let mut streams = lock_unpoisoned(&self.streams);
        let stream = streams.get_mut(&operation_id)?;
        if stream.capability != capability || stream.owner_webview != owner_webview {
            return None;
        }
        if stream.cancelled || stream.in_flight != Some(sequence) || stream.pulled {
            Self::reject_owned(stream);
            return None;
        }
        // A durable page was persisted before its ready notification; serve the
        // in-memory copy once instead of re-reading and re-hashing the file.
        let batch = match stream.retention {
            DesktopSqlStreamRetention::Durable => stream.durable_page.take(),
            DesktopSqlStreamRetention::Ephemeral => stream.ephemeral_batch.take(),
        }
        .filter(|batch| batch.sequence == sequence)?;
        stream.pulled = true;
        Some(batch)
    }

    pub(crate) fn acknowledge(
        &self,
        operation_id: OperationId,
        sequence: u64,
        capability: &str,
        owner_webview: &str,
    ) -> bool {
        let mut streams = lock_unpoisoned(&self.streams);
        let Some(stream) = streams.get_mut(&operation_id) else {
            return false;
        };
        if stream.capability != capability || stream.owner_webview != owner_webview {
            return false;
        }
        if stream.cancelled || stream.in_flight != Some(sequence) || !stream.pulled {
            Self::reject_owned(stream);
            return false;
        }
        stream.in_flight = None;
        stream.pulled = false;
        stream.ephemeral_batch = None;
        stream.durable_page = None;
        stream.next_sequence = stream.next_sequence.saturating_add(1);
        stream
            .changed
            .send_modify(|version| *version = version.saturating_add(1));
        true
    }

    pub(crate) fn cancel(
        &self,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> bool {
        let mut streams = lock_unpoisoned(&self.streams);
        let Some(stream) = streams.get_mut(&operation_id) else {
            return false;
        };
        if stream.capability != capability || stream.owner_webview != owner_webview {
            return false;
        }
        Self::reject_owned(stream);
        true
    }

    pub(crate) fn cancel_pending(&self, capability: &str, owner_webview: &str) -> bool {
        let mut pending = lock_unpoisoned(&self.pending);
        let Some(stream) = pending.get_mut(capability) else {
            return false;
        };
        if stream.owner_webview != owner_webview {
            return false;
        }
        stream.cancelled = true;
        true
    }

    /// Cancels the bound stream this exact capability owns. An auto-run read
    /// learns its operation only from its first batch, so a cancellation sent
    /// before that batch names just the capability while the operation already
    /// runs. Returns that operation so its executor is cancelled as well.
    pub(crate) fn cancel_bound_by_capability(
        &self,
        capability: &str,
        owner_webview: &str,
    ) -> Option<OperationId> {
        let mut streams = lock_unpoisoned(&self.streams);
        let (operation_id, stream) = streams.iter_mut().find(|(_, stream)| {
            stream.capability == capability && stream.owner_webview == owner_webview
        })?;
        Self::reject_owned(stream);
        Some(*operation_id)
    }

    pub(crate) fn forget_pending(&self, capability: &str, owner_webview: &str) {
        let mut pending = lock_unpoisoned(&self.pending);
        if pending
            .get(capability)
            .is_some_and(|stream| stream.owner_webview == owner_webview)
        {
            pending.remove(capability);
        }
    }

    pub(crate) fn close(&self, operation_id: OperationId) -> bool {
        let removed = lock_unpoisoned(&self.streams).remove(&operation_id);
        let Some(stream) = removed else {
            return false;
        };
        stream
            .changed
            .send_modify(|version| *version = version.saturating_add(1));
        // The owner cancelled: the pages it already received stay readable as a
        // partial result instead of being discarded with the stream.
        if stream.cancelled {
            if let Some(writer) = stream.result_writer.as_ref() {
                let _ = lock_unpoisoned(writer).complete_cancelled();
            }
        }
        true
    }

    fn complete(
        &self,
        operation_id: OperationId,
        row_count: usize,
        truncated: bool,
        duration_ms: u64,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        let stream = lock_unpoisoned(&self.streams)
            .remove(&operation_id)
            .ok_or(DesktopSqlStreamSinkError::StreamNotActive)?;
        stream
            .changed
            .send_modify(|version| *version = version.saturating_add(1));
        if stream.cancelled || stream.in_flight.is_some() {
            return Err(if stream.cancelled {
                DesktopSqlStreamSinkError::Cancelled
            } else {
                DesktopSqlStreamSinkError::InvalidAcknowledgement
            });
        }
        if stream.ephemeral_batch.is_some() || stream.durable_page.is_some() {
            return Err(DesktopSqlStreamSinkError::InvalidAcknowledgement);
        }
        match stream.retention {
            DesktopSqlStreamRetention::Durable => lock_unpoisoned(
                stream
                    .result_writer
                    .as_ref()
                    .ok_or(DesktopSqlStreamSinkError::ResultStoreUnavailable)?,
            )
            .complete(row_count, truncated, duration_ms),
            DesktopSqlStreamRetention::Ephemeral => Ok(()),
        }
    }

    pub(crate) fn result_authority(
        &self,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> crate::error::AppResult<DesktopSqlResultAuthority> {
        self.results
            .authority(operation_id, capability, owner_webview)
    }

    pub(crate) fn read_result_page(
        &self,
        operation_id: OperationId,
        sequence: u64,
        capability: &str,
        owner_webview: &str,
    ) -> crate::error::AppResult<DesktopSqlStreamBatch> {
        self.results
            .read_page(operation_id, sequence, capability, owner_webview)
    }

    pub(crate) fn start_result_export(
        &self,
        export_id: Uuid,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> crate::error::AppResult<Arc<std::sync::atomic::AtomicBool>> {
        self.results
            .start_export(export_id, operation_id, capability, owner_webview)
    }

    pub(crate) fn finish_result_export(&self, export_id: Uuid) {
        self.results.finish_export(export_id);
    }

    pub(crate) fn cancel_result_export(
        &self,
        export_id: Uuid,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> bool {
        self.results
            .cancel_export(export_id, operation_id, capability, owner_webview)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn export_result_to_path(
        &self,
        export_id: Uuid,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
        format: DesktopSqlResultExportFormat,
        destination: std::path::PathBuf,
        cancelled: Arc<std::sync::atomic::AtomicBool>,
        progress: impl FnMut(DesktopSqlResultExportProgress) -> crate::error::AppResult<()>,
    ) -> crate::error::AppResult<DesktopSqlResultExportReceipt> {
        self.results.export_to_path(
            export_id,
            operation_id,
            capability,
            owner_webview,
            format,
            destination,
            cancelled,
            progress,
        )
    }
}

impl Drop for DesktopSqlStreamSession {
    fn drop(&mut self) {
        if self.active {
            self.registry.close(self.operation_id);
        }
    }
}

impl DesktopSqlStreamSession {
    pub(super) fn is_ephemeral(&self) -> bool {
        lock_unpoisoned(&self.registry.streams)
            .get(&self.operation_id)
            .is_some_and(|stream| stream.retention == DesktopSqlStreamRetention::Ephemeral)
    }

    pub(super) fn borrow(&self) -> StreamBorrow {
        StreamBorrow {
            operation_id: self.operation_id,
            registry: self.registry.clone(),
        }
    }

    pub(super) fn close(&mut self) {
        if self.active {
            self.registry.close(self.operation_id);
            self.active = false;
        }
    }

    pub(super) fn complete(
        &mut self,
        row_count: usize,
        truncated: bool,
        duration_ms: u64,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        if !self.active {
            return Err(DesktopSqlStreamSinkError::StreamNotActive);
        }
        let result = self
            .registry
            .complete(self.operation_id, row_count, truncated, duration_ms);
        self.active = false;
        result
    }
}

impl StreamBorrow {
    pub(super) fn dispatch<E>(
        &self,
        sequence: u64,
        batch: DesktopSqlStreamBatch,
        emit: impl FnOnce(DesktopSqlStreamReady) -> Result<(), E>,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        let writer = {
            let mut streams = lock_unpoisoned(&self.registry.streams);
            let stream = streams
                .get_mut(&self.operation_id)
                .ok_or(DesktopSqlStreamSinkError::StreamNotActive)?;
            if stream.cancelled {
                return Err(DesktopSqlStreamSinkError::Cancelled);
            }
            if usize::from(stream.in_flight.is_some()) >= MAX_IN_FLIGHT_BATCHES
                || stream.next_sequence != sequence
            {
                return Err(DesktopSqlStreamSinkError::InvalidAcknowledgement);
            }
            stream.in_flight = Some(sequence);
            stream.pulled = false;
            match stream.retention {
                DesktopSqlStreamRetention::Durable => Some(Arc::clone(
                    stream
                        .result_writer
                        .as_ref()
                        .ok_or(DesktopSqlStreamSinkError::ResultStoreUnavailable)?,
                )),
                DesktopSqlStreamRetention::Ephemeral => None,
            }
        };
        // Serialize once: the same bytes bound the page and become its file.
        // Only an ephemeral (never persisted) page skips the encoding.
        if let Some(writer) = writer {
            let encoded =
                serde_json::to_vec(&batch).map_err(|_| DesktopSqlStreamSinkError::BatchTooLarge)?;
            if batch.rows.len() > 256 || encoded.len() > DESKTOP_STREAM_BATCH_MAX_BYTES {
                return Err(DesktopSqlStreamSinkError::BatchTooLarge);
            }
            lock_unpoisoned(&writer).write_page(&batch, &encoded)?;
        } else if batch.rows.len() > 256 || encoded_len(&batch)? > DESKTOP_STREAM_BATCH_MAX_BYTES {
            return Err(DesktopSqlStreamSinkError::BatchTooLarge);
        }
        let ready = {
            let mut streams = lock_unpoisoned(&self.registry.streams);
            let stream = streams
                .get_mut(&self.operation_id)
                .ok_or(DesktopSqlStreamSinkError::StreamNotActive)?;
            if stream.cancelled {
                return Err(DesktopSqlStreamSinkError::Cancelled);
            }
            if stream.in_flight != Some(sequence) {
                return Err(DesktopSqlStreamSinkError::InvalidAcknowledgement);
            }
            match stream.retention {
                DesktopSqlStreamRetention::Durable => {
                    stream.durable_page = Some(batch);
                }
                DesktopSqlStreamRetention::Ephemeral => {
                    stream.ephemeral_batch = Some(batch);
                }
            }
            DesktopSqlStreamReady {
                operation_id: self.operation_id,
                sequence,
                capability: stream.capability.clone(),
            }
        };
        emit(ready).map_err(|_| DesktopSqlStreamSinkError::ReceiverDropped)
    }

    pub(super) async fn wait_for_ack(
        &self,
        sequence: u64,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        self.wait_for_ack_with_hook(sequence, || {}).await
    }

    async fn wait_for_ack_with_hook(
        &self,
        sequence: u64,
        mut after_subscribe: impl FnMut(),
    ) -> Result<(), DesktopSqlStreamSinkError> {
        let timeout = tokio::time::sleep(STREAM_ACK_TIMEOUT);
        tokio::pin!(timeout);
        loop {
            let mut changed = {
                let streams = lock_unpoisoned(&self.registry.streams);
                let stream = streams
                    .get(&self.operation_id)
                    .ok_or(DesktopSqlStreamSinkError::StreamNotActive)?;
                // Subscribe while the mutex protects the state. `watch` retains
                // the version, so the subsequent `changed()` cannot miss an ACK.
                let changed = stream.changed.subscribe();
                if stream.cancelled {
                    return Err(DesktopSqlStreamSinkError::Cancelled);
                }
                if stream.in_flight.is_none() && stream.next_sequence == sequence.saturating_add(1)
                {
                    return Ok(());
                }
                if stream.in_flight != Some(sequence) {
                    return Err(DesktopSqlStreamSinkError::InvalidAcknowledgement);
                }
                changed
            };
            after_subscribe();
            tokio::select! {
                _ = changed.changed() => {},
                _ = &mut timeout => return Err(DesktopSqlStreamSinkError::AcknowledgementTimedOut),
            }
        }
    }
}

/// Serialized size of a page that is never persisted, counted without allocating.
fn encoded_len(batch: &DesktopSqlStreamBatch) -> Result<usize, DesktopSqlStreamSinkError> {
    struct Counter(usize);
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter(0);
    serde_json::to_writer(&mut counter, batch)
        .map_err(|_| DesktopSqlStreamSinkError::BatchTooLarge)?;
    Ok(counter.0)
}

#[cfg(test)]
pub(crate) fn assert_ephemeral_page_contract() {
    let registry = DesktopSqlStreamRegistry::default();
    let operation_id = Uuid::new_v4().into();
    let capability = "a".repeat(64);
    registry
        .reserve_pending_ephemeral("main".into(), capability.clone())
        .expect("reserve ephemeral page");
    registry
        .bind_pending(operation_id, "main".into(), capability.clone())
        .expect("bind ephemeral page");
    let mut session = registry
        .begin_reserved(operation_id, "main", &capability, None)
        .expect("begin without disk authority");
    assert!(session.is_ephemeral());

    let batch = DesktopSqlStreamBatch {
        operation_id,
        sequence: 0,
        row_start: 0,
        columns: vec![
            "null_value".into(),
            "empty_value".into(),
            "literal_marker".into(),
            "sentinel_json".into(),
            "failed_geometry".into(),
        ],
        rows: vec![vec![
            serde_json::Value::Null,
            serde_json::json!(""),
            serde_json::json!("<unsupported: geometry>"),
            serde_json::json!({"decodeFailure": true, "databaseType": "geometry"}),
            serde_json::Value::Null,
        ]],
        decode_failures: vec![crate::model::CellDecodeFailure {
            row_index: 0,
            column_index: 4,
            database_type: "geometry".into(),
        }],
    };
    session
        .borrow()
        .dispatch(0, batch.clone(), |_| Ok::<_, ()>(()))
        .expect("dispatch retained page");
    let pulled = registry
        .pull(operation_id, 0, &capability, "main")
        .expect("pull retained page");
    assert_eq!(pulled.operation_id, batch.operation_id);
    assert_eq!(pulled.sequence, batch.sequence);
    assert_eq!(pulled.columns, batch.columns);
    assert_eq!(pulled.rows, batch.rows);
    assert_eq!(pulled.decode_failures, batch.decode_failures);
    assert!(registry.acknowledge(operation_id, 0, &capability, "main"));
    session.complete(1, false, 1).expect("complete page");

    // A cancellation that names only the capability (the renderer has not yet
    // learned the operation from a first batch) must stop an already-bound
    // stream, never one owned by another webview, and the stream never starts.
    let bound_operation: OperationId = Uuid::new_v4().into();
    let bound_capability = "b".repeat(64);
    registry
        .reserve_pending_ephemeral("main".into(), bound_capability.clone())
        .expect("reserve capability-cancel stream");
    registry
        .bind_pending(bound_operation, "main".into(), bound_capability.clone())
        .expect("bind capability-cancel stream");
    assert!(!registry.cancel_pending(&bound_capability, "main"));
    assert!(registry
        .cancel_bound_by_capability(&bound_capability, "other")
        .is_none());
    assert!(
        registry.cancel_bound_by_capability(&bound_capability, "main") == Some(bound_operation)
    );
    assert!(registry.is_cancelled(bound_operation));
    assert!(matches!(
        registry.begin_reserved(bound_operation, "main", &bound_capability, None),
        Err(DesktopSqlStreamSinkError::Cancelled)
    ));
}
