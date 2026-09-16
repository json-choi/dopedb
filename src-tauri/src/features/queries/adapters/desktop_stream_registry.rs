//! Single-writer, capability-bound pull/ACK backpressure for desktop SQL streams.

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
    result_writer: Option<DesktopSqlResultWriter>,
    ephemeral_batch: Option<DesktopSqlStreamBatch>,
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
        stream.started = true;
        if stream.retention == DesktopSqlStreamRetention::Durable {
            let pin = pin.ok_or(DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
            stream.result_writer = Some(DesktopSqlResultWriter::begin(
                operation_id,
                pin,
                owner_webview,
                capability,
            )?);
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
        let batch = match stream.retention {
            DesktopSqlStreamRetention::Durable => {
                stream.result_writer.as_ref()?.read_page(sequence).ok()?
            }
            DesktopSqlStreamRetention::Ephemeral => stream.ephemeral_batch.clone()?,
        };
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
        if let Some(stream) = removed {
            stream
                .changed
                .send_modify(|version| *version = version.saturating_add(1));
            true
        } else {
            false
        }
    }

    fn complete(
        &self,
        operation_id: OperationId,
        row_count: usize,
        truncated: bool,
        duration_ms: u64,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        let mut stream = lock_unpoisoned(&self.streams)
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
        match stream.retention {
            DesktopSqlStreamRetention::Durable => stream
                .result_writer
                .as_mut()
                .ok_or(DesktopSqlStreamSinkError::ResultStoreUnavailable)?
                .complete(row_count, truncated, duration_ms),
            DesktopSqlStreamRetention::Ephemeral => {
                if stream.ephemeral_batch.is_some() {
                    Err(DesktopSqlStreamSinkError::InvalidAcknowledgement)
                } else {
                    Ok(())
                }
            }
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
        let encoded =
            serde_json::to_vec(&batch).map_err(|_| DesktopSqlStreamSinkError::BatchTooLarge)?;
        if batch.rows.len() > 256 || encoded.len() > DESKTOP_STREAM_BATCH_MAX_BYTES {
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
            if usize::from(stream.in_flight.is_some()) >= MAX_IN_FLIGHT_BATCHES
                || stream.next_sequence != sequence
            {
                return Err(DesktopSqlStreamSinkError::InvalidAcknowledgement);
            }
            stream.in_flight = Some(sequence);
            stream.pulled = false;
            match stream.retention {
                DesktopSqlStreamRetention::Durable => stream
                    .result_writer
                    .as_mut()
                    .ok_or(DesktopSqlStreamSinkError::ResultStoreUnavailable)?
                    .write_page(&batch, &encoded)?,
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
}
