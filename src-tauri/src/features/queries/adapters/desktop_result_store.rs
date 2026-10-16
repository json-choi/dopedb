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

pub(crate) use files::save_renderer_export;
use files::*;

#[cfg(feature = "packaged-benchmark")]
pub(crate) use benchmark::{run_packaged_result_store_benchmark, PackagedResultStoreMetric};

const RESULT_STORE_SCHEMA_VERSION: u32 = 1;
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
            || batch.row_start != self.row_count
            || batch.rows.len() > RESULT_PAGE_ROWS
            || encoded.len() > DESKTOP_STREAM_BATCH_MAX_BYTES
            || batch
                .rows
                .iter()
                .any(|row| row.len() != batch.columns.len())
            || batch.decode_failures.iter().any(|failure| {
                failure.row_index < self.row_count
                    || failure.row_index >= self.row_count.saturating_add(batch.rows.len())
                    || failure.column_index >= batch.columns.len()
                    || !failure_cell_is_consistent(
                        failure,
                        &batch.rows[failure.row_index - self.row_count][failure.column_index],
                    )
            })
        {
            return Err(DesktopSqlStreamSinkError::BatchTooLarge);
        }
        if self.columns.is_empty() {
            self.columns = batch.columns.clone();
        } else if self.columns != batch.columns {
            return Err(DesktopSqlStreamSinkError::InvalidAcknowledgement);
        }
        let path = page_path(&self.partial_directory, batch.sequence);
        write_new_file_atomically(&path, encoded, false)
            .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        self.pages.push(ResultPageMeta {
            sequence: batch.sequence,
            row_start: self.row_count,
            row_count: batch.rows.len(),
            encoded_bytes: encoded.len(),
            sha256: bytes_sha256(encoded),
        });
        self.row_count = self.row_count.saturating_add(batch.rows.len());
        Ok(())
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
            completed_at: Utc::now(),
        };
        let encoded = serde_json::to_vec(&manifest)
            .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        if encoded.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(DesktopSqlStreamSinkError::ResultStoreUnavailable);
        }
        write_new_file_atomically(
            &self.partial_directory.join("manifest.json"),
            &encoded,
            true,
        )
        .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        fs::rename(&self.partial_directory, &self.final_directory)
            .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
        self.published = true;
        Ok(())
    }

    /// Publishes the pages already written when the owner cancels the stream, so
    /// the rows it received stay readable as a partial (truncated) result.
    pub(super) fn complete_cancelled(&mut self) -> Result<(), DesktopSqlStreamSinkError> {
        if self.published || self.pages.is_empty() {
            return Ok(());
        }
        self.complete(self.row_count, true, 0)
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
        let partial = export_partial_path(&destination, export_id)?;
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
                remove_partial_export(&partial)?;
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
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(partial)?;
    let mut rows_written = 0_usize;
    match format {
        DesktopSqlResultExportFormat::Csv => {
            let mut writer = BufWriter::new(file);
            // Same bytes as the renderer's CSV download: a UTF-8 BOM so
            // spreadsheet apps read non-ASCII text, then CRLF-separated records.
            writer.write_all("\u{feff}".as_bytes())?;
            write_csv_record(
                &mut writer,
                manifest.columns.iter().map(|column| csv_text(column, true)),
            )?;
            for page in &manifest.pages {
                ensure_export_open(cancelled)?;
                let batch = read_verified_page(
                    &completed_directory(operation_id)?,
                    page,
                    &manifest.columns,
                    operation_id,
                )
                .map_err(|error| AppError::Safety(error.to_string()))?;
                ensure_page_exportable(&batch)?;
                for row in batch.rows {
                    writer.write_all(b"\r\n")?;
                    write_csv_record(&mut writer, row.iter().map(csv_cell))?;
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
            writer.get_ref().sync_all()?;
        }
        DesktopSqlResultExportFormat::Json => {
            let mut writer = BufWriter::new(file);
            // Duplicate result column names stay distinct keys (`name`, `name_2`).
            let keys = unique_column_keys(&manifest.columns)
                .iter()
                .map(serde_json::to_string)
                .collect::<Result<Vec<_>, _>>()?;
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
                ensure_page_exportable(&batch)?;
                for row in batch.rows {
                    if rows_written > 0 {
                        writer.write_all(b",")?;
                    }
                    writer.write_all(b"{")?;
                    for (index, (key, value)) in keys.iter().zip(&row).enumerate() {
                        if index > 0 {
                            writer.write_all(b",")?;
                        }
                        writer.write_all(key.as_bytes())?;
                        writer.write_all(b":")?;
                        serde_json::to_writer(&mut writer, value)?;
                    }
                    writer.write_all(b"}")?;
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

/// The renderer maps these exact shapes to a translated message that names the
/// row and column; keep them stable.
fn ensure_page_exportable(batch: &DesktopSqlStreamBatch) -> AppResult<()> {
    if let Some(failure) = batch.decode_failures.first() {
        let row = failure.row_index + 1;
        let column = failure.column_index + 1;
        let reason = match failure
            .database_type
            .strip_prefix(crate::executor::read::TRUNCATED_CELL_TYPE_PREFIX)
        {
            Some(bytes) => format!(
                "SQL result export blocked: cell at row {row}, column {column} was shortened from {bytes} bytes to fit a result page"
            ),
            None => format!(
                "SQL result export blocked: cell at row {row}, column {column} could not be decoded as {}",
                failure.database_type
            ),
        };
        return Err(AppError::Blocked { reason });
    }
    Ok(())
}

fn ensure_export_open(cancelled: &AtomicBool) -> AppResult<()> {
    if cancelled.load(Ordering::Acquire) {
        Err(AppError::Safety("SQL result export cancelled".into()))
    } else {
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn assert_decode_failure_export_contract() {
    let operation_id = Uuid::new_v4().into();
    let capability = "a".repeat(64);
    let owner_webview = "test-result-export";
    let mut writer = DesktopSqlResultWriter::begin_with_authority(
        operation_id,
        Uuid::new_v4(),
        "test-account",
        Uuid::new_v4(),
        1,
        owner_webview,
        &capability,
    )
    .expect("begin isolated persisted result");
    struct TestResultCleanup {
        partial: PathBuf,
        completed: PathBuf,
    }
    impl Drop for TestResultCleanup {
        fn drop(&mut self) {
            if self.partial.exists() {
                let _ = remove_result_directory(&self.partial);
            }
            if self.completed.exists() {
                let _ = remove_result_directory(&self.completed);
            }
        }
    }
    let _result_cleanup = TestResultCleanup {
        partial: writer.partial_directory.clone(),
        completed: writer.final_directory.clone(),
    };
    let ordinary = DesktopSqlStreamBatch {
        operation_id,
        sequence: 0,
        row_start: 0,
        columns: vec!["value".into()],
        rows: vec![vec![serde_json::json!("<unsupported: geometry>")]],
        decode_failures: Vec::new(),
    };
    assert!(ensure_page_exportable(&ordinary).is_ok());

    let failed = DesktopSqlStreamBatch {
        operation_id,
        sequence: 1,
        row_start: 1,
        columns: vec!["value".into()],
        rows: vec![vec![serde_json::Value::Null]],
        decode_failures: vec![crate::model::CellDecodeFailure {
            row_index: 1,
            column_index: 0,
            database_type: "geometry".into(),
        }],
    };
    for batch in [&ordinary, &failed] {
        let encoded = serde_json::to_vec(batch).expect("encode persisted result page");
        writer
            .write_page(batch, &encoded)
            .expect("persist result page");
    }
    writer
        .complete(2, false, 1)
        .expect("publish result manifest");

    let output_directory = tempfile::tempdir().expect("create isolated export directory");
    let store = DesktopSqlResultStore::default();
    for (format, extension) in [
        (DesktopSqlResultExportFormat::Csv, "csv"),
        (DesktopSqlResultExportFormat::Json, "json"),
    ] {
        let destination = output_directory
            .path()
            .join(format!("existing.{extension}"));
        fs::write(&destination, b"preserve-existing-output")
            .expect("write pre-existing destination");
        let export_id = Uuid::new_v4();
        let partial = output_directory
            .path()
            .join(format!(".dopedb-result-{export_id}.partial"));
        let cancelled = store
            .start_export(export_id, operation_id, &capability, owner_webview)
            .expect("authorize persisted result export");
        let error = store
            .export_to_path(
                export_id,
                operation_id,
                &capability,
                owner_webview,
                format,
                destination.clone(),
                cancelled,
                |_| Ok(()),
            )
            .expect_err("failed cell blocks persisted export");
        store.finish_export(export_id);
        assert!(error
            .to_string()
            .contains("could not be decoded as geometry"));
        assert_eq!(
            fs::read(&destination).expect("read preserved destination"),
            b"preserve-existing-output"
        );
        assert!(!partial.exists(), "failed export partial must be removed");
    }

    let cleanup_directory = output_directory.path().join("cleanup.partial");
    fs::create_dir(&cleanup_directory).expect("create non-file cleanup target");
    let cleanup_error = remove_partial_export(&cleanup_directory)
        .expect_err("unconfirmed partial cleanup fails closed");
    assert!(matches!(cleanup_error, AppError::OutcomeUnknown(_)));
    fs::remove_dir(cleanup_directory).expect("remove cleanup target");

    // A complete export follows the renderer's CSV/JSON contract byte for byte:
    // BOM, CRLF, NULL as an empty field, quoting, formula neutralization that
    // spares plain numbers, JavaScript number text, and distinct duplicate keys.
    let exported_id = Uuid::new_v4().into();
    let mut exported = DesktopSqlResultWriter::begin_with_authority(
        exported_id,
        Uuid::new_v4(),
        "test-account",
        Uuid::new_v4(),
        1,
        owner_webview,
        &capability,
    )
    .expect("begin exported result");
    let _exported_cleanup = TestResultCleanup {
        partial: exported.partial_directory.clone(),
        completed: exported.final_directory.clone(),
    };
    let page = DesktopSqlStreamBatch {
        operation_id: exported_id,
        sequence: 0,
        row_start: 0,
        columns: vec!["name".into(), "name".into(), "=total".into()],
        rows: vec![
            vec![
                serde_json::json!("=1+2"),
                serde_json::json!("-12.50"),
                serde_json::json!(2.0),
            ],
            vec![
                serde_json::Value::Null,
                serde_json::json!("a,\"b\"\r\n"),
                serde_json::json!({"x": 1.5, "y": [1.0, 1e21]}),
            ],
        ],
        decode_failures: Vec::new(),
    };
    let encoded = serde_json::to_vec(&page).expect("encode exported page");
    exported
        .write_page(&page, &encoded)
        .expect("persist exported page");
    exported
        .complete(2, false, 1)
        .expect("publish exported manifest");
    for (format, extension, expected) in [
        (
            DesktopSqlResultExportFormat::Csv,
            "csv",
            "\u{feff}name,name,'=total\r\n'=1+2,-12.50,2\r\n,\"a,\"\"b\"\"\r\n\",\"{\"\"x\"\":1.5,\"\"y\"\":[1,1e+21]}\"",
        ),
        (
            DesktopSqlResultExportFormat::Json,
            "json",
            r#"[{"name":"=1+2","name_2":"-12.50","=total":2.0},{"name":null,"name_2":"a,\"b\"\r\n","=total":{"x":1.5,"y":[1.0,1e+21]}}]"#,
        ),
    ] {
        let export_id = Uuid::new_v4();
        let destination = output_directory.path().join(format!("complete.{extension}"));
        let cancelled = store
            .start_export(export_id, exported_id, &capability, owner_webview)
            .expect("authorize complete export");
        store
            .export_to_path(
                export_id,
                exported_id,
                &capability,
                owner_webview,
                format,
                destination.clone(),
                cancelled,
                |_| Ok(()),
            )
            .expect("complete export succeeds");
        store.finish_export(export_id);
        assert_eq!(
            fs::read_to_string(&destination).expect("read complete export"),
            expected
        );
    }
    assert_eq!(
        unique_column_keys(&["name".into(), "name".into(), "name_2".into(), "name".into()]),
        ["name", "name_2", "name_2_2", "name_3"]
    );
    assert_eq!(js_float_text(0.000_001), "0.000001");
    assert_eq!(js_float_text(1.5e-7), "1.5e-7");
    assert_eq!(js_float_text(123.456), "123.456");
    assert!(!inert_value("1e") && !inert_value(".") && inert_value(".5e-3"));
    // Formula neutralization spares only inert renderings of non-text values.
    for inert in ["-12.50", "-Infinity", "-infinity", "-1 day", "-04:05:06.5"] {
        assert_eq!(csv_text(inert, true), inert);
    }
    assert_eq!(
        csv_text("-1 years -2 mons -3 days +04:05:06", true),
        "-1 years -2 mons -3 days +04:05:06"
    );
    assert_eq!(
        csv_text("-2+3+cmd|' /C calc'!A0", true),
        "'-2+3+cmd|' /C calc'!A0"
    );
    assert_eq!(csv_text("@SUM(1)", true), "'@SUM(1)");
    assert_eq!(csv_text("-1 day; =1", true), "'-1 day; =1");

    crate::executor::read::assert_decoder_contract();
}
