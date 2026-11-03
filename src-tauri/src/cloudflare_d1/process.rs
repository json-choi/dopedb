//! Audited, bounded process boundary for Cloudflare's official Wrangler CLI.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::process_tree::ProcessTree;

const MAX_EXECUTABLE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_ERROR_BYTES: usize = 256 * 1024;
const MAX_ARGUMENTS: usize = 24;
const MAX_SQL_BYTES: usize = 1024 * 1024;
const BRIDGE: &str = "const fs=require('fs');const r=JSON.parse(fs.readFileSync(0,'utf8'));process.argv=[process.execPath,r.entrypoint,...r.arguments];require('module').runMain();";

#[derive(Clone)]
struct ExecutableIdentity {
    path: PathBuf,
    sha256: String,
    length: u64,
}

#[derive(Clone)]
pub(super) struct WranglerRuntime {
    node: ExecutableIdentity,
    entrypoint: ExecutableIdentity,
}

#[derive(Serialize)]
struct BridgeRequest<'a> {
    entrypoint: &'a Path,
    arguments: &'a [String],
}

pub(super) fn runtime_candidates_exist() -> bool {
    installation_candidates().iter().any(|candidate| {
        regular_file(&candidate.node)
            && regular_file(&candidate.entrypoint)
            && candidate
                .entrypoint
                .canonicalize()
                .is_ok_and(|path| valid_wrangler_entrypoint(&path))
    })
}

/// Picks the first Node.js whose own global npm packages contain Wrangler, so the
/// runtime is exactly what `npm i -g wrangler` installed with that Node.js.
pub(super) async fn discover_runtime() -> AppResult<WranglerRuntime> {
    let candidates = installation_candidates();
    for candidate in &candidates {
        let Some(node) = identify(&candidate.node, is_node_executable).await else {
            continue;
        };
        let Some(entrypoint) = identify(&candidate.entrypoint, valid_wrangler_entrypoint).await
        else {
            continue;
        };
        return Ok(WranglerRuntime { node, entrypoint });
    }
    if candidates
        .iter()
        .any(|candidate| regular_file(&candidate.node))
    {
        Err(AppError::Config(
            "Cloudflare Wrangler is not installed; run `npm i -g wrangler` and retry".into(),
        ))
    } else {
        Err(AppError::Config(
            "Node.js is required to run the official Wrangler CLI; install Node.js, then run `npm i -g wrangler`".into(),
        ))
    }
}

pub(super) async fn run_json(
    runtime: &WranglerRuntime,
    arguments: &[String],
    auth_root: &Path,
    account_id: Option<&str>,
    timeout: Duration,
) -> AppResult<Value> {
    let output = run_checked(runtime, arguments, auth_root, account_id, timeout).await?;
    serde_json::from_slice(&output)
        .map_err(|_| AppError::Config("Wrangler returned invalid JSON".into()))
}

pub(super) async fn verify_version(runtime: &WranglerRuntime, auth_root: &Path) -> AppResult<()> {
    let output = run_checked(
        runtime,
        &["--version".into()],
        auth_root,
        None,
        Duration::from_secs(15),
    )
    .await?;
    let text = String::from_utf8(output)
        .map_err(|_| AppError::Config("Wrangler returned an invalid version".into()))?;
    let version = semver::Version::parse(text.trim().trim_start_matches('v'))
        .map_err(|_| AppError::Config("Wrangler returned an invalid version".into()))?;
    if version.major < 4 {
        return Err(AppError::Config(
            "Cloudflare D1 requires Wrangler 4 or later".into(),
        ));
    }
    Ok(())
}

pub(super) async fn run_checked(
    runtime: &WranglerRuntime,
    arguments: &[String],
    auth_root: &Path,
    account_id: Option<&str>,
    timeout: Duration,
) -> AppResult<Vec<u8>> {
    validate_arguments(arguments)?;
    let node = runtime.node.revalidate().await?;
    let entrypoint = runtime.entrypoint.revalidate().await?;
    let request = serde_json::to_vec(&BridgeRequest {
        entrypoint: &entrypoint,
        arguments,
    })?;
    let mut command = Command::new(node);
    command
        .args(["--eval", BRIDGE])
        .current_dir(auth_root)
        .env_clear()
        .env("HOME", auth_root)
        .env("XDG_CONFIG_HOME", auth_root)
        .env("NO_COLOR", "1")
        .env("WRANGLER_SEND_METRICS", "false")
        .env("PATH", safe_path())
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(account_id) = account_id {
        command.env("CLOUDFLARE_ACCOUNT_ID", account_id);
    }
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(
        windows_sys::Win32::System::Threading::CREATE_NO_WINDOW
            | windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP,
    );
    let mut child = command
        .spawn()
        .map_err(|_| AppError::Config("the verified Wrangler CLI could not be started".into()))?;
    let mut tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Err(AppError::Blocked {
                reason: "the Wrangler process could not be isolated safely".into(),
            });
        }
    };
    let mut stdin = child.stdin.take().ok_or_else(|| AppError::Blocked {
        reason: "Wrangler stdin was unavailable".into(),
    })?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::Blocked {
        reason: "Wrangler stdout was unavailable".into(),
    })?;
    let stderr = child.stderr.take().ok_or_else(|| AppError::Blocked {
        reason: "Wrangler stderr was unavailable".into(),
    })?;
    let captured = tokio::time::timeout(timeout, async move {
        stdin.write_all(&request).await.map_err(|_| ())?;
        stdin.shutdown().await.map_err(|_| ())?;
        tokio::try_join!(
            read_bounded(stdout, MAX_OUTPUT_BYTES),
            read_bounded(stderr, MAX_ERROR_BYTES)
        )
        .map_err(|_| ())
    })
    .await;
    let status = tree.terminate_and_reap(&mut child).await.map_err(|_| {
        AppError::OutcomeUnknown("Wrangler process cleanup could not be proven".into())
    })?;
    let (stdout, stderr) = captured
        .map_err(|_| AppError::Timeout("Wrangler request timed out".into()))?
        .map_err(|_| AppError::Blocked {
            reason: "Wrangler output exceeded its local safety bound".into(),
        })?;
    if status.success()
        || (arguments == ["whoami", "--json"] && serde_json::from_slice::<Value>(&stdout).is_ok())
    {
        Ok(stdout)
    } else {
        Err(safe_error(&stderr))
    }
}

impl ExecutableIdentity {
    async fn revalidate(&self) -> AppResult<PathBuf> {
        let canonical = tokio::fs::canonicalize(&self.path)
            .await
            .map_err(|_| changed_runtime())?;
        let (sha256, length) = hash_regular_file(&canonical).await?;
        if canonical != self.path || sha256 != self.sha256 || length != self.length {
            return Err(changed_runtime());
        }
        Ok(canonical)
    }
}

async fn identify(
    candidate: &Path,
    validate: impl Fn(&Path) -> bool,
) -> Option<ExecutableIdentity> {
    let path = tokio::fs::canonicalize(candidate).await.ok()?;
    if !validate(&path) {
        return None;
    }
    let (sha256, length) = hash_regular_file(&path).await.ok()?;
    Some(ExecutableIdentity {
        path,
        sha256,
        length,
    })
}

async fn hash_regular_file(path: &Path) -> AppResult<(String, u64)> {
    let metadata = tokio::fs::metadata(path).await?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_EXECUTABLE_BYTES {
        return Err(changed_runtime());
    }
    let bytes = tokio::fs::read(path).await?;
    if bytes.len() as u64 != metadata.len() {
        return Err(changed_runtime());
    }
    Ok((hex::encode(Sha256::digest(&bytes)), metadata.len()))
}

async fn read_bounded<R: AsyncRead + Unpin>(mut reader: R, maximum: usize) -> Result<Vec<u8>, ()> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader.read(&mut buffer).await.map_err(|_| ())?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > maximum {
            return Err(());
        }
        output.extend_from_slice(&buffer[..count]);
    }
}

fn validate_arguments(arguments: &[String]) -> AppResult<()> {
    if arguments.is_empty()
        || arguments.len() > MAX_ARGUMENTS
        || arguments.iter().any(|argument| {
            argument.is_empty()
                || argument.len() > MAX_SQL_BYTES
                || argument.chars().any(|value| value == '\0')
        })
    {
        return Err(AppError::Blocked {
            reason: "Wrangler request is invalid".into(),
        });
    }
    Ok(())
}

fn safe_error(stderr: &[u8]) -> AppError {
    let text = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if text.contains("not logged in")
        || text.contains("login required")
        || text.contains("authentication error")
        || text.contains("oauth") && text.contains("expired")
    {
        return AppError::Config(
            "Cloudflare authentication is unavailable; reconnect the account and retry".into(),
        );
    }
    if text.contains("permission") || text.contains("forbidden") || text.contains("unauthorized") {
        return AppError::Blocked {
            reason: "the connected Cloudflare account cannot access this D1 resource".into(),
        };
    }
    if text.contains("not found") {
        return AppError::NotFound("the selected Cloudflare D1 database was not found".into());
    }
    if text.contains("timed out")
        || text.contains("connection reset")
        || text.contains("network")
        || text.contains("could not resolve")
    {
        return AppError::Network("Wrangler could not connect to Cloudflare".into());
    }
    AppError::Config("Wrangler rejected the Cloudflare D1 request".into())
}

fn changed_runtime() -> AppError {
    AppError::Blocked {
        reason: "the verified Wrangler or Node.js executable changed or became unavailable".into(),
    }
}

fn valid_wrangler_entrypoint(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some("cli.js")
        && path
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            == Some("wrangler-dist")
        && path
            .parent()
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            == Some("wrangler")
}

fn regular_file(path: &Path) -> bool {
    path.canonicalize()
        .ok()
        .and_then(|candidate| candidate.metadata().ok())
        .is_some_and(|metadata| {
            metadata.is_file() && metadata.len() > 0 && metadata.len() <= MAX_EXECUTABLE_BYTES
        })
}

fn is_node_executable(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| matches!(name, "node" | "node.exe"))
}

/// A Node.js executable paired with the Wrangler entrypoint its npm installs globally.
#[derive(Debug, PartialEq, Eq)]
struct InstallationCandidate {
    node: PathBuf,
    entrypoint: PathBuf,
}

fn installation_candidates() -> Vec<InstallationCandidate> {
    let home = crate::app_paths::home_dir().ok();
    #[cfg(windows)]
    let windows = WindowsRoots {
        app_data: std::env::var_os("APPDATA").map(PathBuf::from),
        program_files: std::env::var_os("ProgramFiles").map(PathBuf::from),
    };
    #[cfg(not(windows))]
    let windows = WindowsRoots::default();
    installation_candidates_in(home.as_deref(), &windows)
}

#[derive(Default)]
struct WindowsRoots {
    app_data: Option<PathBuf>,
    program_files: Option<PathBuf>,
}

/// Every place `npm i -g wrangler` lands for the common ways Node.js is installed:
/// a system or Homebrew Node.js, the version managers (mise, nvm, fnm, asdf, Volta),
/// a user `prefix=` in `~/.npmrc`, and the Windows installer's `%APPDATA%\npm`.
fn installation_candidates_in(
    home: Option<&Path>,
    windows: &WindowsRoots,
) -> Vec<InstallationCandidate> {
    let mut node_bins: Vec<PathBuf> = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        .into_iter()
        .map(PathBuf::from)
        .collect();
    if let Some(home) = home {
        for (root, suffix) in [
            (home.join(".local/share/mise/installs/node"), "bin"),
            (home.join(".nvm/versions/node"), "bin"),
            (
                home.join(".local/share/fnm/node-versions"),
                "installation/bin",
            ),
            (
                home.join("Library/Application Support/fnm/node-versions"),
                "installation/bin",
            ),
            (home.join(".asdf/installs/nodejs"), "bin"),
            (home.join(".volta/tools/image/node"), "bin"),
        ] {
            node_bins.extend(
                newest_first(&root)
                    .into_iter()
                    .map(|version| version.join(suffix)),
            );
        }
    }

    let mut candidates = Vec::new();
    let mut push = |node: PathBuf, package_root: PathBuf| {
        let candidate = InstallationCandidate {
            node,
            entrypoint: package_root.join("wrangler/wrangler-dist/cli.js"),
        };
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    };
    // A user-level npm prefix wins, paired with every Node.js that could have used it.
    if let Some(prefix) = home.and_then(npmrc_prefix) {
        for bin in &node_bins {
            push(bin.join("node"), prefix.join("lib/node_modules"));
        }
    }
    // Otherwise npm installs globally beside the Node.js that runs it.
    for bin in &node_bins {
        if let Some(prefix) = bin.parent() {
            push(bin.join("node"), prefix.join("lib/node_modules"));
        }
    }
    // Volta keeps global packages apart from its Node.js images.
    if let Some(home) = home {
        let package = home.join(".volta/tools/image/packages/wrangler/lib/node_modules");
        for bin in &node_bins {
            push(bin.join("node"), package.clone());
        }
    }
    if let Some(program_files) = &windows.program_files {
        let node_dir = program_files.join("nodejs");
        if let Some(app_data) = &windows.app_data {
            push(node_dir.join("node.exe"), app_data.join("npm/node_modules"));
        }
        // nvm-windows points the global prefix at its Node.js symlink directory.
        push(node_dir.join("node.exe"), node_dir.join("node_modules"));
    }
    candidates
}

/// Version directories under a version manager root, newest first.
fn newest_first(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut versions: Vec<(Option<semver::Version>, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .map(|path| {
            let version = path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| semver::Version::parse(name.trim_start_matches('v')).ok());
            (version, path)
        })
        .collect();
    versions.sort_by(|left, right| right.0.cmp(&left.0));
    versions.into_iter().map(|(_, path)| path).collect()
}

/// The `prefix=` an npm user configured in `~/.npmrc`, when it is an absolute path.
fn npmrc_prefix(home: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(home.join(".npmrc")).ok()?;
    text.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        if key.trim() != "prefix" {
            return None;
        }
        let value = value.trim().trim_matches('"');
        let path = match value.strip_prefix("~/") {
            Some(rest) => home.join(rest),
            None => PathBuf::from(value),
        };
        path.is_absolute().then_some(path)
    })
}

fn safe_path() -> &'static str {
    if cfg!(windows) {
        r"C:\Windows\System32;C:\Windows"
    } else {
        "/usr/bin:/bin:/usr/sbin:/sbin"
    }
}
