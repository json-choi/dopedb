//! Runtime discovery path, atomic publication, and owner-only permissions.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use dopedb_protocol::{RuntimeDiscovery, RUNTIME_DIRECTORY_NAME, RUNTIME_FILE_NAME};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::kernel::identity::RuntimeId;

const PRODUCTION_APP_IDENTIFIER: &str = "dev.dopedb.desktop";
const DEVELOPMENT_APP_IDENTIFIER: &str = "dev.dopedb.desktop.dev";
#[cfg(feature = "packaged-benchmark")]
const BENCHMARK_APP_IDENTIFIER: &str = "dev.dopedb.desktop.benchmark";

pub(crate) fn runtime_file_for_identifier(app_identifier: &str) -> AppResult<PathBuf> {
    #[cfg(feature = "packaged-benchmark")]
    if app_identifier == BENCHMARK_APP_IDENTIFIER {
        return Ok(crate::app_paths::data_root()?
            .join(RUNTIME_DIRECTORY_NAME)
            .join(RUNTIME_FILE_NAME));
    }
    let data_directory = match app_identifier {
        PRODUCTION_APP_IDENTIFIER => "dopedb",
        DEVELOPMENT_APP_IDENTIFIER => "dopedb-dev",
        _ => {
            return Err(AppError::Config(
                "the app identifier has no Broker runtime namespace".into(),
            ));
        }
    };
    let base = dirs::data_dir()
        .ok_or_else(|| AppError::Config("no OS data directory is available".into()))?;
    Ok(base
        .join(data_directory)
        .join(RUNTIME_DIRECTORY_NAME)
        .join(RUNTIME_FILE_NAME))
}

pub(crate) fn runtime_directory(runtime_file: &Path) -> AppResult<&Path> {
    runtime_file
        .parent()
        .ok_or_else(|| AppError::Config("runtime discovery file has no parent directory".into()))
}

pub(crate) fn prepare_runtime_directory(runtime_file: &Path) -> AppResult<PathBuf> {
    let directory = runtime_directory(runtime_file)?;
    fs::create_dir_all(directory)?;
    restrict(directory, true)?;
    Ok(directory.to_path_buf())
}

pub(crate) fn publish(runtime_file: &Path, discovery: &RuntimeDiscovery) -> AppResult<()> {
    discovery
        .validate()
        .map_err(|_| AppError::Config("runtime discovery metadata is invalid".into()))?;
    let directory = prepare_runtime_directory(runtime_file)?;

    let temporary = directory.join(format!(".runtime-{}.tmp", Uuid::new_v4()));
    let write_result = (|| -> AppResult<()> {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        serde_json::to_writer(&mut file, discovery)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        restrict(&temporary, false)?;
        atomic_replace(&temporary, runtime_file)?;
        restrict(runtime_file, false)?;
        if let Ok(directory_file) = OpenOptions::new().read(true).open(&directory) {
            let _ = directory_file.sync_all();
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

pub(crate) fn remove_if_owned(runtime_file: &Path, runtime_id: RuntimeId) {
    let owned = fs::read(runtime_file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<RuntimeDiscovery>(&bytes).ok())
        .is_some_and(|discovery| RuntimeId::from(discovery.runtime_id()) == runtime_id);
    if owned {
        let _ = fs::remove_file(runtime_file);
    }
}

#[cfg(unix)]
fn restrict(path: &Path, directory: bool) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(
        path,
        fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
    )?;
    Ok(())
}

#[cfg(windows)]
fn restrict(path: &Path, _directory: bool) -> AppResult<()> {
    super::peer::restrict_path_to_current_user(path)
}

#[cfg(unix)]
fn atomic_replace(from: &Path, to: &Path) -> AppResult<()> {
    fs::rename(from, to)?;
    Ok(())
}

#[cfg(windows)]
fn atomic_replace(from: &Path, to: &Path) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;

    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from = from
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let to = to
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discovery(runtime_id: Uuid, endpoint: &str) -> RuntimeDiscovery {
        RuntimeDiscovery::new(
            runtime_id,
            4242,
            "1.0.0",
            1,
            1,
            endpoint,
            chrono::Utc::now(),
        )
        .unwrap()
    }

    fn read(path: &Path) -> RuntimeDiscovery {
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }

    fn leftover_temporaries(directory: &Path) -> Vec<String> {
        fs::read_dir(directory)
            .unwrap()
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter(|name| name.starts_with(".runtime-"))
            .collect()
    }

    #[cfg(unix)]
    fn mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn publication_is_owner_only_atomic_and_removed_only_by_its_runtime() {
        // Only the two product identifiers own a Broker namespace, and a runtime
        // file path must have a directory to restrict.
        for identifier in ["dev.dopedb.desktop.other", "", "dev.dopedb"] {
            assert!(
                runtime_file_for_identifier(identifier).is_err(),
                "{identifier:?} must not resolve a runtime namespace"
            );
        }
        for (identifier, directory) in [
            (PRODUCTION_APP_IDENTIFIER, "dopedb"),
            (DEVELOPMENT_APP_IDENTIFIER, "dopedb-dev"),
        ] {
            let path = runtime_file_for_identifier(identifier).unwrap();
            let expected = Path::new(directory)
                .join(RUNTIME_DIRECTORY_NAME)
                .join(RUNTIME_FILE_NAME);
            assert!(
                path.ends_with(expected),
                "{identifier} must resolve inside its own data namespace"
            );
        }
        assert!(runtime_directory(Path::new("/")).is_err());

        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("nested").join(RUNTIME_DIRECTORY_NAME);
        let runtime_file = directory.join(RUNTIME_FILE_NAME);
        let owner = Uuid::new_v4();
        publish(&runtime_file, &discovery(owner, "first-endpoint")).unwrap();
        #[cfg(unix)]
        {
            assert_eq!(mode(&directory), 0o700, "runtime directory is owner-only");
            assert_eq!(mode(&runtime_file), 0o600, "runtime file is owner-only");
        }
        let published = read(&runtime_file);
        assert_eq!(published.runtime_id(), owner);
        assert_eq!(published.endpoint(), "first-endpoint");

        // A republish replaces the whole file, leaves no temporary behind, and
        // restricts a loosened file or directory again.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o755)).unwrap();
            fs::set_permissions(&runtime_file, fs::Permissions::from_mode(0o644)).unwrap();
        }
        publish(&runtime_file, &discovery(owner, "second-endpoint")).unwrap();
        assert_eq!(read(&runtime_file).endpoint(), "second-endpoint");
        assert!(leftover_temporaries(&directory).is_empty());
        #[cfg(unix)]
        {
            assert_eq!(mode(&directory), 0o700, "republish restricts the directory");
            assert_eq!(mode(&runtime_file), 0o600, "republish restricts the file");
        }

        // Invalid metadata is refused before anything is written.
        let invalid: RuntimeDiscovery = serde_json::from_value(serde_json::json!({
            "schemaVersion": published.schema_version(),
            "runtimeId": Uuid::new_v4(),
            "pid": 0,
            "appVersion": "1.0.0",
            "protocolMin": 1,
            "protocolMax": 1,
            "endpoint": "other-endpoint",
            "startedAt": chrono::Utc::now(),
        }))
        .unwrap();
        assert!(publish(&runtime_file, &invalid).is_err());
        assert_eq!(read(&runtime_file).endpoint(), "second-endpoint");

        // A failed replacement removes its temporary and leaves the target intact.
        let occupied = directory.join("occupied");
        fs::create_dir(&occupied).unwrap();
        fs::write(occupied.join("keep"), b"x").unwrap();
        assert!(publish(&occupied, &discovery(owner, "third-endpoint")).is_err());
        assert!(leftover_temporaries(&directory).is_empty());
        assert!(occupied.join("keep").exists());

        // Shutdown deletes only a file this runtime is proven to own.
        remove_if_owned(&runtime_file, RuntimeId::from(Uuid::new_v4()));
        assert!(runtime_file.exists(), "another runtime must not remove it");
        let corrupt = directory.join("corrupt.json");
        fs::write(&corrupt, b"{not json").unwrap();
        remove_if_owned(&corrupt, RuntimeId::from(owner));
        assert!(corrupt.exists(), "an unreadable file is not proven owned");
        remove_if_owned(&directory.join("missing.json"), RuntimeId::from(owner));
        remove_if_owned(&runtime_file, RuntimeId::from(owner));
        assert!(
            !runtime_file.exists(),
            "the owning runtime removes its file"
        );
    }
}
