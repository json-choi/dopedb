//! App-owned Google Cloud CLI runtime for BigQuery.
//!
//! DopeDB still delegates every Google request and login to Google's unmodified
//! `gcloud`/`bq` entrypoints. This module only removes the prerequisite that a
//! member install those tools globally: it downloads one pinned official archive,
//! verifies its exact size and SHA-256, extracts into a private staging directory,
//! probes both entrypoints, then publishes the runtime atomically.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use flate2::read::GzDecoder;
use futures::StreamExt;
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[path = "runtime_archive.rs"]
mod archive;
#[path = "runtime_installation.rs"]
mod installation;

use archive::*;
use installation::*;

const SDK_VERSION: &str = "582.0.0";
const MARKER_SCHEMA_VERSION: u8 = 1;
const PYTHON_VERSION: &str = "3.14";
const PYTHON_PACKAGE_NAME: &str = "python-3.14.6-macos11.pkg";
const PYTHON_ARCHIVE: Artifact = Artifact {
    url: "https://dl.google.com/dl/cloudsdk/channels/rapid/python-3.14.6-macos11.tar.gz",
    packed_bytes: 77_425_360,
    sha256: "fa7a5af0ce7d824f5a51dbb6fa74870c457d7f8ada2845f55a4d93cebfcd7711",
};
const PYTHON_INSTALLER_TEAM: &str = "Python Software Foundation (BMM5U3QVKW)";
const MAX_ARCHIVE_ENTRIES: usize = 50_000;
const MAX_ARCHIVE_DEPTH: usize = 32;
const MAX_ARCHIVE_PATH_BYTES: usize = 4 * 1024;
const MAX_ARCHIVE_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 768 * 1024 * 1024;
const MAX_MARKER_BYTES: u64 = 16 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PROBE_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Clone, Copy)]
struct Artifact {
    url: &'static str,
    packed_bytes: u64,
    sha256: &'static str,
}

#[derive(Debug, Clone, Default)]
pub(super) struct CommandEnvironment {
    variables: Vec<(OsString, OsString)>,
}

impl CommandEnvironment {
    pub(super) fn apply(&self, command: &mut Command) {
        command.envs(self.variables.iter().cloned());
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstalledMarker {
    schema_version: u8,
    sdk_version: String,
    platform: String,
    sdk_archive_sha256: String,
    python_archive_sha256: Option<String>,
    gcloud_sha256: String,
    bq_sha256: String,
    python_sha256: String,
    python_library_sha256: Option<String>,
    launcher_sha256: Option<String>,
}

pub(crate) fn managed_sdk_root_if_ready() -> Option<PathBuf> {
    let root = target_root().ok()?;
    verify_installed(&root).ok()?;
    Some(root.join("google-cloud-sdk"))
}

pub(super) fn command_environment() -> AppResult<CommandEnvironment> {
    Ok(managed_environment(&target_root()?))
}

pub(crate) async fn install_managed_cli() -> AppResult<()> {
    // A cancelled catalog request must not abandon a verified download/extraction
    // halfway through. The owned task keeps the install lock and always cleans its
    // private staging tree; concurrent callers reuse the published runtime.
    tokio::spawn(install_managed_cli_owned())
        .await
        .map_err(|_| AppError::Config("Google connection tool preparation stopped".into()))?
}

async fn install_managed_cli_owned() -> AppResult<()> {
    let _guard = install_lock().lock().await;
    if managed_sdk_root_if_ready().is_some() {
        return Ok(());
    }
    let sdk_artifact = sdk_artifact().ok_or_else(|| {
        AppError::Config(
            "automatic Google Cloud CLI preparation is unavailable for this operating system and architecture"
                .into(),
        )
    })?;
    let base = runtime_base()?;
    prepare_private_directory(&base)?;
    let work = base.join(format!(".staging-{}", Uuid::new_v4().simple()));
    create_private_directory(&work)?;
    let staged_runtime = work.join("runtime");
    create_private_directory(&staged_runtime)?;
    let sdk_download = work.join("google-cloud-sdk.download");

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(DOWNLOAD_TIMEOUT)
        .redirect(Policy::none())
        .user_agent(format!(
            "DopeDB/{} BigQuery-runtime",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|_| AppError::Config("the Google tool download client is unavailable".into()))?;

    let result = async {
        #[cfg(target_os = "macos")]
        let python_download = work.join("python.download");
        #[cfg(target_os = "macos")]
        {
            tokio::try_join!(
                download_verified(&client, sdk_artifact, &sdk_download, "Google Cloud CLI"),
                download_verified(&client, PYTHON_ARCHIVE, &python_download, "Python runtime")
            )?;
        }
        #[cfg(not(target_os = "macos"))]
        download_verified(&client, sdk_artifact, &sdk_download, "Google Cloud CLI").await?;

        let sdk_archive = sdk_download.clone();
        let extraction_root = staged_runtime.clone();
        tokio::task::spawn_blocking(move || extract_sdk(&sdk_archive, &extraction_root))
            .await
            .map_err(|_| {
                AppError::Config("Google Cloud CLI extraction stopped unexpectedly".into())
            })??;

        #[cfg(target_os = "macos")]
        prepare_macos_python(&python_download, &work, &staged_runtime).await?;

        write_marker(&staged_runtime, sdk_artifact)?;
        verify_installed(&staged_runtime)?;
        probe_runtime(&staged_runtime).await?;
        publish_runtime(&staged_runtime)?;
        Ok(())
    }
    .await;

    let _ = remove_exact_path(&work);
    result
}

fn install_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn runtime_base() -> AppResult<PathBuf> {
    Ok(crate::app_paths::local_data_root()?.join("bigquery-runtime"))
}

fn target_root() -> AppResult<PathBuf> {
    let platform = platform_id().ok_or_else(|| {
        AppError::Config("the current platform has no managed Google Cloud CLI artifact".into())
    })?;
    Ok(runtime_base()?.join(format!("google-cloud-cli-{SDK_VERSION}-{platform}")))
}

fn platform_id() -> Option<&'static str> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some("macos-aarch64");
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Some("macos-x86_64");
    #[cfg(all(windows, target_arch = "x86_64"))]
    return Some("windows-x86_64");
    #[allow(unreachable_code)]
    None
}

fn sdk_artifact() -> Option<Artifact> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some(Artifact {
        url: "https://storage.googleapis.com/cloud-sdk-release/google-cloud-sdk-582.0.0-darwin-arm.tar.gz",
        packed_bytes: 52_255_332,
        sha256: "7ed2c24d1a5f288e0079339634b340085622ea229dfbdbb6c436b12a36a9c650",
    });
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Some(Artifact {
        url: "https://storage.googleapis.com/cloud-sdk-release/google-cloud-sdk-582.0.0-darwin-x86_64.tar.gz",
        packed_bytes: 52_349_186,
        sha256: "44c3c0e429a764b9634f203478b436feeb5b1c84c513950ca961c436c1432598",
    });
    #[cfg(all(windows, target_arch = "x86_64"))]
    return Some(Artifact {
        url: "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-sdk-582.0.0-windows-x86_64-bundled-python.zip",
        packed_bytes: 101_451_940,
        sha256: "0f9cfc3ef59c46eca9c3254e1e5b0bd42b3894b71464faa91054456277ddd6f8",
    });
    #[allow(unreachable_code)]
    None
}

async fn download_verified(
    client: &reqwest::Client,
    artifact: Artifact,
    destination: &Path,
    label: &str,
) -> AppResult<()> {
    if !artifact.url.starts_with("https://") || !valid_digest(artifact.sha256) {
        return Err(AppError::Config(format!(
            "the pinned {label} artifact metadata is invalid"
        )));
    }
    let response = client
        .get(artifact.url)
        .send()
        .await
        .map_err(|_| AppError::Network(format!("the {label} download failed")))?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "the {label} download returned HTTP {}",
            response.status().as_u16()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length != artifact.packed_bytes)
    {
        return Err(AppError::Network(format!(
            "the {label} download size did not match the pinned artifact"
        )));
    }
    let mut options = tokio::fs::OpenOptions::new();
    options.create_new(true).write(true);
    let mut output = options.open(destination).await?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut written = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| AppError::Network(format!("the {label} download stream failed")))?;
        written = written
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| AppError::Network(format!("the {label} download size overflowed")))?;
        if written > artifact.packed_bytes {
            return Err(AppError::Network(format!(
                "the {label} download exceeded the pinned size"
            )));
        }
        hasher.update(&chunk);
        output.write_all(&chunk).await?;
    }
    output.flush().await?;
    output.sync_all().await?;
    if written != artifact.packed_bytes || hex::encode(hasher.finalize()) != artifact.sha256 {
        return Err(AppError::Blocked {
            reason: format!("the downloaded {label} did not match its pinned SHA-256"),
        });
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn prepare_macos_python(archive_path: &Path, work: &Path, runtime: &Path) -> AppResult<()> {
    let archive = archive_path.to_path_buf();
    let package = work.join(PYTHON_PACKAGE_NAME);
    let package_for_extract = package.clone();
    tokio::task::spawn_blocking(move || extract_python_package(&archive, &package_for_extract))
        .await
        .map_err(|_| AppError::Config("Python package extraction stopped unexpectedly".into()))??;

    let signature = run_pkgutil(&["--check-signature", package.to_string_lossy().as_ref()]).await?;
    if !signature.contains(PYTHON_INSTALLER_TEAM)
        || !signature.contains("Notarization: trusted by the Apple notary service")
    {
        return Err(AppError::Blocked {
            reason:
                "the managed Python package did not have the expected trusted installer signature"
                    .into(),
        });
    }

    let expanded = work.join("python-expanded");
    run_pkgutil(&[
        "--expand-full",
        package.to_string_lossy().as_ref(),
        expanded.to_string_lossy().as_ref(),
    ])
    .await?;
    let source = expanded
        .join("Python_Framework.pkg")
        .join("Payload")
        .join("Versions")
        .join(PYTHON_VERSION);
    let metadata = fs::symlink_metadata(&source)
        .map_err(|_| AppError::Config("the verified Python framework payload is missing".into()))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(AppError::Blocked {
            reason: "the verified Python framework payload has an unsafe file type".into(),
        });
    }
    let versions = runtime.join("python/Python.framework/Versions");
    create_owned_directories(runtime, &versions)?;
    fs::rename(&source, versions.join(PYTHON_VERSION))?;
    write_python_launcher(runtime)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn extract_python_package(archive_path: &Path, destination: &Path) -> AppResult<()> {
    let archive = File::open(archive_path)?;
    let decoder = GzDecoder::new(archive);
    let mut archive = tar::Archive::new(decoder);
    let mut found = false;
    let mut entries = 0usize;
    for entry in archive
        .entries()
        .map_err(|_| archive_error("the Python archive index is invalid"))?
    {
        let mut entry = entry.map_err(|_| archive_error("the Python archive entry is invalid"))?;
        entries = entries.saturating_add(1);
        let path = entry
            .path()
            .map_err(|_| archive_error("the Python archive path is invalid"))?;
        if entries > 1
            || path.as_ref() != Path::new(PYTHON_PACKAGE_NAME)
            || !entry.header().entry_type().is_file()
            || entry.size() == 0
            || entry.size() > MAX_ARCHIVE_FILE_BYTES
        {
            return Err(archive_error("the Python archive layout is invalid"));
        }
        let size = entry.size();
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(destination)?;
        let copied = io::copy(
            &mut entry.by_ref().take(size.saturating_add(1)),
            &mut output,
        )?;
        if copied != size {
            return Err(archive_error("the Python package size is invalid"));
        }
        output.sync_all()?;
        found = true;
    }
    if !found {
        return Err(archive_error("the Python package is missing"));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn run_pkgutil(arguments: &[&str]) -> AppResult<String> {
    let mut command = Command::new("/usr/sbin/pkgutil");
    command
        .args(arguments)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    command.process_group(0);
    let output = tokio::time::timeout(Duration::from_secs(3 * 60), command.output())
        .await
        .map_err(|_| AppError::Timeout("the trusted Python package inspection timed out".into()))?
        .map_err(|_| AppError::Config("macOS could not inspect the Python package".into()))?;
    if !output.status.success() {
        return Err(AppError::Blocked {
            reason: "macOS rejected the managed Python package".into(),
        });
    }
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    if text.len() > 64 * 1024 {
        return Err(AppError::Blocked {
            reason: "macOS returned excessive Python package inspection output".into(),
        });
    }
    Ok(text)
}

#[cfg(target_os = "macos")]
fn write_python_launcher(runtime: &Path) -> AppResult<()> {
    const LAUNCHER: &str = "#!/bin/sh\nset -eu\n: \"${DOPEDB_MANAGED_PYTHON:?}\"\n: \"${DOPEDB_MANAGED_FRAMEWORK_PATH:?}\"\n: \"${DOPEDB_MANAGED_LIBRARY_PATH:?}\"\nexport DYLD_FRAMEWORK_PATH=\"$DOPEDB_MANAGED_FRAMEWORK_PATH\"\nexport DYLD_LIBRARY_PATH=\"$DOPEDB_MANAGED_LIBRARY_PATH\"\nexec \"$DOPEDB_MANAGED_PYTHON\" \"$@\"\n";
    let bin = runtime.join("bin");
    create_owned_directories(runtime, &bin)?;
    let path = bin.join("python-launcher.sh");
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)?;
    use std::io::Write;
    output.write_all(LAUNCHER.as_bytes())?;
    output.sync_all()?;
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

async fn probe_runtime(runtime: &Path) -> AppResult<()> {
    let sdk = runtime.join("google-cloud-sdk");
    let environment = managed_environment(runtime);
    let config = runtime.join("probe-config");
    create_private_directory(&config)?;
    let gcloud = sdk.join("bin").join(if cfg!(windows) {
        "gcloud.cmd"
    } else {
        "gcloud"
    });
    let bq = sdk
        .join("bin")
        .join(if cfg!(windows) { "bq.cmd" } else { "bq" });
    run_probe(
        &gcloud,
        &["--quiet", "--format=json", "version"],
        &config,
        &environment,
    )
    .await?;
    run_probe(
        &bq,
        &[
            if cfg!(windows) {
                "--bigqueryrc=NUL"
            } else {
                "--bigqueryrc=/dev/null"
            },
            "--quiet=true",
            "version",
        ],
        &config,
        &environment,
    )
    .await?;
    remove_exact_path(&config)?;
    Ok(())
}

async fn run_probe(
    executable: &Path,
    arguments: &[&str],
    config: &Path,
    environment: &CommandEnvironment,
) -> AppResult<()> {
    let mut command = Command::new(executable);
    command
        .args(arguments)
        .env_clear()
        .env(
            "PATH",
            if cfg!(windows) {
                r"C:\Windows\System32"
            } else {
                "/usr/bin:/bin:/usr/sbin:/sbin"
            },
        )
        .env("HOME", crate::app_paths::home_dir()?)
        .env("CLOUDSDK_CONFIG", config)
        .env("CLOUDSDK_CORE_DISABLE_PROMPTS", "1")
        .env("CLOUDSDK_CORE_DISABLE_USAGE_REPORTING", "true")
        .env("CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK", "1")
        .env("CLOUDSDK_CORE_LOG_HTTP", "false")
        .env("PYTHONIOENCODING", "utf-8")
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    environment.apply(&mut command);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(
        windows_sys::Win32::System::Threading::CREATE_NO_WINDOW
            | windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP,
    );
    let output = tokio::time::timeout(PROBE_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::Timeout("the managed Google Cloud CLI probe timed out".into()))?
        .map_err(|_| AppError::Config("the managed Google Cloud CLI could not start".into()))?;
    if !output.status.success() {
        return Err(AppError::Config(
            "the verified Google Cloud CLI runtime did not pass its local startup probe".into(),
        ));
    }
    if output.stdout.len().saturating_add(output.stderr.len()) > 1024 * 1024 {
        return Err(AppError::Blocked {
            reason: "the managed Google Cloud CLI probe exceeded its output limit".into(),
        });
    }
    Ok(())
}

fn publish_runtime(staged: &Path) -> AppResult<()> {
    let target = target_root()?;
    let base = runtime_base()?;
    let backup = base.join(format!(".backup-{}", Uuid::new_v4().simple()));
    let had_existing = fs::symlink_metadata(&target).is_ok();
    if had_existing {
        fs::rename(&target, &backup)?;
    }
    if let Err(error) = fs::rename(staged, &target) {
        if had_existing {
            let _ = fs::rename(&backup, &target);
        }
        return Err(error.into());
    }
    if let Err(error) = verify_installed(&target) {
        let _ = remove_exact_path(&target);
        if had_existing {
            let _ = fs::rename(&backup, &target);
        }
        return Err(error);
    }
    if had_existing {
        remove_exact_path(&backup)?;
    }
    Ok(())
}

fn prepare_private_directory(directory: &Path) -> AppResult<()> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(AppError::Blocked {
                    reason: "the Google tool runtime root must be a private local directory".into(),
                });
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(directory)?;
        }
        Err(error) => return Err(error.into()),
    }
    set_private_directory_permissions(directory)
}

fn create_private_directory(directory: &Path) -> AppResult<()> {
    fs::create_dir(directory)?;
    set_private_directory_permissions(directory)
}

fn create_owned_directories(root: &Path, directory: &Path) -> AppResult<()> {
    let relative = directory
        .strip_prefix(root)
        .map_err(|_| archive_error("an extracted directory escaped staging"))?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(archive_error("an extracted directory path is unsafe"));
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if !metadata.is_dir() || metadata.file_type().is_symlink() {
                    return Err(archive_error(
                        "an extracted directory collides with an unsafe file",
                    ));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::create_dir(&current)?;
                set_private_directory_permissions(&current)?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn set_private_directory_permissions(directory: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn checked_regular_file(path: &Path, maximum: u64) -> AppResult<u64> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| AppError::Config("a managed Google Cloud CLI file is missing".into()))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() == 0
        || metadata.len() > maximum
    {
        return Err(AppError::Blocked {
            reason: "a managed Google Cloud CLI file has an unsafe type or size".into(),
        });
    }
    Ok(metadata.len())
}

fn sha256_regular_file(path: &Path, maximum: u64) -> AppResult<String> {
    checked_regular_file(path, maximum)?;
    let mut input = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn remove_exact_path(path: &Path) -> AppResult<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn archive_error(message: &str) -> AppError {
    AppError::Blocked {
        reason: message.into(),
    }
}

#[cfg(test)]
pub(super) fn assert_runtime_contract() {
    let artifact = sdk_artifact().expect("supported test platform");
    assert!(artifact.url.starts_with("https://"));
    assert!(artifact.packed_bytes > 50_000_000);
    assert!(valid_digest(artifact.sha256));
    assert_eq!(SDK_VERSION, "582.0.0");
    assert!(validate_relative_path(Path::new("google-cloud-sdk/bin/bq")).is_ok());
    assert!(validate_relative_path(Path::new("../google-cloud-sdk/bin/bq")).is_err());
    assert!(validate_relative_path(Path::new("google-cloud-sdk/../../escape")).is_err());
    assert!(validate_relative_path(Path::new("other/bin/bq")).is_err());
    #[cfg(not(windows))]
    assert!(validate_relative_path(Path::new("google-cloud-sdk\\bin\\bq")).is_err());
    let sdk = Path::new("google-cloud-sdk");
    let environment = sdk_environment(sdk);
    let path = environment
        .variables
        .iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| value)
        .expect("SDK command PATH");
    assert_eq!(std::env::split_paths(path).next(), Some(sdk.join("bin")));
    #[cfg(windows)]
    {
        assert!(validate_relative_path(Path::new(r"google-cloud-sdk\bin\bq.cmd")).is_ok());
        for key in ["SystemRoot", "ComSpec", "TEMP", "TMP"] {
            assert!(environment
                .variables
                .iter()
                .any(|(candidate, _)| candidate == key));
        }
    }
    #[cfg(target_os = "macos")]
    {
        let root = Path::new("/private/dopedb-google-runtime");
        let environment = managed_environment(root);
        for (key, expected) in [
            ("CLOUDSDK_PYTHON", root.join("bin/python-launcher.sh")),
            ("DOPEDB_MANAGED_PYTHON", managed_python_path(root)),
            ("DOPEDB_MANAGED_FRAMEWORK_PATH", root.join("python")),
        ] {
            assert!(environment
                .variables
                .iter()
                .any(|(name, value)| { name == key && value == expected.as_os_str() }));
        }
        assert!(valid_digest(PYTHON_ARCHIVE.sha256));
        assert_eq!(
            PYTHON_INSTALLER_TEAM,
            "Python Software Foundation (BMM5U3QVKW)"
        );
        assert!(skippable_sdk_symlink(Path::new(
            "google-cloud-sdk/platform/gsutil/third_party/mock/docs/changelog.txt"
        )));
        assert!(!skippable_sdk_symlink(Path::new("google-cloud-sdk/bin/bq")));
    }
}
