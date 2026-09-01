//! Bounded execution boundary for official `gcloud` and `bq` onboarding commands.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::process_tree::ProcessTree;

use super::super::{
    discover_sdk_executable, map_process_tree_error, read_bounded, safe_path, CommandFailure,
    CommandOutput, ResolvedSdkExecutable, MAX_ERROR_BYTES, MAX_OUTPUT_BYTES,
};

#[derive(Debug, Clone, Copy)]
pub(super) enum SdkExecutable {
    Bq,
    Gcloud,
}

impl SdkExecutable {
    fn label(self) -> &'static str {
        match self {
            Self::Bq => "BigQuery CLI",
            Self::Gcloud => "Google Cloud CLI",
        }
    }
}

async fn discover_onboarding_executable(kind: SdkExecutable) -> AppResult<ResolvedSdkExecutable> {
    let allowed_names = match kind {
        SdkExecutable::Bq => &["bq", "bq.cmd"][..],
        SdkExecutable::Gcloud => &["gcloud", "gcloud.cmd"][..],
    };
    discover_sdk_executable(allowed_names, kind.label()).await
}

pub(super) async fn run_json(
    kind: SdkExecutable,
    arguments: &[String],
    config: &Path,
    timeout: Duration,
) -> AppResult<Value> {
    let output = run_checked(kind, arguments, config, timeout).await?;
    serde_json::from_slice(&output.stdout)
        .map_err(|_| AppError::Config(format!("{} returned invalid JSON", kind.label())))
}

pub(super) async fn run_checked(
    kind: SdkExecutable,
    arguments: &[String],
    config: &Path,
    timeout: Duration,
) -> AppResult<CommandOutput> {
    validate_arguments(arguments)?;
    let resolved = discover_onboarding_executable(kind).await?;
    let executable = resolved
        .identity
        .revalidate()
        .await
        .map_err(onboarding_command_failure)?;
    let home = crate::app_paths::home_dir()?;
    let mut command = Command::new(executable);
    command
        .args(arguments)
        .env_clear()
        .env("PATH", safe_path())
        .env("HOME", home)
        .env("CLOUDSDK_CONFIG", config)
        .env("CLOUDSDK_CORE_DISABLE_PROMPTS", "1")
        .env("CLOUDSDK_CORE_DISABLE_USAGE_REPORTING", "true")
        .env("CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK", "1")
        .env("CLOUDSDK_CORE_LOG_HTTP", "false")
        .env("PYTHONIOENCODING", "utf-8")
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    resolved.environment.apply(&mut command);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(
        windows_sys::Win32::System::Threading::CREATE_NO_WINDOW
            | windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP,
    );
    let mut child = command
        .spawn()
        .map_err(|_| onboarding_command_failure(CommandFailure::Spawn))?;
    let mut tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Err(onboarding_command_failure(CommandFailure::Isolation));
        }
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| onboarding_command_failure(CommandFailure::Output))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| onboarding_command_failure(CommandFailure::Output))?;
    let captured = tokio::time::timeout(timeout, async move {
        tokio::try_join!(
            read_bounded(stdout, MAX_OUTPUT_BYTES),
            read_bounded(stderr, MAX_ERROR_BYTES)
        )
    })
    .await;
    let status = tree
        .terminate_and_reap(&mut child)
        .await
        .map_err(map_process_tree_error)
        .map_err(onboarding_command_failure)?;
    let (stdout, stderr) = captured
        .map_err(|_| onboarding_command_failure(CommandFailure::TimedOut))?
        .map_err(onboarding_command_failure)?;
    let output = CommandOutput {
        status,
        stdout,
        stderr,
    };
    if output.status.success() {
        Ok(output)
    } else {
        Err(safe_onboarding_error(kind, &output.stderr))
    }
}

fn validate_arguments(arguments: &[String]) -> AppResult<()> {
    if arguments.is_empty()
        || arguments.len() > 32
        || arguments.iter().any(|argument| {
            argument.is_empty() || argument.len() > 4096 || argument.chars().any(char::is_control)
        })
    {
        return Err(AppError::Blocked {
            reason: "Google Cloud CLI request is invalid".into(),
        });
    }
    Ok(())
}

fn safe_onboarding_error(kind: SdkExecutable, stderr: &[u8]) -> AppError {
    let text = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if text.contains("reauthentication failed")
        || text.contains("invalid_grant")
        || text.contains("login required")
        || text.contains("no credentialed accounts")
    {
        return AppError::Config(
            "Google Cloud authentication is unavailable; reconnect and retry".into(),
        );
    }
    if text.contains("access denied")
        || text.contains("permission denied")
        || text.contains("does not have") && text.contains("permission")
        || text.contains("accessdenied")
    {
        return AppError::Blocked {
            reason: "the local Google Cloud authentication cannot list this BigQuery resource"
                .into(),
        };
    }
    if text.contains("has not been used")
        || text.contains("accessnotconfigured")
        || text.contains("api is not enabled")
    {
        return AppError::Config(
            "the BigQuery API is not enabled for the selected Google Cloud project".into(),
        );
    }
    if text.contains("not found") || text.contains("notfound") {
        return AppError::NotFound(
            "the selected Google Cloud project or BigQuery resource was not found".into(),
        );
    }
    if text.contains("quota") || text.contains("rate limit") {
        return AppError::Config(
            "Google Cloud temporarily rejected resource discovery because of a quota limit".into(),
        );
    }
    if text.contains("timed out")
        || text.contains("connection reset")
        || text.contains("could not resolve")
        || text.contains("name resolution")
        || text.contains("network is unreachable")
    {
        return AppError::Network("Google Cloud resource discovery could not connect".into());
    }
    AppError::Config(format!(
        "{} rejected the request; verify the local Google Cloud login and permissions",
        kind.label()
    ))
}

fn onboarding_command_failure(error: CommandFailure) -> AppError {
    match error {
        CommandFailure::Unavailable | CommandFailure::Changed => AppError::Blocked {
            reason: "the verified Google Cloud CLI executable changed or became unavailable".into(),
        },
        CommandFailure::Spawn => {
            AppError::Config("the verified Google Cloud CLI could not be started".into())
        }
        CommandFailure::Isolation => AppError::Blocked {
            reason: "the Google Cloud CLI process could not be isolated safely".into(),
        },
        CommandFailure::Cleanup => AppError::OutcomeUnknown(
            "the Google Cloud CLI process tree could not be proven stopped".into(),
        ),
        CommandFailure::Output => AppError::Blocked {
            reason: "Google Cloud CLI output exceeded its local safety bound".into(),
        },
        CommandFailure::TimedOut => {
            AppError::Timeout("Google Cloud CLI authentication or discovery timed out".into())
        }
        CommandFailure::Cancelled => AppError::Safety("Google Cloud CLI request cancelled".into()),
    }
}
