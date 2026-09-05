//! Closed command policy for app-only official ACP adapter launchers.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use dopedb_protocol::{AgentSessionRegisterArguments, SessionAuthentication};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_RUNTIME_BYTES: u64 = 130 * 1024 * 1024;
const MAX_ADAPTER_ENTRYPOINT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PROVIDER_CLI_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentLaunchPolicyError;

pub fn take_registration_authentication() -> Result<SessionAuthentication, AgentLaunchPolicyError> {
    let session_id = std::env::var("DOPEDB_TERMINAL_SESSION_ID")
        .ok()
        .and_then(|value| Uuid::parse_str(&value).ok())
        .ok_or(AgentLaunchPolicyError)?;
    let token = std::env::var("DOPEDB_SESSION_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
        .map(Zeroizing::new)
        .ok_or(AgentLaunchPolicyError)?;

    // Replace the visible inherited value before unsetting it. The bridge uses
    // a current-thread runtime and calls this before its first await, so no
    // worker thread can observe a partially changed process environment.
    let overwrite = Zeroizing::new("0".repeat(token.len()));
    std::env::set_var("DOPEDB_SESSION_TOKEN", overwrite.as_str());
    std::env::remove_var("DOPEDB_SESSION_TOKEN");
    Ok(SessionAuthentication::from_zeroizing_token(
        session_id, token,
    ))
}

pub fn validate_descriptor(
    registration: &AgentSessionRegisterArguments,
) -> Result<(), AgentLaunchPolicyError> {
    let paths = [
        registration.runtime_executable.as_str(),
        registration.runtime_resolved_executable.as_str(),
        registration.adapter_entrypoint.as_str(),
        registration.provider_cli_executable.as_str(),
        registration.provider_cli_resolved_executable.as_str(),
    ];
    if !registration.validate() || paths.iter().any(|path| !Path::new(path).is_absolute()) {
        return Err(AgentLaunchPolicyError);
    }
    Ok(())
}

pub fn verify_launch_files(
    registration: &AgentSessionRegisterArguments,
) -> Result<(), AgentLaunchPolicyError> {
    validate_descriptor(registration)?;
    verify_file(
        &registration.runtime_executable,
        &registration.runtime_resolved_executable,
        &registration.runtime_sha256,
        MAX_RUNTIME_BYTES,
        true,
    )?;
    verify_file(
        &registration.adapter_entrypoint,
        &registration.adapter_entrypoint,
        &registration.adapter_entrypoint_sha256,
        MAX_ADAPTER_ENTRYPOINT_BYTES,
        false,
    )?;
    verify_file(
        &registration.provider_cli_executable,
        &registration.provider_cli_resolved_executable,
        &registration.provider_cli_sha256,
        MAX_PROVIDER_CLI_BYTES,
        true,
    )
}

fn verify_file(
    invocation: &str,
    expected_resolved: &str,
    expected_sha256: &str,
    maximum_bytes: u64,
    require_executable: bool,
) -> Result<(), AgentLaunchPolicyError> {
    let invocation = Path::new(invocation);
    let path = std::fs::canonicalize(PathBuf::from(expected_resolved))
        .map_err(|_| AgentLaunchPolicyError)?;
    if std::fs::canonicalize(invocation).map_err(|_| AgentLaunchPolicyError)? != path {
        return Err(AgentLaunchPolicyError);
    }
    let metadata = path.metadata().map_err(|_| AgentLaunchPolicyError)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum_bytes {
        return Err(AgentLaunchPolicyError);
    }
    #[cfg(unix)]
    if require_executable {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(AgentLaunchPolicyError);
        }
    }
    #[cfg(not(unix))]
    let _ = require_executable;
    let mut file = std::fs::File::open(path).map_err(|_| AgentLaunchPolicyError)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|_| AgentLaunchPolicyError)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if hex::encode(hasher.finalize()) != expected_sha256 {
        return Err(AgentLaunchPolicyError);
    }
    Ok(())
}

pub fn adapter_command(
    registration: &AgentSessionRegisterArguments,
) -> Result<Command, AgentLaunchPolicyError> {
    verify_launch_files(registration)?;
    let mut command = Command::new(&registration.runtime_executable);
    // A GUI can inherit stale terminal hooks and unrelated credentials from
    // its launcher or updater. Only OS discovery and this exact session belong
    // in the official adapter; its CLI still owns login in the user's home.
    command.env_clear();
    for name in [
        "HOME",
        "USER",
        "LOGNAME",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "SystemRoot",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "PATH",
        "SHELL",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TZ",
        "TERM",
        "TERM_PROGRAM",
        "TERM_PROGRAM_VERSION",
        "SSH_AUTH_SOCK",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
        "DOPEDB_TERMINAL_SESSION_ID",
        "DOPEDB_CONNECTION_SCOPE",
        "DOPEDB_RUNTIME_FILE",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command.arg(&registration.adapter_entrypoint).env(
        registration.plugin_id.local_cli_environment(),
        &registration.provider_cli_executable,
    );
    Ok(command)
}
