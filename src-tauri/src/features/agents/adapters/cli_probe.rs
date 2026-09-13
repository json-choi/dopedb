//! Process adapter for bounded, credential-free Agent CLI status probes.

use std::ffi::OsStr;
use std::path::Path;
use std::process::Output;
use std::time::Duration;

use crate::cli_environment::{executable_search_path, find_executable};

use super::super::domain::{AgentCliInfo, AgentProvider};
use super::super::ports::AgentCliProbePort;

const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const SAFE_PROBE_ENVIRONMENT: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "TZ",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "USERPROFILE",
    "USERNAME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "APPDATA",
    "TEMP",
    "TMP",
    "SystemRoot",
    "ComSpec",
];

const NODE_MISSING_MARKERS: &[&str] = &[
    "env: node: No such file or directory",
    "env: 'node': No such file or directory",
    "can't execute 'node'",
    "node: command not found",
    "'node' is not recognized",
];

/// Runs only public CLI status subcommands, with no credential reads or environment copies.
#[derive(Clone, Copy, Default)]
pub(crate) struct ProcessAgentCliProbe;

impl AgentCliProbePort for ProcessAgentCliProbe {
    async fn detect(&self) -> Vec<AgentCliInfo> {
        let (claude, codex) = tokio::join!(detect_claude(), detect_codex());
        vec![claude, codex]
    }
}

async fn detect_claude() -> AgentCliInfo {
    let Some(binary) = find_executable("claude") else {
        return unavailable(
            AgentProvider::Claude,
            "Claude Code",
            "Install Claude Code to use its Terminal profile.",
        );
    };
    let installed = match run_probe(&binary, &["--version"]).await {
        Ok(output) if output.contains("Claude Code") => true,
        Ok(_) => {
            return probe_failed(
                AgentProvider::Claude,
                "Claude Code",
                "Version probe returned an unexpected response.",
            );
        }
        Err(error) => {
            return probe_failed(
                AgentProvider::Claude,
                "Claude Code",
                version_probe_error(&error),
            );
        }
    };
    let (authenticated, auth_method) = if installed {
        run_probe(&binary, &["auth", "status"])
            .await
            .ok()
            .and_then(|output| serde_json::from_str::<serde_json::Value>(&output).ok())
            .filter(|value| {
                value
                    .get("loggedIn")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false)
            })
            .map(|value| {
                (
                    true,
                    value
                        .get("authMethod")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned),
                )
            })
            .unwrap_or((false, None))
    } else {
        (false, None)
    };
    AgentCliInfo {
        id: AgentProvider::Claude,
        name: "Claude Code".into(),
        installed,
        authenticated,
        auth_method,
        detection_error: None,
        note: "Uses your Claude subscription login in a connection-pinned Terminal.".into(),
    }
}

async fn detect_codex() -> AgentCliInfo {
    let Some(binary) = find_executable("codex") else {
        return unavailable(
            AgentProvider::Codex,
            "Codex CLI",
            "Install Codex CLI to use its Terminal profile.",
        );
    };
    let installed = match run_probe(&binary, &["--version"]).await {
        Ok(output) if output.contains("codex-cli") => true,
        Ok(_) => {
            return probe_failed(
                AgentProvider::Codex,
                "Codex CLI",
                "Version probe returned an unexpected response.",
            );
        }
        Err(error) => {
            return probe_failed(
                AgentProvider::Codex,
                "Codex CLI",
                version_probe_error(&error),
            );
        }
    };
    let authenticated = installed && run_probe(&binary, &["login", "status"]).await.is_ok();
    AgentCliInfo {
        id: AgentProvider::Codex,
        name: "Codex CLI".into(),
        installed,
        authenticated,
        auth_method: None,
        detection_error: None,
        note: "Uses your ChatGPT subscription login in a connection-pinned Terminal.".into(),
    }
}

fn unavailable(id: AgentProvider, name: &str, note: &str) -> AgentCliInfo {
    AgentCliInfo {
        id,
        name: name.into(),
        installed: false,
        authenticated: false,
        auth_method: None,
        detection_error: None,
        note: note.into(),
    }
}

fn probe_failed(id: AgentProvider, name: &str, error: impl Into<String>) -> AgentCliInfo {
    AgentCliInfo {
        id,
        name: name.into(),
        installed: false,
        authenticated: false,
        auth_method: None,
        detection_error: Some(error.into()),
        note: "DopeDB found this CLI but could not complete its credential-free status probe."
            .into(),
    }
}

/// npm-style shims start with `#!/usr/bin/env node`, so a missing runtime
/// fails inside `env` before the CLI runs. Name that cause instead of leaving
/// the screen with a bare exit status 127. The screen prefixes the provider
/// name itself.
fn version_probe_error(error: &str) -> String {
    if NODE_MISSING_MARKERS
        .iter()
        .any(|marker| error.contains(marker))
    {
        format!(
            "installed as a Node.js script, but no `node` runtime is on DopeDB's search \
             path. Install Node.js or link its bin directory, then check again. ({error})"
        )
    } else {
        format!("Version probe failed: {error}")
    }
}

async fn run_probe(binary: &Path, args: &[&str]) -> Result<String, String> {
    run_probe_with_timeout(binary, args, PROBE_TIMEOUT).await
}

async fn run_probe_with_timeout(
    binary: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut command = quiet_command(binary);
    command.args(args);
    apply_probe_environment(&mut command);
    let mut command = tokio::process::Command::from(command);
    command.kill_on_drop(true);
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| format!("command timed out after {} ms", timeout.as_millis()))?
        .map_err(|error| error.to_string())?;
    decode_output(output)
}

fn apply_probe_environment(command: &mut std::process::Command) {
    command.env_clear();
    for (key, value) in std::env::vars_os() {
        if probe_environment_key_allowed(&key, cfg!(windows)) {
            command.env(key, value);
        }
    }
    command.env("PATH", executable_search_path(None));
}

fn probe_environment_key_allowed(key: &OsStr, case_insensitive: bool) -> bool {
    let key = key.to_string_lossy();
    let matches = |expected: &str| {
        if case_insensitive {
            key.eq_ignore_ascii_case(expected)
        } else {
            key == expected
        }
    };
    let locale_prefix = key.get(..3).is_some_and(|prefix| {
        if case_insensitive {
            prefix.eq_ignore_ascii_case("LC_")
        } else {
            prefix == "LC_"
        }
    });
    SAFE_PROBE_ENVIRONMENT
        .iter()
        .any(|expected| matches(expected))
        || locale_prefix
}

fn decode_output(output: Output) -> Result<String, String> {
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned());
    }
    // A version probe writes its diagnosis to stderr, so an exit status alone
    // leaves `detection_error` unable to say what actually broke. Windows
    // consoles emit that text in the OEM code page, so forward it only when it
    // is valid UTF-8 rather than showing a lossy decode as the reason.
    let detail = String::from_utf8(output.stderr)
        .map(|text| text.trim().to_owned())
        .unwrap_or_default();
    Err(if detail.is_empty() {
        format!("command failed with status {}", output.status)
    } else {
        format!("command failed with status {}: {detail}", output.status)
    })
}

fn quiet_command(program: impl AsRef<OsStr>) -> std::process::Command {
    let program = program.as_ref();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let is_script = Path::new(program)
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
            });
        if is_script {
            let shell = windows_environment_value("ComSpec")
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "cmd.exe".into());
            let mut command = std::process::Command::new(shell);
            command
                .creation_flags(CREATE_NO_WINDOW)
                .args(["/D", "/S", "/C"])
                .arg(program);
            return command;
        }

        let mut command = std::process::Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(program)
    }
}

#[cfg(windows)]
fn windows_environment_value(name: &str) -> Option<std::ffi::OsString> {
    std::env::vars_os()
        .find(|(key, _)| key.to_string_lossy().eq_ignore_ascii_case(name))
        .map(|(_, value)| value)
}

#[cfg(test)]
pub(super) fn assert_agent_cli_probe_contract() {
    assert!(probe_environment_key_allowed(OsStr::new("HOME"), false));
    assert!(!probe_environment_key_allowed(OsStr::new("home"), false));
    assert!(probe_environment_key_allowed(
        OsStr::new("SYSTEMROOT"),
        true
    ));
    assert!(probe_environment_key_allowed(OsStr::new("COMSPEC"), true));
    assert!(probe_environment_key_allowed(OsStr::new("lc_all"), true));
    assert!(!probe_environment_key_allowed(
        OsStr::new("NODE_OPTIONS"),
        true
    ));
    let missing_node = version_probe_error(
        "command failed with status exit status: 127: env: node: No such file or directory",
    );
    assert!(missing_node.starts_with("installed as a Node.js script"));
    assert!(missing_node.contains("no `node` runtime is on DopeDB's search path"));
    assert!(missing_node.ends_with("env: node: No such file or directory)"));
    assert!(
        version_probe_error("env: 'node': No such file or directory")
            .starts_with("installed as a Node.js script")
    );
    assert_eq!(
        version_probe_error("command timed out after 4000 ms"),
        "Version probe failed: command timed out after 4000 ms"
    );
}
