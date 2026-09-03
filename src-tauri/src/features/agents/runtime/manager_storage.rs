//! ACP plugin state validation and atomic private-file operations.

use super::*;

pub(super) fn validate_state(state: &PersistedRuntimeState) -> AppResult<()> {
    if state.schema_version != RUNTIME_STATE_SCHEMA_VERSION || state.plugins.len() > 2 {
        return Err(AppError::Config(
            "the ACP plugin activation state is invalid".into(),
        ));
    }
    for record in state.plugins.values() {
        if record.failure.as_ref().is_some_and(|failure| {
            failure.is_empty() || failure.len() > MAX_FAILURE_BYTES || failure.contains('\0')
        }) {
            return Err(AppError::Config(
                "the ACP plugin failure state is invalid".into(),
            ));
        }
        if record
            .last_checked_at
            .as_deref()
            .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_err())
        {
            return Err(AppError::Config(
                "the ACP plugin check timestamp is invalid".into(),
            ));
        }
        for version in [
            record.current.as_ref(),
            record.candidate.as_ref(),
            record.last_known_good.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            if semver::Version::parse(&version.adapter_bundle_version).is_err()
                || !valid_digest(&version.manifest_sha256)
                || !valid_digest(&version.entrypoint_sha256)
            {
                return Err(AppError::Config(
                    "an ACP plugin version state is invalid".into(),
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_available_updates(state: &PersistedAvailableUpdates) -> AppResult<()> {
    if state.schema_version != RUNTIME_STATE_SCHEMA_VERSION || state.plugins.len() > 2 {
        return Err(AppError::Config(
            "the ACP plugin available-update state is invalid".into(),
        ));
    }
    for update in state.plugins.values() {
        if semver::Version::parse(&update.adapter_version).is_err()
            || semver::Version::parse(&update.adapter_bundle_version).is_err()
            || catalog_release_version(&format!("refs/tags/{}", update.release_id)).is_none()
            || !valid_digest(&update.manifest_sha256)
        {
            return Err(AppError::Config(
                "an ACP plugin available update is invalid".into(),
            ));
        }
    }
    Ok(())
}

pub(super) fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn bounded_failure(value: &str) -> String {
    let sanitized = value
        .chars()
        .filter(|character| *character != '\0')
        .collect::<String>();
    if sanitized.len() <= MAX_FAILURE_BYTES {
        return sanitized;
    }
    let mut end = MAX_FAILURE_BYTES;
    while !sanitized.is_char_boundary(end) {
        end -= 1;
    }
    sanitized[..end].to_owned()
}

pub(super) fn load_json_or_default<T>(path: &Path) -> AppResult<T>
where
    T: DeserializeOwned + Default,
{
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => read_json(path),
        Ok(_) => Err(AppError::Blocked {
            reason: "an ACP plugin state path is not a regular file".into(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn read_json<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_STATE_BYTES {
        return Err(AppError::Blocked {
            reason: "an ACP plugin state file is invalid".into(),
        });
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub(super) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    if bytes.is_empty() || bytes.len() > MAX_STATE_BYTES as usize {
        return Err(AppError::Config("the ACP plugin state is too large".into()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("the ACP plugin state has no parent".into()))?;
    prepare_directory(parent)?;
    if fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.file_type().is_file()) {
        return Err(AppError::Blocked {
            reason: "refusing to replace a non-file ACP plugin state path".into(),
        });
    }
    let temporary = parent.join(format!(".state-{}.tmp", Uuid::new_v4()));
    let result = (|| -> AppResult<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(&bytes)?;
        file.sync_all()?;
        atomic_replace(&temporary, path)?;
        sync_directory(parent);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(super) fn write_new_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

pub(super) fn prepare_new_directory(path: &Path) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("the ACP plugin staging path has no parent".into()))?;
    prepare_directory(parent)?;
    fs::create_dir(path)?;
    restrict_directory(path)
}

pub(super) fn prepare_directory(path: &Path) -> AppResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => restrict_directory(path),
        Ok(_) => Err(AppError::Blocked {
            reason: format!("refusing unsafe ACP plugin directory {}", path.display()),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| AppError::Config("the ACP plugin directory has no parent".into()))?;
            if !parent.exists() {
                fs::create_dir_all(parent)?;
            }
            fs::create_dir(path)?;
            restrict_directory(path)
        }
        Err(error) => Err(error.into()),
    }
}

#[cfg(unix)]
pub(super) fn restrict_directory(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(windows)]
pub(super) fn restrict_directory(path: &Path) -> AppResult<()> {
    crate::broker::restrict_path_to_current_user(path)
}

pub(super) fn remove_prefixed_children(root: &Path, parent: &Path, prefix: &str) -> AppResult<()> {
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with(prefix) {
            remove_owned_tree(root, &entry.path())?;
        }
    }
    Ok(())
}

pub(super) fn remove_owned_tree(root: &Path, path: &Path) -> AppResult<()> {
    if path == root || !path.starts_with(root) {
        return Err(AppError::Blocked {
            reason: "refusing to remove an ACP plugin path outside its root".into(),
        });
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::Blocked {
            reason: "refusing to follow a link in ACP plugin storage".into(),
        });
    }
    if metadata.file_type().is_file() {
        fs::remove_file(path)?;
        return Ok(());
    }
    if !metadata.file_type().is_dir() {
        return Err(AppError::Blocked {
            reason: "refusing an unknown ACP plugin filesystem object".into(),
        });
    }
    for entry in fs::read_dir(path)? {
        remove_owned_tree(root, &entry?.path())?;
    }
    fs::remove_dir(path)?;
    Ok(())
}

pub(super) fn sync_directory(path: &Path) {
    if let Ok(directory) = OpenOptions::new().read(true).open(path) {
        let _ = directory.sync_all();
    }
}

#[cfg(unix)]
pub(super) fn atomic_replace(from: &Path, to: &Path) -> AppResult<()> {
    fs::rename(from, to)?;
    Ok(())
}

#[cfg(windows)]
pub(super) fn atomic_replace(from: &Path, to: &Path) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn wide_null(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }
    let from = wide_null(from.as_os_str());
    let to = wide_null(to.as_os_str());
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}
