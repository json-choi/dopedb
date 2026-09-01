//! App-owned Google Cloud CLI profile storage for BigQuery onboarding.
//!
//! Google sign-in state is isolated by the active DopeDB Workspace member, while
//! service-account state is narrowed to one exact connection binding. This module
//! owns filesystem validation and cleanup; it never parses or returns credentials.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::model::ConnectionProfile;

use super::super::BigQueryAuthScope;
use super::{auth_mode, BigQueryAuthMode};

const MAX_CREDENTIAL_FILE_BYTES: u64 = 1 << 20;
const AUTH_STORAGE_DIRECTORY: &str = "bigquery-gcloud-scoped";
const GOOGLE_ACCOUNT_DIRECTORY: &str = "google-account";
const SERVICE_ACCOUNT_DIRECTORY: &str = "service-account";

pub(super) fn cloudsdk_config(
    profile: &ConnectionProfile,
    scope: &BigQueryAuthScope,
) -> AppResult<PathBuf> {
    match auth_mode(profile)? {
        BigQueryAuthMode::GoogleAccount => google_account_config(scope),
        BigQueryAuthMode::ServiceAccount => service_account_config(scope),
    }
}

pub(crate) async fn cleanup_service_account_auth(scope: &BigQueryAuthScope) -> AppResult<()> {
    remove_auth_directory(service_account_config(scope)?).await
}

pub(crate) async fn cleanup_connection_auth(scope: &BigQueryAuthScope) -> AppResult<()> {
    cleanup_service_account_auth(scope).await
}

async fn remove_auth_directory(target: PathBuf) -> AppResult<()> {
    let metadata = match tokio::fs::symlink_metadata(&target).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || metadata.is_file() {
        tokio::fs::remove_file(target).await?;
    } else if metadata.is_dir() {
        tokio::fs::remove_dir_all(target).await?;
    } else {
        return Err(AppError::Blocked {
            reason: "BigQuery service-account credential storage has an invalid file type".into(),
        });
    }
    Ok(())
}

fn auth_storage_root() -> AppResult<PathBuf> {
    Ok(crate::app_paths::local_data_root()?.join(AUTH_STORAGE_DIRECTORY))
}

pub(super) fn google_account_config(scope: &BigQueryAuthScope) -> AppResult<PathBuf> {
    Ok(auth_storage_root()?
        .join(GOOGLE_ACCOUNT_DIRECTORY)
        .join(scope.workspace_member_key()))
}

pub(super) fn service_account_config(scope: &BigQueryAuthScope) -> AppResult<PathBuf> {
    Ok(auth_storage_root()?
        .join(SERVICE_ACCOUNT_DIRECTORY)
        .join(scope.connection_binding_key()))
}

pub(super) fn prepare_auth_directory(directory: &Path) -> AppResult<()> {
    let mode_root = directory.parent().ok_or_else(|| AppError::Blocked {
        reason: "BigQuery credential storage is invalid".into(),
    })?;
    let root = mode_root.parent().ok_or_else(|| AppError::Blocked {
        reason: "BigQuery credential storage is invalid".into(),
    })?;
    if root != auth_storage_root()? {
        return Err(AppError::Blocked {
            reason: "BigQuery credential storage escaped its app-owned boundary".into(),
        });
    }
    prepare_directory(root)?;
    prepare_directory(mode_root)?;
    prepare_directory(directory)
}

fn prepare_directory(directory: &Path) -> AppResult<()> {
    match std::fs::symlink_metadata(directory) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(AppError::Blocked {
                    reason: "BigQuery credential storage must be a private local directory".into(),
                });
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(directory)?;
        }
        Err(error) => return Err(error.into()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(super) fn audited_credential_path(path: &Path) -> AppResult<PathBuf> {
    if !path.is_absolute() || path_has_unsafe_characters(path) {
        return Err(AppError::Config(
            "the service-account credential file path is invalid".into(),
        ));
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| {
        AppError::Config("the service-account credential file is unavailable".into())
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_CREDENTIAL_FILE_BYTES
    {
        return Err(AppError::Config(
            "the service-account credential must be a regular JSON file up to 1 MiB".into(),
        ));
    }
    path.canonicalize().map_err(AppError::from)
}

fn path_has_unsafe_characters(path: &Path) -> bool {
    path.to_string_lossy().chars().any(|value| {
        value.is_control()
            || matches!(
                value,
                '\u{061c}'
                    | '\u{200e}'
                    | '\u{200f}'
                    | '\u{202a}'..='\u{202e}'
                    | '\u{2066}'..='\u{2069}'
                    | '\u{feff}'
            )
    })
}
