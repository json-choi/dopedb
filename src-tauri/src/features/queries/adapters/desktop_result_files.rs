//! Capability-bound result manifest, page, and retention file operations.

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
    if manifest.schema_version != RESULT_STORE_SCHEMA_VERSION {
        // An older artifact cannot be reinterpreted: it recorded a cell this build
        // could not decode as an ordinary value. Re-running the query is the user's
        // call, so say so instead of guessing.
        return Err(AppError::Blocked {
            reason: "this stored SQL result was written by an earlier build; run the query again to load it".into(),
        });
    }
    if manifest.operation_id != Uuid::from(operation_id)
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
    let batch: DesktopSqlStreamBatch = serde_json::from_slice(&encoded)
        .map_err(|_| DesktopSqlStreamSinkError::ResultStoreUnavailable)?;
    if batch.operation_id != operation_id
        || batch.sequence != meta.sequence
        || batch.columns != columns
        || batch.rows.len() != meta.row_count
        || batch.rows.iter().any(|row| row.len() != columns.len())
        || batch
            .unreadable
            .iter()
            .any(|cell| cell.row >= batch.rows.len() || cell.column >= columns.len())
    {
        return Err(DesktopSqlStreamSinkError::ResultStoreUnavailable);
    }
    Ok(batch)
}

pub(super) fn page_path(directory: &Path, sequence: u64) -> PathBuf {
    directory.join(format!("page-{sequence:020}.json"))
}

pub(super) fn write_new_file_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let partial = path.with_extension("tmp");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)?;
    file.write_all(bytes)?;
    file.sync_all()?;
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
