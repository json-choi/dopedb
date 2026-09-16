//! System OpenSSH tunnel transport.
//!
//! DopeDB owns only the forwarding process and its lifetime. Identity, keys,
//! passphrases, agents, ProxyJump, and host-key policy remain in the user's
//! OpenSSH configuration. A profile therefore stores one non-secret Host alias
//! and never accepts key paths or SSH credentials.

use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{sleep, Instant};

use crate::error::{AppError, AppResult, ConnectionFailureCode};
use crate::model::{ConnectionProfile, Engine};

pub(crate) const SSH_ALIAS_PARAMETER: &str = "dopedb.sshAlias";

const SSH_START_TIMEOUT: Duration = Duration::from_secs(10);
const SSH_POLL_INTERVAL: Duration = Duration::from_millis(40);
const SSH_ERROR_LIMIT: usize = 4_096;
const SSH_ALIAS_LIMIT: usize = 255;

pub(crate) struct SshTunnel {
    child: Child,
    stderr_task: JoinHandle<()>,
}

impl SshTunnel {
    pub(crate) fn is_running(&mut self) -> bool {
        self.child.try_wait().is_ok_and(|status| status.is_none())
    }

    pub(crate) async fn close(mut self) {
        let _ = self.child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await;
        self.stderr_task.abort();
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        self.stderr_task.abort();
    }
}

pub(crate) struct OpenedTransport {
    pub(crate) profile: ConnectionProfile,
    pub(crate) tunnel: Option<SshTunnel>,
}

fn alias(profile: &ConnectionProfile) -> Option<&str> {
    profile
        .extra_params
        .get(SSH_ALIAS_PARAMETER)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(crate) fn validate_profile(profile: &ConnectionProfile) -> AppResult<()> {
    let Some(alias) = alias(profile) else {
        return Ok(());
    };
    if matches!(profile.engine, Engine::Sqlite | Engine::Bigquery) {
        return Err(AppError::ConnectionFailure(
            ConnectionFailureCode::SshConfiguration,
        ));
    }
    if profile.engine == Engine::Mongodb
        && profile
            .extra_params
            .get("srv")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("true"))
    {
        return Err(AppError::ConnectionFailure(
            ConnectionFailureCode::SshConfiguration,
        ));
    }
    if profile.host.contains(',') {
        return Err(AppError::ConnectionFailure(
            ConnectionFailureCode::SshConfiguration,
        ));
    }
    if alias.len() > SSH_ALIAS_LIMIT
        || !alias
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        || alias.starts_with('-')
    {
        return Err(AppError::ConnectionFailure(
            ConnectionFailureCode::SshConfiguration,
        ));
    }
    Ok(())
}

fn remote_forward_host(host: &str) -> String {
    let host = host.trim();
    if host.contains(':') && !(host.starts_with('[') && host.ends_with(']')) {
        format!("[{host}]")
    } else {
        host.to_owned()
    }
}

pub(crate) fn classify_ssh_failure(bytes: &[u8]) -> ConnectionFailureCode {
    // OpenSSH has no structured error protocol. Match known diagnostic classes,
    // discard their text, and treat unfamiliar/localized output as unknown.
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    if text.contains("host key verification failed")
        || text.contains("remote host identification has changed")
    {
        ConnectionFailureCode::SshHostKey
    } else if text.contains("permission denied") || text.contains("authentication failed") {
        ConnectionFailureCode::SshAuthentication
    } else if text.contains("bad configuration option")
        || text.contains("bad owner or permissions")
        || text.contains("no argument after keyword")
        || text.contains("terminating, ") && text.contains("bad configuration")
    {
        ConnectionFailureCode::SshConfiguration
    } else if text.contains("connection timed out") || text.contains("operation timed out") {
        ConnectionFailureCode::SshTimeout
    } else if text.contains("could not resolve hostname")
        || text.contains("connection refused")
        || text.contains("network is unreachable")
        || text.contains("no route to host")
        || text.contains("forwarding failed")
        || text.contains("cannot listen to port")
        || text.contains("administratively prohibited")
    {
        ConnectionFailureCode::SshForwarding
    } else {
        ConnectionFailureCode::SshUnknown
    }
}

async fn fail_start(
    child: &mut Child,
    stderr_task: &JoinHandle<()>,
    stderr: &Arc<Mutex<Vec<u8>>>,
    fallback: ConnectionFailureCode,
) -> AppError {
    let _ = child.start_kill();
    let _ = child.wait().await;
    for _ in 0..20 {
        if stderr_task.is_finished() {
            break;
        }
        sleep(Duration::from_millis(5)).await;
    }
    let classified = classify_ssh_failure(&stderr.lock().await);
    stderr_task.abort();
    AppError::ConnectionFailure(if classified == ConnectionFailureCode::SshUnknown {
        fallback
    } else {
        classified
    })
}

/// Start one local forward for the target profile and return a driver projection
/// that points at it. Provider identity is frozen before replacing the network
/// endpoint so driver selection and provider tuning still use the actual target.
pub(crate) async fn open(
    alias_profile: &ConnectionProfile,
    target_profile: &ConnectionProfile,
) -> AppResult<OpenedTransport> {
    open_with_program(alias_profile, target_profile, Path::new("ssh")).await
}

async fn open_with_program(
    alias_profile: &ConnectionProfile,
    target_profile: &ConnectionProfile,
    ssh_program: &Path,
) -> AppResult<OpenedTransport> {
    validate_profile(alias_profile)?;
    let Some(alias) = alias(alias_profile) else {
        return Ok(OpenedTransport {
            profile: target_profile.clone(),
            tunnel: None,
        });
    };

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|_| AppError::ConnectionFailure(ConnectionFailureCode::SshForwarding))?;
    let local_port = listener
        .local_addr()
        .map_err(|_| AppError::ConnectionFailure(ConnectionFailureCode::SshForwarding))?
        .port();
    drop(listener);

    let forward = format!(
        "127.0.0.1:{local_port}:{}:{}",
        remote_forward_host(&target_profile.host),
        target_profile.port
    );
    let mut command = Command::new(ssh_program);
    command
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .arg("-N")
        .arg("-T")
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-o")
        .arg("ServerAliveInterval=15")
        .arg("-o")
        .arg("ServerAliveCountMax=3")
        .arg("-L")
        .arg(forward)
        .arg("--")
        .arg(alias);
    let mut child = command.spawn().map_err(|error| {
        AppError::ConnectionFailure(if error.kind() == std::io::ErrorKind::NotFound {
            ConnectionFailureCode::SshClientMissing
        } else {
            ConnectionFailureCode::SshUnknown
        })
    })?;
    let stderr = Arc::new(Mutex::new(Vec::new()));
    let stderr_capture = Arc::clone(&stderr);
    let mut stderr_reader = child
        .stderr
        .take()
        .expect("system ssh stderr was configured as piped");
    let stderr_task = tokio::spawn(async move {
        let mut buffer = [0_u8; 512];
        loop {
            let read = match stderr_reader.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            let mut captured = stderr_capture.lock().await;
            let remaining = SSH_ERROR_LIMIT.saturating_sub(captured.len());
            if remaining > 0 {
                captured.extend_from_slice(&buffer[..read.min(remaining)]);
            }
        }
    });

    let deadline = Instant::now() + SSH_START_TIMEOUT;
    loop {
        if child
            .try_wait()
            .map_err(|_| AppError::ConnectionFailure(ConnectionFailureCode::SshUnknown))?
            .is_some()
        {
            return Err(fail_start(
                &mut child,
                &stderr_task,
                &stderr,
                ConnectionFailureCode::SshUnknown,
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
                ConnectionFailureCode::SshTimeout,
            )
            .await);
        }
        sleep(SSH_POLL_INTERVAL).await;
    }

    let mut profile = target_profile.clone();
    profile.provider = crate::connection::providers::resolve(target_profile);
    profile.host = "127.0.0.1".into();
    profile.port = local_port;
    profile.extra_params.remove(SSH_ALIAS_PARAMETER);
    Ok(OpenedTransport {
        profile,
        tunnel: Some(SshTunnel { child, stderr_task }),
    })
}
