//! Private, capability-bound disk storage for desktop SQL result pages.
//!
//! Result rows never enter the application SQLite database, audit/history, or a
//! renderer-owned aggregate. Each page is an independently bounded JSON file;
//! the immutable manifest is published only after the producer receipt matches
//! every page written by this store.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::executor::read::DESKTOP_STREAM_BATCH_MAX_BYTES;
use crate::kernel::access::PinnedConnection;
use crate::kernel::identity::OperationId;

use super::super::domain::{
    DesktopSqlResultExportFormat, DesktopSqlResultExportProgress, DesktopSqlResultExportReceipt,
    DesktopSqlStreamBatch, DesktopSqlStreamSinkError,
};

#[path = "desktop_result_benchmark.rs"]
#[cfg(feature = "packaged-benchmark")]
mod benchmark;
#[path = "desktop_result_files.rs"]
mod files;

use files::*;

#[cfg(feature = "packaged-benchmark")]
pub(crate) use benchmark::{run_packaged_result_store_benchmark, PackagedResultStoreMetric};

// v2 added per-cell read-failure coordinates. A v1 artifact recorded a decode
// failure as an indistinguishable text value, so it cannot be reinterpreted; it is
// rejected and the user re-runs the query deliberately.
const RESULT_STORE_SCHEMA_VERSION: u32 = 2;
const RESULT_PAGE_ROWS: usize = 256;
const MAX_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RETAINED_RESULTS: usize = 40;
const RESULT_RETENTION_DAYS: i64 = 7;

#[derive(Debug, Clone)]
pub(crate) struct DesktopSqlResultAuthority {
    pub(crate) workspace_id: Uuid,
    pub(crate) account_scope: String,
    pub(crate) connection_id: Uuid,
    pub(crate) connection_revision: i64,
    pub(crate) page_count: usize,
    pub(crate) columns: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultPageMeta {
    sequence: u64,
    row_start: usize,
    row_count: usize,
    encoded_bytes: usize,
    sha256: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultManifest {
    schema_version: u32,
    operation_id: Uuid,
    workspace_id: Uuid,
    account_scope: String,
    connection_id: Uuid,
    connection_revision: i64,
    owner_webview: String,
    capability_sha256: String,
    columns: Vec<String>,
    page_rows: usize,
    pages: Vec<ResultPageMeta>,
    row_count: usize,
    truncated: bool,
    duration_ms: u64,
    /// Cells across every page this build could not decode. A non-zero count
    /// fails the native export closed instead of writing a plausible file.
    unreadable_cell_count: usize,
    completed_at: DateTime<Utc>,
}

pub(super) struct DesktopSqlResultWriter {
    operation_id: OperationId,
    partial_directory: PathBuf,
    final_directory: PathBuf,
    workspace_id: Uuid,
    account_scope: String,
    connection_id: Uuid,
    connection_revision: i64,
    owner_webview: String,
    capability_sha256: String,
    columns: Vec<String>,
    pages: Vec<ResultPageMeta>,
    row_count: usize,
    unreadable_cell_count: usize,
    published: bool,
}

#[derive(Clone, Default)]
pub(crate) struct DesktopSqlResultStore {
    exports: Arc<Mutex<HashMap<Uuid, ActiveExport>>>,
}

struct ActiveExport {
    operation_id: OperationId,
    owner_webview: String,
    capability_sha256: String,
    cancelled: Arc<AtomicBool>,
}

impl DesktopSqlResultWriter {
    pub(super) fn begin(
        operation_id: OperationId,
        pin: &PinnedConnection,
        owner_webview: &str,
        capability: &str,
    ) -> Result<Self, DesktopSqlStreamSinkError> {
        Self::begin_with_authority(
            operation_id,
            pin.scope.workspace_id,
            pin.scope.account_scope.storage_key(),
            pin.connection_id,
            pin.connection_revision,
            owner_webview,
            capability,
        )
    }

    fn begin_with_authority(
        operation_id: OperationId,
        workspace_id: Uuid,
        account_scope: &str,
        connection_id: Uuid,
        connection_revision: i64,
        owner_webview: &str,
        capability: &str,
    ) -> Result<Self, DesktopSqlStreamSinkError> {
        let root = result_root().map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        sweep_result_root(&root).map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        let operation_uuid = Uuid::from(operation_id);
        let partial_directory = root.join(format!("{operation_uuid}.partial"));
        let final_directory = root.join(operation_uuid.to_string());
        if partial_directory.exists() || final_directory.exists() {
            return Err(DesktopSqlStreamSinkError::StreamAlreadyActive);
        }
        fs::create_dir(&partial_directory)
            .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        set_private_directory_permissions(&partial_directory)
            .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        Ok(Self {
            operation_id,
            partial_directory,
            final_directory,
            workspace_id,
            account_scope: account_scope.to_string(),
            connection_id,
            connection_revision,
            owner_webview: owner_webview.to_string(),
            capability_sha256: capability_hash(capability),
            columns: Vec::new(),
            pages: Vec::new(),
            row_count: 0,
            unreadable_cell_count: 0,
            published: false,
        })
    }

    pub(super) fn write_page(
        &mut self,
        batch: &DesktopSqlStreamBatch,
        encoded: &[u8],
    ) -> Result<(), DesktopSqlStreamSinkError> {
        if batch.operation_id != self.operation_id
            || batch.sequence != self.pages.len() as u64
            || batch.rows.len() > RESULT_PAGE_ROWS
            || encoded.len() > DESKTOP_STREAM_BATCH_MAX_BYTES
            || batch
                .rows
                .iter()
                .any(|row| row.len() != batch.columns.len())
            || !unreadable_cells_are_addressable(batch)
        {
            return Err(DesktopSqlStreamSinkError::BatchTooLarge);
        }
        if self.columns.is_empty() {
            self.columns = batch.columns.clone();
        } else if self.columns != batch.columns {
            return Err(DesktopSqlStreamSinkError::InvalidAcknowledgement);
        }
        let path = page_path(&self.partial_directory, batch.sequence);
        write_new_file_atomically(&path, encoded)
            .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        self.pages.push(ResultPageMeta {
            sequence: batch.sequence,
            row_start: self.row_count,
            row_count: batch.rows.len(),
            encoded_bytes: encoded.len(),
            sha256: bytes_sha256(encoded),
        });
        self.row_count = self.row_count.saturating_add(batch.rows.len());
        self.unreadable_cell_count = self
            .unreadable_cell_count
            .saturating_add(batch.unreadable.len());
        Ok(())
    }

    pub(super) fn read_page(
        &self,
        sequence: u64,
    ) -> Result<DesktopSqlStreamBatch, DesktopSqlStreamSinkError> {
        let meta = self
            .pages
            .get(sequence as usize)
            .filter(|meta| meta.sequence == sequence)
            .ok_or(DesktopSqlStreamSinkError::InvalidAcknowledgement)?;
        read_verified_page(
            &self.partial_directory,
            meta,
            &self.columns,
            self.operation_id,
        )
    }

    pub(super) fn complete(
        &mut self,
        row_count: usize,
        truncated: bool,
        duration_ms: u64,
    ) -> Result<(), DesktopSqlStreamSinkError> {
        if self.row_count != row_count
            || self
                .pages
                .iter()
                .enumerate()
                .any(|(index, page)| page.sequence != index as u64)
        {
            return Err(DesktopSqlStreamSinkError::ResultReceiptMismatch);
        }
        let manifest = ResultManifest {
            schema_version: RESULT_STORE_SCHEMA_VERSION,
            operation_id: Uuid::from(self.operation_id),
            workspace_id: self.workspace_id,
            account_scope: self.account_scope.clone(),
            connection_id: self.connection_id,
            connection_revision: self.connection_revision,
            owner_webview: self.owner_webview.clone(),
            capability_sha256: self.capability_sha256.clone(),
            columns: self.columns.clone(),
            page_rows: RESULT_PAGE_ROWS,
            pages: self.pages.clone(),
            row_count,
            truncated,
            duration_ms,
            unreadable_cell_count: self.unreadable_cell_count,
            completed_at: Utc::now(),
        };
        let encoded = serde_json::to_vec(&manifest)
            .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        if encoded.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(DesktopSqlStreamSinkError::ResultStoreUnavailable);
        }
        write_new_file_atomically(&self.partial_directory.join("manifest.json"), &encoded)
            .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        fs::rename(&self.partial_directory, &self.final_directory)
            .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        self.published = true;
        Ok(())
    }
}

#[cfg(feature = "packaged-benchmark")]
impl Drop for DesktopSqlResultWriter {
    fn drop(&mut self) {
        if !self.published {
            let _ = remove_result_directory(&self.partial_directory);
        }
    }
}

impl DesktopSqlResultStore {
    pub(super) fn authority(
        &self,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> AppResult<DesktopSqlResultAuthority> {
        let manifest = load_authorized_manifest(operation_id, capability, owner_webview)?;
        Ok(DesktopSqlResultAuthority {
            workspace_id: manifest.workspace_id,
            account_scope: manifest.account_scope,
            connection_id: manifest.connection_id,
            connection_revision: manifest.connection_revision,
            page_count: manifest.pages.len(),
            columns: manifest.columns,
        })
    }

    pub(super) fn read_page(
        &self,
        operation_id: OperationId,
        sequence: u64,
        capability: &str,
        owner_webview: &str,
    ) -> AppResult<DesktopSqlStreamBatch> {
        let manifest = load_authorized_manifest(operation_id, capability, owner_webview)?;
        let page = manifest
            .pages
            .get(sequence as usize)
            .filter(|page| page.sequence == sequence)
            .ok_or_else(|| AppError::NotFound("SQL result page".into()))?;
        read_verified_page(
            &completed_directory(operation_id)?,
            page,
            &manifest.columns,
            operation_id,
        )
        .map_err(|error| AppError::Safety(error.to_string()))
    }

    pub(super) fn start_export(
        &self,
        export_id: Uuid,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> AppResult<Arc<AtomicBool>> {
        let _ = load_authorized_manifest(operation_id, capability, owner_webview)?;
        let mut exports = lock_exports(&self.exports);
        if exports.contains_key(&export_id) {
            return Err(AppError::Blocked {
                reason: "SQL result export is already active".into(),
            });
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        exports.insert(
            export_id,
            ActiveExport {
                operation_id,
                owner_webview: owner_webview.to_string(),
                capability_sha256: capability_hash(capability),
                cancelled: Arc::clone(&cancelled),
            },
        );
        Ok(cancelled)
    }

    pub(super) fn finish_export(&self, export_id: Uuid) {
        lock_exports(&self.exports).remove(&export_id);
    }

    pub(super) fn cancel_export(
        &self,
        export_id: Uuid,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
    ) -> bool {
        let exports = lock_exports(&self.exports);
        let Some(export) = exports.get(&export_id) else {
            return false;
        };
        if export.operation_id != operation_id
            || export.owner_webview != owner_webview
            || !hash_matches(&export.capability_sha256, capability)
        {
            return false;
        }
        export.cancelled.store(true, Ordering::Release);
        true
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "the bounded export boundary keeps authority, destination, format, and progress ownership explicit"
    )]
    pub(super) fn export_to_path(
        &self,
        export_id: Uuid,
        operation_id: OperationId,
        capability: &str,
        owner_webview: &str,
        format: DesktopSqlResultExportFormat,
        destination: PathBuf,
        cancelled: Arc<AtomicBool>,
        mut progress: impl FnMut(DesktopSqlResultExportProgress) -> AppResult<()>,
    ) -> AppResult<DesktopSqlResultExportReceipt> {
        let manifest = load_authorized_manifest(operation_id, capability, owner_webview)?;
        let parent = destination.parent().ok_or_else(|| AppError::Blocked {
            reason: "SQL result export destination has no parent directory".into(),
        })?;
        ensure_real_directory(parent)?;
        if let Ok(metadata) = fs::symlink_metadata(&destination) {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(AppError::Blocked {
                    reason: "SQL result export destination is not a regular file".into(),
                });
            }
        }
        let partial = parent.join(format!(".dopedb-result-{export_id}.partial"));
        if partial.exists() {
            return Err(AppError::Blocked {
                reason: "SQL result export partial file already exists".into(),
            });
        }
        let result = export_manifest(
            export_id,
            &manifest,
            operation_id,
            format,
            &partial,
            &cancelled,
            &mut progress,
        );
        match result {
            Ok(rows_written) => {
                replace_file(&partial, &destination)?;
                Ok(DesktopSqlResultExportReceipt {
                    export_id,
                    operation_id,
                    rows_written,
                })
            }
            Err(error) => {
                let _ = fs::remove_file(&partial);
                Err(error)
            }
        }
    }
}

fn export_manifest(
    export_id: Uuid,
    manifest: &ResultManifest,
    operation_id: OperationId,
    format: DesktopSqlResultExportFormat,
    partial: &Path,
    cancelled: &AtomicBool,
    progress: &mut impl FnMut(DesktopSqlResultExportProgress) -> AppResult<()>,
) -> AppResult<usize> {
    // A page carries cells this build could not decode. Writing them as empty CSV
    // fields or JSON nulls would hand back a file that claims to be the result, so
    // the export stops before it creates one.
    if manifest.unreadable_cell_count > 0 {
        return Err(AppError::Blocked {
            reason: format!(
                "this result has {} cell(s) this build could not read; export is blocked so the file cannot claim they were empty",
                manifest.unreadable_cell_count
            ),
        });
    }
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(partial)?;
    let mut rows_written = 0_usize;
    match format {
        DesktopSqlResultExportFormat::Csv => {
            let mut writer = csv::WriterBuilder::new()
                .has_headers(false)
                .from_writer(BufWriter::new(file));
            writer.write_record(&manifest.columns).map_err(csv_error)?;
            for page in &manifest.pages {
                ensure_export_open(cancelled)?;
                let batch = read_verified_page(
                    &completed_directory(operation_id)?,
                    page,
                    &manifest.columns,
                    operation_id,
                )
                .map_err(|error| AppError::Safety(error.to_string()))?;
                for row in batch.rows {
                    writer
                        .write_record(row.iter().map(csv_cell))
                        .map_err(csv_error)?;
                    rows_written = rows_written.saturating_add(1);
                }
                progress(DesktopSqlResultExportProgress {
                    export_id,
                    operation_id,
                    rows_written,
                    total_rows: manifest.row_count,
                })?;
            }
            writer.flush()?;
            let writer = writer
                .into_inner()
                .map_err(|error| AppError::Io(error.into_error()))?;
            writer.get_ref().sync_all()?;
        }
        DesktopSqlResultExportFormat::Json => {
            let mut writer = BufWriter::new(file);
            writer.write_all(b"[")?;
            for page in &manifest.pages {
                ensure_export_open(cancelled)?;
                let batch = read_verified_page(
                    &completed_directory(operation_id)?,
                    page,
                    &manifest.columns,
                    operation_id,
                )
                .map_err(|error| AppError::Safety(error.to_string()))?;
                for row in batch.rows {
                    if rows_written > 0 {
                        writer.write_all(b",")?;
                    }
                    let object = manifest
                        .columns
                        .iter()
                        .cloned()
                        .zip(row)
                        .collect::<serde_json::Map<_, _>>();
                    serde_json::to_writer(&mut writer, &object)?;
                    rows_written = rows_written.saturating_add(1);
                }
                progress(DesktopSqlResultExportProgress {
                    export_id,
                    operation_id,
                    rows_written,
                    total_rows: manifest.row_count,
                })?;
            }
            writer.write_all(b"]")?;
            writer.flush()?;
            writer.get_ref().sync_all()?;
        }
    }
    ensure_export_open(cancelled)?;
    if rows_written != manifest.row_count {
        return Err(AppError::OutcomeUnknown(
            "stored SQL result row count changed during export".into(),
        ));
    }
    Ok(rows_written)
}

/// Every unreadable coordinate must address a real cell of this page; a page that
/// names a coordinate outside its own rows/columns is rejected rather than trusted.
fn unreadable_cells_are_addressable(batch: &DesktopSqlStreamBatch) -> bool {
    batch
        .unreadable
        .iter()
        .all(|cell| cell.row < batch.rows.len() && cell.column < batch.columns.len())
}

fn csv_cell(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

fn csv_error(error: csv::Error) -> AppError {
    match error.into_kind() {
        csv::ErrorKind::Io(error) => AppError::Io(error),
        other => AppError::Config(format!("SQL result CSV export failed: {other:?}")),
    }
}

fn ensure_export_open(cancelled: &AtomicBool) -> AppResult<()> {
    if cancelled.load(Ordering::Acquire) {
        Err(AppError::Safety("SQL result export cancelled".into()))
    } else {
        Ok(())
    }
}
