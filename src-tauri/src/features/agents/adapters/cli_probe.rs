//! Bounded public CLI status probes using the provider's own authentication configuration.

use std::ffi::OsStr;
use std::path::Path;
use std::process::Output;
use std::time::Duration;

use dopedb_protocol::AcpPluginId;

use super::super::domain::{agent_error, AgentCliInfo, AgentProvider};
use super::super::ports::AgentCliProbePort;

const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
/// Stable code for a sign-in probe that did not answer in time. The status is
/// unknown, not "signed out", so the Desktop offers a re-check, not a login.
const AUTH_PROBE_TIMEOUT: &str = "auth_probe_timeout";
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

/// Runs public CLI status subcommands, never opening credential files or logging their values.
#[derive(Clone, Copy, Default)]
pub(crate) struct ProcessAgentCliProbe;

impl AgentCliProbePort for ProcessAgentCliProbe {
    async fn detect(&self, providers: Vec<AgentProvider>) -> Vec<AgentCliInfo> {
        let claude = providers.contains(&AgentProvider::Claude);
        let codex = providers.contains(&AgentProvider::Codex);
        let (claude, codex) = tokio::join!(
            async move {
                if claude {
                    Some(detect_claude().await)
                } else {
                    None
                }
            },
            async move {
                if codex {
                    Some(detect_codex().await)
                } else {
                    None
                }
            },
        );
        [claude, codex].into_iter().flatten().collect()
    }
}

async fn detect_claude() -> AgentCliInfo {
    let binary = match super::resolve_provider_cli(AgentProvider::Claude).await {
        Ok(binary) => binary,
        Err(error) => {
            return probe_failed(
                AgentProvider::Claude,
                "Claude Code",
                version_probe_error(&error),
            )
        }
    };
    let Some(binary) = binary else {
        return unavailable(
            AgentProvider::Claude,
            "Claude Code",
            "Install Claude Code to use its Terminal profile.",
        );
    };
    let installed = match run_probe(&binary, &["--version"], AcpPluginId::Claude).await {
        Ok(output) if output.contains("Claude Code") => true,
        Ok(_) => {
            return probe_failed(
                AgentProvider::Claude,
                "Claude Code",
                agent_error::CLI_UNEXPECTED_VERSION,
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
    let auth = if installed {
        Some(run_probe(&binary, &["auth", "status"], AcpPluginId::Claude).await)
    } else {
        None
    };
    let auth_timeout = auth
        .as_ref()
        .is_some_and(|result| result.as_ref().is_err_and(|error| is_probe_timeout(error)));
    let account = auth
        .and_then(Result::ok)
        .and_then(|output| super::cli_account::claude_account(&output));
    let detection_error = if account.is_some() {
        None
    } else {
        Some(
            if auth_timeout {
                AUTH_PROBE_TIMEOUT
            } else {
                "auth_probe_failed"
            }
            .into(),
        )
    };
    let (authenticated, auth_method, account_email, account_plan) =
        account.unwrap_or((false, None, None, None));
    AgentCliInfo {
        id: AgentProvider::Claude,
        name: "Claude Code".into(),
        installed,
        authenticated,
        auth_method,
        account_email,
        account_plan,
        detection_error,
        note: "Uses your local Claude Code authentication, including CLI-managed gateways. Credential configuration is not a live connection check.".into(),
    }
}

async fn detect_codex() -> AgentCliInfo {
    let binary = match super::resolve_provider_cli(AgentProvider::Codex).await {
        Ok(binary) => binary,
        Err(error) => {
            return probe_failed(
                AgentProvider::Codex,
                "Codex CLI",
                version_probe_error(&error),
            )
        }
    };
    let Some(binary) = binary else {
        return unavailable(
            AgentProvider::Codex,
            "Codex CLI",
            "Install Codex CLI to use its Terminal profile.",
        );
    };
    let installed = match run_probe(&binary, &["--version"], AcpPluginId::Codex).await {
        Ok(output) if output.contains("codex-cli") => true,
        Ok(_) => {
            return probe_failed(
                AgentProvider::Codex,
                "Codex CLI",
                agent_error::CLI_UNEXPECTED_VERSION,
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
    let auth = if installed {
        Some(run_probe(&binary, &["login", "status"], AcpPluginId::Codex).await)
    } else {
        None
    };
    let auth_unknown = auth
        .as_ref()
        .is_some_and(|result| result.as_ref().is_err_and(|error| is_probe_timeout(error)));
    let authenticated = auth.is_some_and(|result| result.is_ok());
    let account = if authenticated {
        super::cli_account::codex_account(&binary).await
    } else {
        None
    };
    let (auth_method, account_email, account_plan) = account
        .map(|(method, email, plan)| (Some(method), email, plan))
        .unwrap_or((None, None, None));
    AgentCliInfo {
        id: AgentProvider::Codex,
        name: "Codex CLI".into(),
        installed,
        authenticated,
        auth_method,
        account_email,
        account_plan,
        detection_error: auth_unknown.then(|| AUTH_PROBE_TIMEOUT.into()),
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
        account_email: None,
        account_plan: None,
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
        account_email: None,
        account_plan: None,
        detection_error: Some(error.into()),
        note: "DopeDB found this CLI but could not complete its credential-free status probe."
            .into(),
    }
}

/// npm-style shims start with `#!/usr/bin/env node`, so a missing runtime
/// fails inside `env` before the CLI runs. Name that cause by code instead of
/// leaving the screen with a bare exit status 127; the process output stays a
/// copyable detail.
fn version_probe_error(error: &str) -> String {
    if NODE_MISSING_MARKERS
        .iter()
        .any(|marker| error.contains(marker))
    {
        agent_error::with_detail(agent_error::CLI_NODE_MISSING, error)
    } else {
        agent_error::with_detail(agent_error::CLI_PROBE_FAILED, error)
    }
}

fn is_probe_timeout(error: &str) -> bool {
    error.starts_with("command timed out after")
}

async fn run_probe(binary: &Path, args: &[&str], provider: AcpPluginId) -> Result<String, String> {
    let mut command = quiet_command(binary);
    command.args(args);
    apply_probe_environment(&mut command, provider);
    let mut command = tokio::process::Command::from(command);
    command.kill_on_drop(true);
    let output = tokio::time::timeout(PROBE_TIMEOUT, command.output())
        .await
        .map_err(|_| format!("command timed out after {} ms", PROBE_TIMEOUT.as_millis()))?
        .map_err(|error| error.to_string())?;
    // Claude returns JSON with loggedIn:false and exit 1 when unconfigured.
    // Preserve that public status, but never forward token-bearing auth stderr.
    if provider == AcpPluginId::Claude && args == ["auth", "status"] {
        let text = String::from_utf8(output.stdout).map_err(|_| "invalid auth status")?;
        if output.status.success()
            || (output.status.code() == Some(1)
                && super::cli_account::claude_account(&text).is_some_and(|status| !status.0))
        {
            return Ok(text);
        }
        return Err("auth status failed".into());
    }
    decode_output(output)
}

pub(super) fn apply_probe_environment(command: &mut std::process::Command, provider: AcpPluginId) {
    command.env_clear();
    for (key, value) in std::env::vars_os() {
        if probe_environment_key_allowed(&key, cfg!(windows)) {
            command.env(key, value);
        }
    }
    for name in provider.local_cli_configuration_environment() {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command.env("PATH", super::provider_executable_search_path());
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

pub(super) fn quiet_command(program: impl AsRef<OsStr>) -> std::process::Command {
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
    super::cli_account::assert_claude_account_contract();
    let claude = AcpPluginId::Claude.local_cli_configuration_environment();
    assert!(claude.contains(&"CLAUDE_CONFIG_DIR"));
    assert!(claude.contains(&"ANTHROPIC_BASE_URL"));
    assert!(claude.contains(&"ANTHROPIC_AUTH_TOKEN"));
    assert!(claude.contains(&"ANTHROPIC_API_KEY"));
    for model in [
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ] {
        assert!(claude.contains(&model));
    }
    assert!(!claude.contains(&"NODE_OPTIONS"));
    assert!(!AcpPluginId::Codex
        .local_cli_configuration_environment()
        .contains(&"ANTHROPIC_AUTH_TOKEN"));
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
    assert!(missing_node.starts_with("agent_cli_node_missing\n"));
    assert!(missing_node.ends_with("env: node: No such file or directory"));
    assert!(
        version_probe_error("env: 'node': No such file or directory")
            .starts_with("agent_cli_node_missing\n")
    );
    assert_eq!(
        version_probe_error("command timed out after 4000 ms"),
        "agent_cli_probe_failed\ncommand timed out after 4000 ms"
    );
}
