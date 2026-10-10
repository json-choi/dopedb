//! Bundled Cloud SQL Auth Proxy transport.
//!
//! The proxy is pinned into the signed application bundle. Each database pool
//! gets one loopback-only proxy process and one short-lived IAM access token;
//! neither a mutable PATH binary nor an authorized-network firewall exception is
//! part of the connection path.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{sleep, Instant};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::model::{ConnectionProfile, Engine};

use super::GcpCloudSqlNetworkMode;

const START_TIMEOUT: Duration = Duration::from_secs(10);
const POLL_INTERVAL: Duration = Duration::from_millis(40);
const ERROR_LIMIT: usize = 4_096;

/// Secret-bearing connector material. It deliberately implements neither
/// `Debug`, `Clone`, nor serde traits.
pub(crate) struct CloudSqlProxyConfig {
    pub(crate) instance_connection_name: String,
    pub(crate) access_token: Zeroizing<String>,
    pub(crate) network_mode: GcpCloudSqlNetworkMode,
}

pub(crate) struct CloudSqlProxy {
    child: Child,
    stderr_task: JoinHandle<()>,
    stderr: Arc<Mutex<Vec<u8>>>,
}

impl CloudSqlProxy {
    pub(crate) fn is_running(&mut self) -> bool {
        self.child.try_wait().is_ok_and(|status| status.is_none())
    }

    pub(crate) async fn close(mut self) {
        let _ = self.child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await;
        self.stderr_task.abort();
    }

    pub(crate) async fn failure_detail(&self) -> String {
        clean_error(&self.stderr.lock().await)
    }
}

impl Drop for CloudSqlProxy {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        self.stderr_task.abort();
    }
}

pub(crate) struct OpenedCloudSqlProxy {
    pub(crate) profile: ConnectionProfile,
    pub(crate) proxy: CloudSqlProxy,
}

fn valid_instance_connection_name(value: &str) -> bool {
    if value.len() > 300 || value.chars().any(char::is_whitespace) {
        return false;
    }
    let mut segments = value.split(':');
    let (Some(project), Some(region), Some(instance), None) = (
        segments.next(),
        segments.next(),
        segments.next(),
        segments.next(),
    ) else {
        return false;
    };
    !project.is_empty()
        && project.len() <= 128
        && project
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b".-".contains(&byte))
        && !region.is_empty()
        && region.len() <= 100
        && region
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !instance.is_empty()
        && instance.len() <= 99
        && instance
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}

fn bundled_proxy_binary() -> AppResult<PathBuf> {
    let executable = std::env::current_exe()?;
    let executable_dir = executable
        .parent()
        .ok_or_else(|| AppError::Config("the app executable has no parent directory".into()))?;
    let binary_name = if cfg!(windows) {
        "cloud-sql-proxy.exe"
    } else {
        "cloud-sql-proxy"
    };
    let mut candidates = vec![
        executable_dir.join(binary_name),
        executable_dir.join("resources").join(binary_name),
    ];
    if executable_dir
        .file_name()
        .is_some_and(|component| component == "MacOS")
    {
        if let Some(contents) = executable_dir.parent() {
            candidates.push(contents.join("Resources").join(binary_name));
        }
    }
    if let Some(triple) = host_target_triple() {
        let extension = if cfg!(windows) { ".exe" } else { "" };
        candidates.push(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!("cloud-sql-proxy-{triple}{extension}")),
        );
    }
    candidates
        .into_iter()
        .find(|path| {
            fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file())
        })
        .ok_or_else(|| AppError::NotFound("the bundled Cloud SQL Auth Proxy".into()))
}

fn host_target_triple() -> Option<&'static str> {
    match (std::env::consts::ARCH, std::env::consts::OS) {
        ("aarch64", "macos") => Some("aarch64-apple-darwin"),
        ("x86_64", "macos") => Some("x86_64-apple-darwin"),
        ("x86_64", "windows") => Some("x86_64-pc-windows-msvc"),
        ("aarch64", "linux") => Some("aarch64-unknown-linux-gnu"),
        ("x86_64", "linux") => Some("x86_64-unknown-linux-gnu"),
        _ => None,
    }
}

fn clean_error(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .filter(|character| *character == '\n' || *character == '\t' || !character.is_control())
        .collect::<String>()
        .trim()
        .to_owned()
}

async fn fail_start(
    child: &mut Child,
    stderr_task: &JoinHandle<()>,
    stderr: &Arc<Mutex<Vec<u8>>>,
    reason: &str,
) -> AppError {
    let _ = child.start_kill();
    let _ = child.wait().await;
    for _ in 0..20 {
        if stderr_task.is_finished() {
            break;
        }
        sleep(Duration::from_millis(5)).await;
    }
    // Proxy stderr can name instances, accounts, or network paths. It stays in the
    // local diagnostic log; the returned error carries only the fixed reason.
    let detail = clean_error(&stderr.lock().await);
    if !detail.is_empty() {
        tracing::warn!(%detail, reason, "Cloud SQL secure connector could not start");
    }
    AppError::Network(format!(
        "Cloud SQL secure connector could not start: {reason}"
    ))
}

pub(crate) async fn open(
    target_profile: &ConnectionProfile,
    config: CloudSqlProxyConfig,
) -> AppResult<OpenedCloudSqlProxy> {
    if !matches!(target_profile.engine, Engine::Postgres | Engine::Mysql)
        || !valid_instance_connection_name(&config.instance_connection_name)
        || config.access_token.is_empty()
        || config.access_token.len() > 64 * 1024
        || config.access_token.chars().any(char::is_whitespace)
    {
        return Err(AppError::Network(
            "Cloud SQL secure connector returned invalid material".into(),
        ));
    }
    let program = bundled_proxy_binary()?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|error| {
        AppError::Network(format!(
            "could not reserve a local port for Cloud SQL secure access: {error}"
        ))
    })?;
    let local_port = listener.local_addr()?.port();
    drop(listener);

    let mut command = Command::new(program);
    command
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .env_clear()
        .env("CSQL_PROXY_TOKEN", config.access_token.as_str())
        .arg("--address")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(local_port.to_string())
        .arg("--max-connections")
        .arg("32")
        .arg("--lazy-refresh")
        .arg("--quiet");
    match config.network_mode {
        GcpCloudSqlNetworkMode::Public => {}
        GcpCloudSqlNetworkMode::PrivateServicesAccess => {
            command.arg("--private-ip");
        }
        GcpCloudSqlNetworkMode::PrivateServiceConnect => {
            command.arg("--psc");
        }
    }
    command.arg("--").arg(&config.instance_connection_name);
    let mut child = command.spawn().map_err(|error| {
        AppError::Network(format!(
            "could not start the bundled Cloud SQL secure connector: {error}"
        ))
    })?;
    drop(config);

    let stderr = Arc::new(Mutex::new(Vec::new()));
    let stderr_capture = Arc::clone(&stderr);
    let mut stderr_reader = child
        .stderr
        .take()
        .expect("Cloud SQL proxy stderr was configured as piped");
    let stderr_task = tokio::spawn(async move {
        let mut buffer = [0_u8; 512];
        loop {
            let read = match stderr_reader.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            let mut captured = stderr_capture.lock().await;
            let remaining = ERROR_LIMIT.saturating_sub(captured.len());
            if remaining > 0 {
                captured.extend_from_slice(&buffer[..read.min(remaining)]);
            }
        }
    });

    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            AppError::Network(format!(
                "could not inspect the Cloud SQL secure connector: {error}"
            ))
        })? {
            return Err(fail_start(
                &mut child,
                &stderr_task,
                &stderr,
                &format!("process exited with {status}"),
            )
            .await);
        }
        if TcpStream::connect(("127.0.0.1", local_port)).await.is_ok() {
            break;
        }
        if Instant::now() >= deadline {
            return Err(fail_start(
                &mut child,
                &stderr_task,
                &stderr,
                "the loopback listener did not become ready within 10 seconds",
            )
            .await);
        }
        sleep(POLL_INTERVAL).await;
    }

    let mut profile = target_profile.clone();
    profile.host = "127.0.0.1".into();
    profile.port = local_port;
    // TLS and instance identity are verified inside the official connector.
    profile.sslmode = "disable".into();
    profile.extra_params.remove("sslrootcert_pem");
    Ok(OpenedCloudSqlProxy {
        profile,
        proxy: CloudSqlProxy {
            child,
            stderr_task,
            stderr,
        },
    })
}
