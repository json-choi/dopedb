//! Fixed-binary, fixed-argv provider CLI boundary.
//!
//! Raw stdout remains bounded and process-local. The caller receives only a
//! schema-checked JSON value and must still verify the exact Provider and DB
//! target independently before advancing a receipt to `Ready`.

use std::collections::BTreeSet;
use std::fmt;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use crate::process_tree::{ProcessTree, ProcessTreeError};

#[cfg(test)]
use crate::error::AppResult;
#[cfg(test)]
use crate::operations::canonical_hash;

use super::super::domain::LocalProvider;
#[cfg(test)]
use super::ProvisioningExecutionPermit;
use super::ProvisioningReadAuthority;

#[cfg(test)]
#[path = "process_tests.rs"]
mod tests;

#[cfg(test)]
pub(crate) use tests::assert_process_boundary;

const MAX_EXECUTABLE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ARGUMENTS: usize = 128;
const MAX_ARGUMENT_BYTES: usize = 4096;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const MIN_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProvisioningExecutableIdentity {
    provider: LocalProvider,
    canonical_path: String,
    sha256: String,
    byte_length: u64,
}

impl ProvisioningExecutableIdentity {
    pub(crate) async fn audit(
        provider: LocalProvider,
        executable: &Path,
        allowed_roots: &[PathBuf],
        allowed_file_names: &[&str],
    ) -> Result<Self, ProvisioningProcessFailure> {
        if allowed_roots.is_empty() || allowed_file_names.is_empty() {
            return Err(ProvisioningProcessFailure::ExecutableRejected);
        }
        let canonical_path = tokio::fs::canonicalize(executable)
            .await
            .map_err(|_| ProvisioningProcessFailure::ExecutableUnavailable)?;
        let file_name = canonical_path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| allowed_file_names.contains(value))
            .ok_or(ProvisioningProcessFailure::ExecutableRejected)?;
        if cfg!(windows) && !file_name.to_ascii_lowercase().ends_with(".exe") {
            return Err(ProvisioningProcessFailure::ExecutableRejected);
        }
        let mut inside_allowed_root = false;
        for root in allowed_roots {
            let canonical_root = tokio::fs::canonicalize(root)
                .await
                .map_err(|_| ProvisioningProcessFailure::ExecutableRejected)?;
            if canonical_path.starts_with(canonical_root) {
                inside_allowed_root = true;
                break;
            }
        }
        if !inside_allowed_root {
            return Err(ProvisioningProcessFailure::ExecutableRejected);
        }
        let (sha256, byte_length) = hash_regular_file(&canonical_path).await?;
        let canonical_path = canonical_path
            .to_str()
            .filter(|value| !value.chars().any(unsafe_command_text_char))
            .ok_or(ProvisioningProcessFailure::ExecutableRejected)?
            .to_owned();
        Ok(Self {
            provider,
            canonical_path,
            sha256,
            byte_length,
        })
    }

    async fn revalidate(&self) -> Result<PathBuf, ProvisioningProcessFailure> {
        let requested = PathBuf::from(&self.canonical_path);
        let canonical = tokio::fs::canonicalize(&requested)
            .await
            .map_err(|_| ProvisioningProcessFailure::ExecutableChanged)?;
        if canonical != requested {
            return Err(ProvisioningProcessFailure::ExecutableChanged);
        }
        let (sha256, byte_length) = hash_regular_file(&canonical).await?;
        if sha256 != self.sha256 || byte_length != self.byte_length {
            return Err(ProvisioningProcessFailure::ExecutableChanged);
        }
        Ok(canonical)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "type", content = "path", rename_all = "camelCase")]
pub(crate) enum ProvisioningCliEnvironment {
    SafePath,
    Home(String),
    CloudSdkConfig(String),
    CloudSdkDisablePrompts,
    CloudSdkDisableUsageReporting,
    CloudSdkLogHttpOff,
    XdgConfigHome(String),
    PlanetScaleConfig(String),
    PlanetScaleNoUpdateNotifier,
    NeonConfig(String),
}

impl ProvisioningCliEnvironment {
    fn key_and_value(&self) -> Result<(&'static str, &str), ProvisioningProcessFailure> {
        match self {
            Self::SafePath => Ok(("PATH", safe_path())),
            Self::Home(path) => validate_environment_path("HOME", path),
            Self::CloudSdkConfig(path) => validate_environment_path("CLOUDSDK_CONFIG", path),
            Self::CloudSdkDisablePrompts => Ok(("CLOUDSDK_CORE_DISABLE_PROMPTS", "1")),
            Self::CloudSdkDisableUsageReporting => {
                Ok(("CLOUDSDK_CORE_DISABLE_USAGE_REPORTING", "true"))
            }
            Self::CloudSdkLogHttpOff => Ok(("CLOUDSDK_CORE_LOG_HTTP", "false")),
            Self::XdgConfigHome(path) => validate_environment_path("XDG_CONFIG_HOME", path),
            Self::PlanetScaleConfig(path) => validate_environment_path("PSCALE_CONFIG_DIR", path),
            Self::PlanetScaleNoUpdateNotifier => Ok(("PSCALE_NO_UPDATE_NOTIFIER", "1")),
            Self::NeonConfig(path) => validate_environment_path("NEON_CONFIG_DIR", path),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProvisioningCliOutputSchema {
    Empty,
    JsonObject,
    JsonArray,
    JsonLines,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProvisioningCliCommand {
    provider: LocalProvider,
    executable: ProvisioningExecutableIdentity,
    argv: Vec<String>,
    environment: Vec<ProvisioningCliEnvironment>,
    output_schema: ProvisioningCliOutputSchema,
    accepted_exit_codes: BTreeSet<i32>,
    timeout_ms: u64,
}

impl ProvisioningCliCommand {
    pub(crate) fn new(
        provider: LocalProvider,
        executable: ProvisioningExecutableIdentity,
        argv: Vec<String>,
        environment: Vec<ProvisioningCliEnvironment>,
        output_schema: ProvisioningCliOutputSchema,
        timeout: Duration,
    ) -> Result<Self, ProvisioningProcessFailure> {
        let command = Self {
            provider,
            executable,
            argv,
            environment,
            output_schema,
            accepted_exit_codes: BTreeSet::from([0]),
            timeout_ms: u64::try_from(timeout.as_millis())
                .map_err(|_| ProvisioningProcessFailure::CommandRejected)?,
        };
        command.validate()?;
        Ok(command)
    }

    /// Accept a small, explicitly hashed set of documented machine-readable
    /// exit codes. The default remains success-only; adapters must opt in for a
    /// command such as `pscale auth check`, whose JSON action-required result is
    /// intentionally emitted with exit code 1.
    pub(crate) fn with_accepted_exit_codes(
        mut self,
        accepted_exit_codes: impl IntoIterator<Item = i32>,
    ) -> Result<Self, ProvisioningProcessFailure> {
        self.accepted_exit_codes = accepted_exit_codes.into_iter().collect();
        self.validate()?;
        Ok(self)
    }

    #[cfg(test)]
    pub(crate) fn redacted_plan(&self) -> Value {
        serde_json::json!({
            "provider": self.provider,
            "executableSha256": self.executable.sha256,
            "argv": self.argv,
            "environmentKeys": self.environment.iter().filter_map(|value| {
                value.key_and_value().ok().map(|(key, _)| key)
            }).collect::<Vec<_>>(),
            "outputSchema": self.output_schema,
            "acceptedExitCodes": self.accepted_exit_codes,
            "timeoutMs": self.timeout_ms,
        })
    }

    /// Hash the complete local execution specification. The UI renders only the
    /// redacted projection, while the approved plan pins argv, environment paths,
    /// executable identity, output schema, and timeout together.
    #[cfg(test)]
    pub(crate) fn execution_sha256(&self) -> AppResult<String> {
        canonical_hash(&serde_json::to_value(self)?)
    }

    #[cfg(test)]
    pub(super) async fn run(
        &self,
        permit: &ProvisioningExecutionPermit,
        cancellation: &CancellationToken,
    ) -> Result<ProvisioningCliOutput, ProvisioningProcessFailure> {
        self.validate()?;
        if permit.provider != self.provider
            || permit.execution_sha256
                != self
                    .execution_sha256()
                    .map_err(|_| ProvisioningProcessFailure::CommandRejected)?
            || permit.plan_sha256.len() != 64
            || permit.operation_id.is_nil()
        {
            return Err(ProvisioningProcessFailure::CommandRejected);
        }
        self.run_process(cancellation).await
    }

    /// Run a non-mutating detect/discover command under a Provider adapter
    /// authority. This path cannot consume or synthesize an Operation execution
    /// permit and therefore cannot be reused for apply/destroy checkpoints.
    pub(super) async fn run_read_only(
        &self,
        authority: &ProvisioningReadAuthority,
        cancellation: &CancellationToken,
    ) -> Result<ProvisioningCliOutput, ProvisioningProcessFailure> {
        if authority.provider != self.provider
            || authority.manifest_sha256.len() != 64
            || !authority
                .manifest_sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ProvisioningProcessFailure::CommandRejected);
        }
        self.run_process(cancellation).await
    }

    async fn run_process(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<ProvisioningCliOutput, ProvisioningProcessFailure> {
        self.validate()?;
        if cancellation.is_cancelled() {
            return Err(ProvisioningProcessFailure::Cancelled);
        }
        let executable = self.executable.revalidate().await?;
        let mut command = Command::new(executable);
        command
            .args(&self.argv)
            .env_clear()
            .kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for environment in &self.environment {
            let (key, value) = environment.key_and_value()?;
            command.env(key, value);
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
            .map_err(|_| ProvisioningProcessFailure::SpawnFailed)?;
        let mut tree = match ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Err(map_process_tree_error(error));
            }
        };
        let stdout = child
            .stdout
            .take()
            .ok_or(ProvisioningProcessFailure::OutputRejected)?;
        let stderr = child
            .stderr
            .take()
            .ok_or(ProvisioningProcessFailure::OutputRejected)?;
        let read = async move { tokio::try_join!(read_bounded(stdout), read_bounded(stderr)) };
        let timeout = Duration::from_millis(self.timeout_ms);
        let deadline = tokio::time::Instant::now() + timeout;
        let mut result = tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(ProvisioningProcessFailure::Cancelled),
            value = tokio::time::timeout_at(deadline, read) => match value {
                Ok(value) => value,
                Err(_) => Err(ProvisioningProcessFailure::TimedOut),
            },
        };
        // EOF can precede the root's exit. Let a completed output stream settle
        // within the original deadline instead of signalling a valid CLI before
        // its exit code exists. Cancellation still tears down the whole tree.
        if result.is_ok() {
            let exit = Box::pin(async {
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => Err(ProvisioningProcessFailure::Cancelled),
                    value = tokio::time::timeout_at(deadline, child.wait()) => match value {
                        Ok(Ok(_)) => Ok(()),
                        Ok(Err(_)) => Err(ProvisioningProcessFailure::CleanupFailed),
                        Err(_) => Err(ProvisioningProcessFailure::TimedOut),
                    },
                }
            })
            .await;
            if let Err(error) = exit {
                result = Err(error);
            }
        }
        let status = tree
            .terminate_and_reap(&mut child)
            .await
            .map_err(map_process_tree_error)?;
        let (output, stderr) = result?;
        if !status
            .code()
            .is_some_and(|code| self.accepted_exit_codes.contains(&code))
        {
            return Err(classify_exit_failure(&stderr));
        }
        parse_output(self.output_schema, output)
    }

    fn validate(&self) -> Result<(), ProvisioningProcessFailure> {
        let timeout = Duration::from_millis(self.timeout_ms);
        if self.provider != self.executable.provider
            || self.argv.is_empty()
            || self.argv.len() > MAX_ARGUMENTS
            || self.accepted_exit_codes.is_empty()
            || self.accepted_exit_codes.len() > 4
            || self
                .accepted_exit_codes
                .iter()
                .any(|code| !(0..=3).contains(code))
            || !(MIN_TIMEOUT..=MAX_TIMEOUT).contains(&timeout)
            || self.argv.iter().any(|argument| {
                argument.is_empty()
                    || argument.len() > MAX_ARGUMENT_BYTES
                    || argument.chars().any(unsafe_command_text_char)
            })
        {
            return Err(ProvisioningProcessFailure::CommandRejected);
        }
        let mut keys = BTreeSet::new();
        for environment in &self.environment {
            let (key, _) = environment.key_and_value()?;
            if !keys.insert(key) {
                return Err(ProvisioningProcessFailure::CommandRejected);
            }
        }
        Ok(())
    }
}

fn map_process_tree_error(error: ProcessTreeError) -> ProvisioningProcessFailure {
    match error {
        ProcessTreeError::Isolation => ProvisioningProcessFailure::ProcessIsolationFailed,
        ProcessTreeError::Cleanup => ProvisioningProcessFailure::CleanupFailed,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ProvisioningCliOutput {
    value: Value,
}

impl ProvisioningCliOutput {
    pub(crate) fn value(&self) -> &Value {
        &self.value
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub(crate) enum ProvisioningProcessFailure {
    #[error("provider CLI is unavailable")]
    ExecutableUnavailable,
    #[error("provider CLI executable was rejected")]
    ExecutableRejected,
    #[error("provider CLI executable changed after planning")]
    ExecutableChanged,
    #[error("provider CLI command was rejected")]
    CommandRejected,
    #[error("provider CLI process isolation failed")]
    ProcessIsolationFailed,
    #[error("provider CLI could not start")]
    SpawnFailed,
    #[error("provider CLI operation was cancelled")]
    Cancelled,
    #[error("provider CLI operation timed out")]
    TimedOut,
    #[error("provider CLI output was rejected")]
    OutputRejected,
    #[error("provider CLI authentication is required")]
    AuthenticationRequired,
    #[error("provider CLI requires multi-factor authentication")]
    MultiFactorRequired,
    #[error("provider CLI permission was denied")]
    PermissionDenied,
    #[error("provider CLI rate limit was reached")]
    RateLimited,
    #[error("provider CLI network is unavailable")]
    NetworkUnavailable,
    #[error("provider CLI exited unsuccessfully")]
    ExitStatusRejected,
    #[error("provider CLI process cleanup failed")]
    CleanupFailed,
}

async fn hash_regular_file(path: &Path) -> Result<(String, u64), ProvisioningProcessFailure> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| ProvisioningProcessFailure::ExecutableUnavailable)?;
    let before = file
        .metadata()
        .await
        .map_err(|_| ProvisioningProcessFailure::ExecutableUnavailable)?;
    if !before.is_file() || before.len() == 0 || before.len() > MAX_EXECUTABLE_BYTES {
        return Err(ProvisioningProcessFailure::ExecutableRejected);
    }
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut observed = 0_u64;
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|_| ProvisioningProcessFailure::ExecutableChanged)?;
        if read == 0 {
            break;
        }
        observed = observed
            .checked_add(u64::try_from(read).expect("buffer length fits in u64"))
            .ok_or(ProvisioningProcessFailure::ExecutableRejected)?;
        if observed > MAX_EXECUTABLE_BYTES {
            return Err(ProvisioningProcessFailure::ExecutableRejected);
        }
        digest.update(&buffer[..read]);
    }
    let after = file
        .metadata()
        .await
        .map_err(|_| ProvisioningProcessFailure::ExecutableChanged)?;
    if observed != before.len() || after.len() != before.len() {
        return Err(ProvisioningProcessFailure::ExecutableChanged);
    }
    Ok((lower_hex(&digest.finalize()), observed))
}

async fn read_bounded<R>(mut stream: R) -> Result<Zeroizing<Vec<u8>>, ProvisioningProcessFailure>
where
    R: AsyncRead + Unpin,
{
    let mut output = Zeroizing::new(Vec::with_capacity(4096));
    let mut buffer = Zeroizing::new(vec![0_u8; 8192]);
    loop {
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|_| ProvisioningProcessFailure::OutputRejected)?;
        if read == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(read) > MAX_OUTPUT_BYTES {
            return Err(ProvisioningProcessFailure::OutputRejected);
        }
        output.extend_from_slice(&buffer[..read]);
    }
}

fn classify_exit_failure(stderr: &[u8]) -> ProvisioningProcessFailure {
    if contains_any_ascii_case_insensitive(
        stderr,
        &[
            b"mfa required",
            b"multi-factor authentication",
            b"multifactor authentication",
            b"two-factor authentication",
            b"2fa required",
        ],
    ) {
        ProvisioningProcessFailure::MultiFactorRequired
    } else if contains_any_ascii_case_insensitive(
        stderr,
        &[
            b"reauthentication failed",
            b"authentication required",
            b"not authenticated",
            b"not logged in",
            b"login required",
            b"please log in",
            b"please run: gcloud auth login",
            b"gcloud auth login",
            b"invalid_grant",
            b"unauthenticated",
            b"credentials have been revoked",
            b"401 unauthorized",
        ],
    ) {
        ProvisioningProcessFailure::AuthenticationRequired
    } else if contains_any_ascii_case_insensitive(
        stderr,
        &[
            b"rate limit",
            b"rate_limit",
            b"quota exceeded",
            b"resource_exhausted",
            b"too many requests",
            b"status 429",
            b"http 429",
        ],
    ) {
        ProvisioningProcessFailure::RateLimited
    } else if contains_any_ascii_case_insensitive(
        stderr,
        &[
            b"permission denied",
            b"permission_denied",
            b"does not have permission",
            b"access denied",
            b"status 403",
            b"http 403",
            b"403 forbidden",
        ],
    ) {
        ProvisioningProcessFailure::PermissionDenied
    } else if contains_any_ascii_case_insensitive(
        stderr,
        &[
            b"connection timed out",
            b"connection refused",
            b"network is unreachable",
            b"temporary failure in name resolution",
            b"name or service not known",
            b"unable to connect",
            b"could not resolve host",
            b"tls handshake",
        ],
    ) {
        ProvisioningProcessFailure::NetworkUnavailable
    } else {
        ProvisioningProcessFailure::ExitStatusRejected
    }
}

fn contains_any_ascii_case_insensitive(haystack: &[u8], needles: &[&[u8]]) -> bool {
    needles.iter().any(|needle| {
        haystack
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle))
    })
}

fn parse_output(
    schema: ProvisioningCliOutputSchema,
    output: Zeroizing<Vec<u8>>,
) -> Result<ProvisioningCliOutput, ProvisioningProcessFailure> {
    let value = match schema {
        ProvisioningCliOutputSchema::Empty if output.iter().all(u8::is_ascii_whitespace) => {
            Value::Null
        }
        ProvisioningCliOutputSchema::Empty => {
            return Err(ProvisioningProcessFailure::OutputRejected)
        }
        ProvisioningCliOutputSchema::JsonObject => strict_json(&output)
            .ok()
            .filter(Value::is_object)
            .ok_or(ProvisioningProcessFailure::OutputRejected)?,
        ProvisioningCliOutputSchema::JsonArray => strict_json(&output)
            .ok()
            .filter(Value::is_array)
            .ok_or(ProvisioningProcessFailure::OutputRejected)?,
        ProvisioningCliOutputSchema::JsonLines => {
            let mut values = Vec::new();
            for line in output.split(|byte| *byte == b'\n') {
                let line = line.strip_suffix(b"\r").unwrap_or(line);
                if line.iter().all(u8::is_ascii_whitespace) {
                    continue;
                }
                values.push(strict_json(line)?);
            }
            Value::Array(values)
        }
    };
    Ok(ProvisioningCliOutput { value })
}

struct StrictJsonValue(Value);

impl<'de> Deserialize<'de> for StrictJsonValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(StrictJsonVisitor)
    }
}

struct StrictJsonVisitor;

impl<'de> Visitor<'de> for StrictJsonVisitor {
    type Value = StrictJsonValue;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("JSON without duplicate object keys")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Bool(value)))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Number(Number::from(value))))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Number(Number::from(value))))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Number::from_f64(value)
            .map(|number| StrictJsonValue(Value::Number(number)))
            .ok_or_else(|| E::custom("invalid JSON number"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::String(value.to_owned())))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::String(value)))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Null))
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJsonValue(Value::Null))
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        StrictJsonValue::deserialize(deserializer)
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut values = Vec::new();
        while let Some(StrictJsonValue(value)) = sequence.next_element()? {
            values.push(value);
        }
        Ok(StrictJsonValue(Value::Array(values)))
    }

    fn visit_map<A>(self, mut object: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut values = Map::new();
        while let Some(key) = object.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(de::Error::custom("duplicate JSON object key"));
            }
            let StrictJsonValue(value) = object.next_value()?;
            values.insert(key, value);
        }
        Ok(StrictJsonValue(Value::Object(values)))
    }
}

fn strict_json(input: &[u8]) -> Result<Value, ProvisioningProcessFailure> {
    serde_json::from_slice::<StrictJsonValue>(input)
        .map(|value| value.0)
        .map_err(|_| ProvisioningProcessFailure::OutputRejected)
}

fn validate_environment_path<'a>(
    key: &'static str,
    value: &'a str,
) -> Result<(&'static str, &'a str), ProvisioningProcessFailure> {
    let path = Path::new(value);
    if !path.is_absolute()
        || value.is_empty()
        || value.len() > MAX_ARGUMENT_BYTES
        || value.chars().any(unsafe_command_text_char)
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(ProvisioningProcessFailure::CommandRejected);
    }
    Ok((key, value))
}

fn unsafe_command_text_char(value: char) -> bool {
    value.is_control()
        || matches!(
            value,
            '\u{061c}'
                | '\u{200e}'
                | '\u{200f}'
                | '\u{202a}'..='\u{202e}'
                | '\u{2066}'..='\u{2069}'
                | '\u{feff}'
        )
}

fn safe_path() -> &'static str {
    if cfg!(windows) {
        r"C:\Windows\System32"
    } else {
        "/usr/bin:/bin"
    }
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}
