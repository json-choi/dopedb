//! System OpenSSH tunnel transport.
//!
//! DopeDB owns only the forwarding process and its lifetime. Identity, keys,
//! passphrases, agents, ProxyJump, and host-key policy remain in the user's
//! OpenSSH configuration. A profile therefore stores one non-secret Host alias
//! and never accepts key paths or SSH credentials.
//!
//! OS `ssh` output is untrusted input. It may quote a passphrase prompt, a private
//! key path, a remote banner, or anything else the far side chose to print, and a
//! control-character filter is not redaction. This module is the only place that
//! reads it: it matches a closed allowlist of well-known OpenSSH phrases, returns
//! one [`SshTunnelFailure`] cause, and drops the text. Nothing else — wire payload,
//! screen, audit trail, or log — ever sees it.

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

use crate::error::{AppError, AppResult};
use crate::kernel::connection_failure::SshTunnelFailure;
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
        return Err(AppError::Config(
            "SQLite and BigQuery connections cannot use an SSH tunnel".into(),
        ));
    }
    if profile.engine == Engine::Mongodb
        && profile
            .extra_params
            .get("srv")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("true"))
    {
        return Err(AppError::Config(
            "MongoDB SRV discovery cannot use a single-host SSH tunnel".into(),
        ));
    }
    if profile.host.contains(',') {
        return Err(AppError::Config(
            "multi-host connections cannot use a single-host SSH tunnel".into(),
        ));
    }
    if alias.len() > SSH_ALIAS_LIMIT
        || !alias
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        || alias.starts_with('-')
    {
        return Err(AppError::Config(format!(
            "{SSH_ALIAS_PARAMETER} must be a 1-{SSH_ALIAS_LIMIT} character OpenSSH Host alias using letters, numbers, dot, underscore, or hyphen"
        )));
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

/// Well-known OpenSSH phrases, lowercase and ASCII. A marker is added only when the
/// cause it implies is unambiguous; everything else stays `Unclassified` so a remote
/// banner cannot steer the recovery advice DopeDB shows.
const SSH_HOST_KEY_MARKERS: [&str; 3] = [
    "host key verification failed",
    "remote host identification has changed",
    "no matching host key type",
];
const SSH_AUTHENTICATION_MARKERS: [&str; 6] = [
    "permission denied",
    "too many authentication failures",
    "no supported authentication methods",
    "incorrect passphrase",
    "bad passphrase",
    "unprotected private key file",
];
const SSH_HOST_MARKERS: [&str; 7] = [
    "could not resolve hostname",
    "name or service not known",
    "nodename nor servname",
    "no address associated with hostname",
    "connection refused",
    "no route to host",
    "network is unreachable",
];
const SSH_TIMEOUT_MARKERS: [&str; 2] = ["connection timed out", "operation timed out"];
const SSH_LAUNCH_MARKERS: [&str; 3] = [
    "bad configuration option",
    "bad local forwarding specification",
    "address already in use",
];

/// Reduce untrusted OS `ssh` output to one stable cause. The returned value is the
/// only thing derived from that output; the text itself is discarded here.
fn classify_ssh_output(output: &str) -> SshTunnelFailure {
    let text = output.to_ascii_lowercase();
    let matches = |markers: &[&str]| markers.iter().any(|marker| text.contains(marker));
    if matches(&SSH_HOST_KEY_MARKERS) {
        SshTunnelFailure::HostKey
    } else if matches(&SSH_AUTHENTICATION_MARKERS) {
        SshTunnelFailure::Authentication
    } else if matches(&SSH_TIMEOUT_MARKERS) {
        SshTunnelFailure::Timeout
    } else if matches(&SSH_HOST_MARKERS) {
        SshTunnelFailure::Host
    } else if matches(&SSH_LAUNCH_MARKERS) {
        SshTunnelFailure::Launch
    } else {
        SshTunnelFailure::Unclassified
    }
}

async fn captured_cause(
    stderr: &Arc<Mutex<Vec<u8>>>,
    fallback: SshTunnelFailure,
) -> SshTunnelFailure {
    let captured = stderr.lock().await;
    let text = String::from_utf8_lossy(&captured);
    if text.trim().is_empty() {
        fallback
    } else {
        classify_ssh_output(&text)
    }
}

async fn fail_start(
    child: &mut Child,
    stderr_task: &JoinHandle<()>,
    stderr: &Arc<Mutex<Vec<u8>>>,
    fallback: SshTunnelFailure,
) -> AppError {
    let _ = child.start_kill();
    let _ = child.wait().await;
    for _ in 0..20 {
        if stderr_task.is_finished() {
            break;
        }
        sleep(Duration::from_millis(5)).await;
    }
    AppError::SshTunnel(captured_cause(stderr, fallback).await)
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
        .map_err(|_| AppError::SshTunnel(SshTunnelFailure::Launch))?;
    let local_port = listener.local_addr()?.port();
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
    let mut child = command
        .spawn()
        .map_err(|_| AppError::SshTunnel(SshTunnelFailure::Launch))?;
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
            .map_err(|_| AppError::SshTunnel(SshTunnelFailure::Unclassified))?
            .is_some()
        {
            return Err(fail_start(
                &mut child,
                &stderr_task,
                &stderr,
                SshTunnelFailure::Unclassified,
            )
            .await);
        }
        if TcpStream::connect(("127.0.0.1", local_port)).await.is_ok() {
            break;
        }
        if Instant::now() >= deadline {
            return Err(
                fail_start(&mut child, &stderr_task, &stderr, SshTunnelFailure::Timeout).await,
            );
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

#[cfg(test)]
pub(crate) fn assert_ssh_failure_classification_contract() {
    use crate::kernel::connection_failure::{
        classify_connection_failure, ConnectionFailureCode, ConnectionFailureField,
    };

    assert_eq!(
        classify_ssh_output("Host key verification failed."),
        SshTunnelFailure::HostKey,
    );
    assert_eq!(
        classify_ssh_output("dopedb@10.0.0.4: Permission denied (publickey,password)."),
        SshTunnelFailure::Authentication,
    );
    assert_eq!(
        classify_ssh_output(
            "ssh: Could not resolve hostname prod-jump: nodename nor servname provided"
        ),
        SshTunnelFailure::Host,
    );
    assert_eq!(
        classify_ssh_output("ssh: connect to host 10.0.0.4 port 22: Operation timed out"),
        SshTunnelFailure::Timeout,
    );
    assert_eq!(
        classify_ssh_output("command-line: line 0: Bad configuration option: foo"),
        SshTunnelFailure::Launch,
    );
    // An unrecognized remote banner must not be steered into a specific recovery.
    assert_eq!(
        classify_ssh_output("Welcome to the corporate gateway. Ticket required."),
        SshTunnelFailure::Unclassified,
    );

    // Whatever the far side prints — fake secrets, credential URLs, private paths,
    // control characters, or a very long banner — must not reach the wire payload.
    let hostile = format!(
        "Permission denied\npassword=hunter2\ntoken=ghp_000000000000\n\
         postgres://admin:hunter2@10.0.0.4:5432/prod\n/Users/someone/.ssh/id_ed25519\n\u{7}\u{1b}[31m{}",
        "A".repeat(8_192),
    );
    let cause = classify_ssh_output(&hostile);
    assert_eq!(cause, SshTunnelFailure::Authentication);
    let failure = classify_connection_failure(&AppError::SshTunnel(cause));
    assert_eq!(failure.code, ConnectionFailureCode::SshAuthentication);
    assert_eq!(failure.field, Some(ConnectionFailureField::SshAlias));
    let wire = serde_json::to_string(&AppError::SshTunnel(cause)).unwrap();
    for leaked in [
        "hunter2",
        "ghp_000000000000",
        "postgres://",
        "id_ed25519",
        "AAAA",
    ] {
        assert!(!wire.contains(leaked), "ssh output leaked into {wire}");
    }
    assert!(wire.contains("\"kind\":\"sshTunnel\""));
    assert!(wire.contains("\"code\":\"sshAuthentication\""));
}
