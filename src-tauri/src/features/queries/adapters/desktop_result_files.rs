//! Capability-bound result manifest, page, and retention file operations, the
//! destination contract every export file follows (stored or renderer-built), and
//! the text contract of an exported result file. Export text is identical to the
//! renderer's `toCsv`/`toJson`: CSV fields are quoted on `,` `"` CR or LF, text a
//! spreadsheet would evaluate is neutralized unless it is an inert rendering of a
//! number, ±Infinity, an interval or a time, numbers use JavaScript's number text so
//! the file matches the grid, and duplicate column names become distinct JSON keys.

use super::*;

pub(super) fn result_root() -> AppResult<PathBuf> {
    let root = crate::app_paths::data_root()?.join("query-results-v1");
    fs::create_dir_all(&root)?;
    ensure_real_directory(&root)?;
    set_private_directory_permissions(&root)?;
    Ok(root)
}

pub(super) fn completed_directory(operation_id: OperationId) -> AppResult<PathBuf> {
    Ok(result_root()?.join(Uuid::from(operation_id).to_string()))
}

pub(super) fn load_authorized_manifest(
    operation_id: OperationId,
    capability: &str,
    owner_webview: &str,
) -> AppResult<ResultManifest> {
    let directory = completed_directory(operation_id)?;
    ensure_real_directory(&directory)?;
    let path = directory.join("manifest.json");
    let metadata = fs::symlink_metadata(&path)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err(AppError::Blocked {
            reason: "SQL result manifest is not a bounded regular file".into(),
        });
    }
    let manifest: ResultManifest = serde_json::from_reader(File::open(path)?)?;
    if manifest.schema_version != RESULT_STORE_SCHEMA_VERSION
        || manifest.operation_id != Uuid::from(operation_id)
        || manifest.page_rows != RESULT_PAGE_ROWS
        || manifest.owner_webview != owner_webview
        || !hash_matches(&manifest.capability_sha256, capability)
        || manifest.row_count
            != manifest
                .pages
                .iter()
                .map(|page| page.row_count)
                .sum::<usize>()
        || manifest.pages.iter().enumerate().any(|(index, page)| {
            page.sequence != index as u64
                || page.encoded_bytes > DESKTOP_STREAM_BATCH_MAX_BYTES
                || page.row_count > RESULT_PAGE_ROWS
        })
        || !page_ranges_are_contiguous(&manifest.pages)
    {
        return Err(AppError::Blocked {
            reason: "SQL result capability or manifest is invalid".into(),
        });
    }
    Ok(manifest)
}

pub(super) fn page_ranges_are_contiguous(pages: &[ResultPageMeta]) -> bool {
    let mut expected_start = 0_usize;
    for page in pages {
        if page.row_start != expected_start {
            return false;
        }
        expected_start = expected_start.saturating_add(page.row_count);
    }
    true
}

pub(super) fn read_verified_page(
    directory: &Path,
    meta: &ResultPageMeta,
    columns: &[String],
    operation_id: OperationId,
) -> Result<DesktopSqlStreamBatch, DesktopSqlStreamSinkError> {
    let path = page_path(directory, meta.sequence);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() as usize != meta.encoded_bytes
        || metadata.len() as usize > DESKTOP_STREAM_BATCH_MAX_BYTES
    {
        return Err(DesktopSqlStreamSinkError::ResultStoreUnavailable);
    }
    let encoded = fs::read(path).map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
    if bytes_sha256(&encoded) != meta.sha256 {
        return Err(DesktopSqlStreamSinkError::ResultStoreUnavailable);
    }
    let mut batch: DesktopSqlStreamBatch = serde_json::from_slice(&encoded)
        .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
    if batch.row_start == 0 && meta.row_start > 0 && batch.decode_failures.is_empty() {
        batch.row_start = meta.row_start;
    }
    if batch.operation_id != operation_id
        || batch.sequence != meta.sequence
        || batch.row_start != meta.row_start
        || batch.columns != columns
        || batch.rows.len() != meta.row_count
        || batch.rows.iter().any(|row| row.len() != columns.len())
        || batch.decode_failures.iter().any(|failure| {
            failure.row_index < meta.row_start
                || failure.row_index >= meta.row_start.saturating_add(meta.row_count)
                || failure.column_index >= columns.len()
                || !failure_cell_is_consistent(
                    failure,
                    &batch.rows[failure.row_index - meta.row_start][failure.column_index],
                )
        })
    {
        return Err(DesktopSqlStreamSinkError::ResultStoreUnavailable);
    }
    Ok(batch)
}

/// A failed cell is null; a cell shortened to fit its page keeps a text preview.
pub(super) fn failure_cell_is_consistent(
    failure: &crate::model::CellDecodeFailure,
    value: &serde_json::Value,
) -> bool {
    if is_truncated_cell(failure) {
        value.is_string()
    } else {
        value.is_null()
    }
}

pub(super) fn is_truncated_cell(failure: &crate::model::CellDecodeFailure) -> bool {
    failure
        .database_type
        .starts_with(crate::executor::read::TRUNCATED_CELL_TYPE_PREFIX)
}

pub(super) fn page_path(directory: &Path, sequence: u64) -> PathBuf {
    directory.join(format!("page-{sequence:020}.json"))
}

/// Pages are written without a per-page flush: each is SHA-256-bound by the
/// manifest, so a page lost to power failure fails closed on read instead of
/// returning wrong rows. Only the manifest, which publishes the artifact, is
/// flushed (`durable`), keeping a full-device flush off the per-page hot path.
pub(super) fn write_new_file_atomically(
    path: &Path,
    bytes: &[u8],
    durable: bool,
) -> std::io::Result<()> {
    let partial = path.with_extension("tmp");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    file.write_all(bytes)?;
    if durable {
        file.sync_all()?;
    }
    fs::rename(partial, path)
}

pub(super) fn ensure_real_directory(path: &Path) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppError::Blocked {
            reason: "SQL result storage is not an app-owned directory".into(),
        });
    }
    Ok(())
}

/// The destination contract every result export follows: the chosen file's parent
/// is a real directory, an existing destination is a regular file (never a
/// symlink), and the bytes first go to a fresh sibling `.partial` that only a
/// complete write moves over the destination. Returns that `.partial` path.
pub(super) fn export_partial_path(destination: &Path, export_id: Uuid) -> AppResult<PathBuf> {
    let parent = destination.parent().ok_or_else(|| AppError::Blocked {
        reason: "SQL result export destination has no parent directory".into(),
    })?;
    ensure_real_directory(parent)?;
    if let Ok(metadata) = fs::symlink_metadata(destination) {
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
    Ok(partial)
}

pub(super) fn remove_partial_export(path: &Path) -> AppResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::OutcomeUnknown(format!(
            "SQL result export failed and partial output cleanup could not be confirmed: {error}"
        ))),
    }
}

/// Saves export text the renderer already built (rows it holds) under the same
/// destination contract as a stored-result export, so a failed or interrupted
/// save never leaves a truncated file in place of the person's chosen one.
pub(crate) fn save_renderer_export(destination: &Path, contents: &[u8]) -> AppResult<()> {
    let partial = export_partial_path(destination, Uuid::new_v4())?;
    let written = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)
        .and_then(|mut file| {
            file.write_all(contents)?;
            file.sync_all()
        })
        .and_then(|()| replace_file(&partial, destination));
    if let Err(error) = written {
        remove_partial_export(&partial)?;
        return Err(error.into());
    }
    Ok(())
}

#[cfg(unix)]
pub(super) fn set_private_directory_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
pub(super) fn set_private_directory_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

pub(super) fn remove_result_directory(path: &Path) -> AppResult<()> {
    let root = result_root()?;
    if path.parent() != Some(root.as_path()) {
        return Err(AppError::Blocked {
            reason: "refusing to remove a directory outside SQL result storage".into(),
        });
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(AppError::Blocked {
                reason: "refusing to remove an invalid SQL result directory".into(),
            })
        }
        Ok(_) => {
            fs::remove_dir_all(path)?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn sweep_result_root(root: &Path) -> AppResult<()> {
    let cutoff = Utc::now() - Duration::days(RESULT_RETENTION_DAYS);
    let mut completed = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".partial") {
            let modified = metadata.modified().ok().map(DateTime::<Utc>::from);
            if modified.is_some_and(|value| value < Utc::now() - Duration::hours(24)) {
                remove_result_directory(&path)?;
            }
            continue;
        }
        if Uuid::parse_str(&name).is_err() {
            continue;
        }
        let manifest = match fs::symlink_metadata(path.join("manifest.json")) {
            Ok(manifest)
                if !manifest.file_type().is_symlink()
                    && manifest.is_file()
                    && manifest.len() <= MAX_MANIFEST_BYTES =>
            {
                manifest
            }
            Ok(_) | Err(_) => {
                // A crash or local corruption in one exact app-owned result
                // directory must not block every later query. Keep recent
                // evidence, then let the ordinary 24-hour partial window reap it.
                let modified = metadata.modified().ok().map(DateTime::<Utc>::from);
                if modified.is_some_and(|value| value < Utc::now() - Duration::hours(24)) {
                    remove_result_directory(&path)?;
                }
                continue;
            }
        };
        let modified = manifest
            .modified()
            .ok()
            .map(DateTime::<Utc>::from)
            .unwrap_or_else(Utc::now);
        completed.push((modified, path));
    }
    completed.sort_by_key(|(modified, _)| *modified);
    let excess = completed.len().saturating_sub(MAX_RETAINED_RESULTS);
    for (index, (modified, path)) in completed.into_iter().enumerate() {
        if modified < cutoff || index < excess {
            remove_result_directory(&path)?;
        }
    }
    Ok(())
}

pub(super) fn capability_hash(capability: &str) -> String {
    bytes_sha256(capability.as_bytes())
}

pub(super) fn bytes_sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub(super) fn hash_matches(expected: &str, capability: &str) -> bool {
    let actual = capability_hash(capability);
    expected.len() == actual.len() && bool::from(expected.as_bytes().ct_eq(actual.as_bytes()))
}

pub(super) fn lock_exports(
    exports: &Mutex<HashMap<Uuid, ActiveExport>>,
) -> std::sync::MutexGuard<'_, HashMap<Uuid, ActiveExport>> {
    exports
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(windows)]
pub(super) fn replace_file(partial: &Path, output: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let partial = partial
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let output = output
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            partial.as_ptr(),
            output.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub(super) fn replace_file(partial: &Path, output: &Path) -> std::io::Result<()> {
    fs::rename(partial, output)
}

/// Deterministic JSON keys for result columns that share a name, identical to
/// the renderer's `uniqueColumnKeys`: `name`, `name_2`, `name_3`, … skipping any
/// key an earlier column already uses.
pub(super) fn unique_column_keys(columns: &[String]) -> Vec<String> {
    let mut used = std::collections::HashSet::new();
    columns
        .iter()
        .map(|column| {
            let mut key = column.clone();
            let mut suffix = 2_usize;
            while used.contains(&key) {
                key = format!("{column}_{suffix}");
                suffix += 1;
            }
            used.insert(key.clone());
            key
        })
        .collect()
}

pub(super) fn write_csv_record(
    writer: &mut impl Write,
    fields: impl Iterator<Item = String>,
) -> std::io::Result<()> {
    for (index, field) in fields.enumerate() {
        if index > 0 {
            writer.write_all(b",")?;
        }
        writer.write_all(field.as_bytes())?;
    }
    Ok(())
}

/// CSV convention shared with the renderer's `toCsv`: NULL is an empty field,
/// numbers use JavaScript's number text, JSON values are compact JSON, and text
/// cells are neutralized against spreadsheet formula evaluation.
pub(super) fn csv_cell(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(text) => csv_text(text, true),
        serde_json::Value::Number(number) => js_number_text(number),
        serde_json::Value::Bool(flag) => flag.to_string(),
        other => {
            let mut json = String::new();
            js_json_text(other, &mut json);
            csv_text(&json, false)
        }
    }
}

/// A text cell a spreadsheet would evaluate (leading `= + - @`, tab, or CR) gets
/// a leading apostrophe unless the whole value is an inert database rendering (see
/// [`inert_value`]); fields with `,` `"` CR or LF are quoted with doubled quotes.
pub(super) fn csv_text(text: &str, neutralize: bool) -> String {
    let formula =
        neutralize && text.starts_with(['=', '+', '-', '@', '\t', '\r']) && !inert_value(text);
    let quote = text.contains(['"', ',', '\n', '\r']);
    let mut field = String::with_capacity(text.len() + 4);
    if quote {
        field.push('"');
    }
    if formula {
        field.push('\'');
    }
    if quote {
        field.push_str(&text.replace('"', "\"\""));
        field.push('"');
    } else {
        field.push_str(text);
    }
    field
}

/// The database's inert rendering of a non-text value: a number (`-12.50`),
/// ±Infinity, or an interval/duration (`-1 day -02:00:00`). Such a value carries
/// no formula, so it keeps its own text. The pattern is identical to the
/// renderer's `INERT_VALUE` in `src/lib/sqlBuild.ts`.
pub(super) fn inert_value(text: &str) -> bool {
    static INERT_VALUE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(concat!(
            r"^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?",
            r"|[+-]?[Ii]nfinity",
            r"|-?[0-9]+ (?:years?|mons?|days?)(?: [+-]?[0-9]+ (?:years?|mons?|days?))*",
            r"(?: [+-]?[0-9]+:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)?",
            r"|-?[0-9]+:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)$",
        ))
        .expect("the inert value pattern is valid")
    });
    INERT_VALUE.is_match(text)
}

/// JavaScript `Number#toString` for a JSON number, so CSV text matches the grid.
fn js_number_text(number: &serde_json::Number) -> String {
    if let Some(value) = number.as_i64() {
        return value.to_string();
    }
    if let Some(value) = number.as_u64() {
        return value.to_string();
    }
    number
        .as_f64()
        .map_or_else(|| number.to_string(), js_float_text)
}

pub(super) fn js_float_text(value: f64) -> String {
    if value == 0.0 || !value.is_finite() {
        return if value.is_nan() {
            "NaN".into()
        } else if value == 0.0 {
            "0".into()
        } else if value > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    // Rust's `{:e}` yields the same shortest round-trip digits JavaScript uses.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits = mantissa.replace('.', "");
    let point = exponent.parse::<i64>().unwrap_or(0) + 1;
    let length = i64::try_from(digits.len()).unwrap_or(i64::MAX);
    let sign = if value < 0.0 { "-" } else { "" };
    let body = if length <= point && point <= 21 {
        format!(
            "{digits}{}",
            "0".repeat(usize::try_from(point - length).unwrap_or(0))
        )
    } else if 0 < point && point <= 21 {
        let split = usize::try_from(point).unwrap_or(0);
        format!("{}.{}", &digits[..split], &digits[split..])
    } else if -6 < point && point <= 0 {
        format!(
            "0.{}{digits}",
            "0".repeat(usize::try_from(-point).unwrap_or(0))
        )
    } else {
        let exponent = point - 1;
        let exponent_sign = if exponent < 0 { '-' } else { '+' };
        let (head, tail) = digits.split_at(1);
        if tail.is_empty() {
            format!("{head}e{exponent_sign}{}", exponent.abs())
        } else {
            format!("{head}.{tail}e{exponent_sign}{}", exponent.abs())
        }
    };
    format!("{sign}{body}")
}

/// Compact JSON with JavaScript number text, matching `JSON.stringify`.
fn js_json_text(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::Null => out.push_str("null"),
        serde_json::Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        serde_json::Value::Number(number) => out.push_str(&js_number_text(number)),
        serde_json::Value::String(text) => {
            out.push_str(&serde_json::Value::from(text.as_str()).to_string())
        }
        serde_json::Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                js_json_text(item, out);
            }
            out.push(']');
        }
        serde_json::Value::Object(entries) => {
            out.push('{');
            for (index, (key, item)) in entries.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::Value::from(key.as_str()).to_string());
                out.push(':');
                js_json_text(item, out);
            }
            out.push('}');
        }
    }
}
