//! BigQuery read adapter backed by Google's official `bq` CLI.
//!
//! Authentication remains owned by the official Google Cloud CLI inside an exact
//! app-selected Workspace/member scope. SQL is sent over stdin (never argv), every
//! read is server dry-run first, and the real job carries a byte-billing ceiling plus
//! an exact id for cancellation.

#[path = "connection.rs"]
mod connection;
#[path = "contract.rs"]
mod contract;
#[path = "executable.rs"]
mod executable;
mod onboarding;
mod runtime;

use contract::*;
use executable::*;

#[cfg(test)]
pub(crate) use contract::assert_bigquery_contract;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use semver::Version;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::executor::cancel::CancelHandle;
use crate::features::catalog::{
    Catalog, CatalogOverview, CatalogOverviewDetailState, CatalogOverviewRelation, Column,
    DatabaseObject, Table,
};
use crate::kernel::access::ActiveResourceScope;
use crate::model::{ConnectionProfile, QueryResult};
use crate::process_tree::{ProcessTree, ProcessTreeError};

pub(crate) use onboarding::{
    auth_state, authenticate_google_account, authenticate_service_account, cleanup_connection_auth,
    cleanup_service_account_auth, discover_datasets, discover_projects, uses_service_account_auth,
    BigQueryAuthState, BigQueryDatasetSummary, BigQueryProjectSummary,
};
pub(crate) use runtime::install_managed_cli;

const MINIMUM_BQ_VERSION: &str = "2.0.29";
pub(crate) const DEFAULT_MAXIMUM_BYTES_BILLED: u64 = 1_073_741_824;
const MAXIMUM_BYTES_BILLED_LIMIT: u64 = 10 * 1024 * 1024 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SQL_BYTES: usize = 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_ERROR_BYTES: usize = 256 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const QUERY_TIMEOUT: Duration = Duration::from_secs(300);
const CANCEL_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_LIST_RESULTS: u64 = 10_000;

/// Opaque local-only CLI profile identity. Google-account authentication is shared
/// only inside one exact Workspace/member selection; service-account authentication
/// narrows that boundary to one connection binding. Neither key exposes account data
/// in filesystem paths or process arguments.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BigQueryAuthScope {
    workspace_member_key: String,
    connection_binding_key: String,
}

impl BigQueryAuthScope {
    pub(crate) fn from_active_scope(scope: &ActiveResourceScope, connection_id: Uuid) -> Self {
        let mut workspace_digest = Sha256::new();
        workspace_digest.update(b"dopedb-bigquery-workspace-member-v1\0");
        workspace_digest.update(scope.workspace_id.as_bytes());
        workspace_digest.update(b"\0");
        workspace_digest.update(scope.account_scope.storage_key().as_bytes());
        let workspace_member_key = hex::encode(workspace_digest.finalize());

        let mut connection_digest = Sha256::new();
        connection_digest.update(b"dopedb-bigquery-connection-binding-v1\0");
        connection_digest.update(workspace_member_key.as_bytes());
        connection_digest.update(b"\0");
        connection_digest.update(connection_id.as_bytes());
        let connection_binding_key = hex::encode(connection_digest.finalize());

        Self {
            workspace_member_key,
            connection_binding_key,
        }
    }

    fn workspace_member_key(&self) -> &str {
        &self.workspace_member_key
    }

    fn connection_binding_key(&self) -> &str {
        &self.connection_binding_key
    }
}

#[derive(Clone)]
pub(crate) struct BigQueryConnection {
    inner: Arc<BigQueryConnectionInner>,
}

struct BigQueryConnectionInner {
    executable: ResolvedSdkExecutable,
    home: PathBuf,
    cloudsdk_config: PathBuf,
    project: String,
    dataset: String,
    location: String,
    maximum_bytes_billed: u64,
}

#[derive(Clone)]
struct ExecutableIdentity {
    canonical_path: PathBuf,
    sha256: String,
    byte_length: u64,
}

#[derive(Clone)]
struct ResolvedSdkExecutable {
    identity: ExecutableIdentity,
    environment: runtime::CommandEnvironment,
}

#[derive(Debug)]
struct CommandOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandFailure {
    Unavailable,
    Changed,
    Spawn,
    Isolation,
    Cleanup,
    Output,
    Cancelled,
    TimedOut,
}

#[derive(Debug)]
struct DryRun {
    columns: Vec<String>,
    total_bytes_processed: Option<u64>,
}

/// Synchronous presence probe used by the driver catalog. Connection-time hashing
/// and version validation remain authoritative.
pub(crate) fn is_cli_available() -> bool {
    sdk_roots().into_iter().any(|root| {
        let bq = root
            .join("bin")
            .join(if cfg!(windows) { "bq.cmd" } else { "bq" });
        let gcloud = root.join("bin").join(if cfg!(windows) {
            "gcloud.cmd"
        } else {
            "gcloud"
        });
        audited_candidate_exists(&bq, &root) && audited_candidate_exists(&gcloud, &root)
    })
}

fn audited_candidate_exists(candidate: &Path, root: &Path) -> bool {
    let Ok(canonical_root) = root.canonicalize() else {
        return false;
    };
    let Ok(canonical_candidate) = candidate.canonicalize() else {
        return false;
    };
    let Ok(metadata) = candidate.symlink_metadata() else {
        return false;
    };
    metadata.is_file()
        && !metadata.file_type().is_symlink()
        && metadata.len() > 0
        && metadata.len() <= MAX_EXECUTABLE_BYTES
        && canonical_candidate.starts_with(canonical_root)
}

pub(crate) fn validate_profile(profile: &ConnectionProfile) -> AppResult<()> {
    if !valid_project_id(profile.host.trim()) {
        return Err(AppError::Config(
            "BigQuery project ID must be 6-30 lowercase letters, digits, or hyphens; start with a letter; and not end with a hyphen"
                .into(),
        ));
    }
    if !valid_dataset_id(profile.database.trim()) {
        return Err(AppError::Config(
            "BigQuery dataset ID must contain only letters, digits, or underscores and be at most 1024 characters"
                .into(),
        ));
    }
    if profile.provider != crate::model::Provider::Generic {
        return Err(AppError::Config(
            "BigQuery connections use the generic provider with local Google Cloud CLI authentication"
                .into(),
        ));
    }
    if profile.port != 443 {
        return Err(AppError::Config(
            "BigQuery connections use the fixed HTTPS port 443".into(),
        ));
    }
    if profile.sslmode != "require" {
        return Err(AppError::Config(
            "BigQuery connections require the official HTTPS API endpoint".into(),
        ));
    }
    if !profile.username.trim().is_empty() {
        return Err(AppError::Config(
            "BigQuery credentials are owned by Google Cloud CLI; username must be empty".into(),
        ));
    }
    if profile.allow_writes || !profile.readonly_default {
        return Err(AppError::Blocked {
            reason: "BigQuery is available only through DopeDB's read-only query adapter".into(),
        });
    }
    onboarding::validate_auth_mode(profile)?;
    if profile
        .extra_params
        .keys()
        .any(|key| !matches!(key.as_str(), "authMode" | "location" | "maximumBytesBilled"))
    {
        return Err(AppError::Config(
            "BigQuery accepts only authMode, location, and maximumBytesBilled connection options"
                .into(),
        ));
    }
    if profile
        .extra_params
        .get("location")
        .is_some_and(|value| !valid_location(value.trim()))
    {
        return Err(AppError::Config(
            "BigQuery location must contain only letters, digits, or hyphens".into(),
        ));
    }
    maximum_bytes_billed(profile)?;
    Ok(())
}

pub(crate) async fn connect(
    profile: &ConnectionProfile,
    auth_scope: &BigQueryAuthScope,
) -> AppResult<BigQueryConnection> {
    validate_profile(profile)?;
    let home = crate::app_paths::home_dir()?;
    let cloudsdk_config = onboarding::cloudsdk_config(profile, auth_scope)?;
    let executable = discover_executable().await?;
    let provisional = BigQueryConnection {
        inner: Arc::new(BigQueryConnectionInner {
            executable,
            home,
            cloudsdk_config,
            project: profile.host.trim().to_owned(),
            dataset: profile.database.trim().to_owned(),
            location: profile
                .extra_params
                .get("location")
                .map(|value| value.trim().to_owned())
                .unwrap_or_default(),
            maximum_bytes_billed: maximum_bytes_billed(profile)?,
        }),
    };
    provisional.verify_version().await?;
    let metadata = provisional.dataset_metadata().await?;
    let location = exact_string(&metadata, &["location"])
        .filter(|location| valid_location(location))
        .ok_or_else(|| AppError::Config("BigQuery returned an invalid dataset location".into()))?
        .to_owned();
    validate_dataset_reference(&metadata, provisional.project(), provisional.dataset())?;
    if !provisional.inner.location.is_empty()
        && !provisional.inner.location.eq_ignore_ascii_case(&location)
    {
        return Err(AppError::Config(format!(
            "BigQuery dataset location is {location}, not {}",
            provisional.inner.location
        )));
    }
    Ok(BigQueryConnection {
        inner: Arc::new(BigQueryConnectionInner {
            location,
            executable: provisional.inner.executable.clone(),
            home: provisional.inner.home.clone(),
            cloudsdk_config: provisional.inner.cloudsdk_config.clone(),
            project: provisional.inner.project.clone(),
            dataset: provisional.inner.dataset.clone(),
            maximum_bytes_billed: provisional.inner.maximum_bytes_billed,
        }),
    })
}
