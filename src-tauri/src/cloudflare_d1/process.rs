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
    node_candidates().iter().any(|path| regular_file(path))
        && wrangler_entrypoint_candidates()
            .iter()
            .any(|path| valid_wrangler_entrypoint(path) && regular_file(path))
}

pub(super) async fn discover_runtime() -> AppResult<WranglerRuntime> {
    let node = discover(&node_candidates(), |path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| matches!(name, "node" | "node.exe"))
    })
    .await
    .ok_or_else(|| {
        AppError::Config("Node.js is required to run the official Wrangler CLI".into())
    })?;
    let entrypoint = discover(&wrangler_entrypoint_candidates(), valid_wrangler_entrypoint)
        .await
        .ok_or_else(|| {
            AppError::Config(
                "Cloudflare Wrangler is not installed; install Wrangler 4 or later and retry"
                    .into(),
            )
        })?;
    Ok(WranglerRuntime { node, entrypoint })
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

async fn discover(
    candidates: &[PathBuf],
    validate: impl Fn(&Path) -> bool,
) -> Option<ExecutableIdentity> {
    for candidate in candidates {
        let Ok(path) = tokio::fs::canonicalize(candidate).await else {
            continue;
        };
        if !validate(&path) {
            continue;
        }
        if let Ok((sha256, length)) = hash_regular_file(&path).await {
            return Some(ExecutableIdentity {
                path,
                sha256,
                length,
            });
        }
    }
    None
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

fn node_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ];
    if let Ok(home) = crate::app_paths::home_dir() {
        candidates.push(home.join(".volta/bin/node"));
        candidates.push(home.join(".local/bin/node"));
    }
    #[cfg(windows)]
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("nodejs/node.exe"));
    }
    candidates
}

fn wrangler_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/wrangler"),
        PathBuf::from("/usr/local/bin/wrangler"),
        PathBuf::from("/usr/bin/wrangler"),
    ];
    if let Ok(home) = crate::app_paths::home_dir() {
        candidates.push(home.join(".volta/bin/wrangler"));
        candidates.push(home.join(".local/bin/wrangler"));
    }
    #[cfg(windows)]
    if let Some(app_data) = std::env::var_os("APPDATA") {
        candidates.push(PathBuf::from(app_data).join("npm/node_modules/wrangler/bin/wrangler.js"));
    }
    candidates
}

fn wrangler_entrypoint_candidates() -> Vec<PathBuf> {
    wrangler_candidates()
        .into_iter()
        .filter_map(|candidate| candidate.canonicalize().ok())
        .filter_map(|wrapper| {
            wrapper
                .parent()?
                .parent()
                .map(|root| root.join("wrangler-dist/cli.js"))
        })
        .collect()
}

fn safe_path() -> &'static str {
    if cfg!(windows) {
        r"C:\Windows\System32;C:\Windows"
    } else {
        "/usr/bin:/bin:/usr/sbin:/sbin"
    }
}
