//! Verified official-CLI process launch port for one connection-pinned ACP actor.

use std::future::Future;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use agent_client_protocol::schema::v1::{EnvVariable, McpServer, McpServerStdio};
use agent_client_protocol::AcpAgentConfig;
use dopedb_protocol::{AcpPluginId, AgentSessionRegisterArguments};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::features::agents::runtime::AcpPluginManager;
use crate::kernel::identity::{ConnectionId, TerminalSessionId};

use super::super::domain::AgentProvider;
use super::provider_name;

const DOPEDB_MCP_SERVER_NAME: &str = "dopedb-desktop-session";
const MAX_PROVIDER_CLI_BYTES: u64 = 512 * 1024 * 1024;

type ProcessLaunchFuture<'a> =
    Pin<Box<dyn Future<Output = AppResult<PreparedAcpProcess>> + Send + 'a>>;

pub(super) trait AcpProcessLaunchPort: Send + Sync {
    fn prepare(&self, provider: AgentProvider) -> ProcessLaunchFuture<'_>;
    fn has_ready_fallback(&self, provider: AgentProvider) -> AppResult<bool>;
}

pub(super) struct TauriAcpProcessLaunchPort {
    app: AppHandle,
    plugins: AcpPluginManager,
}

impl TauriAcpProcessLaunchPort {
    pub(super) fn new(app: AppHandle, plugins: AcpPluginManager) -> Self {
        Self { app, plugins }
    }
}

impl AcpProcessLaunchPort for TauriAcpProcessLaunchPort {
    fn prepare(&self, provider: AgentProvider) -> ProcessLaunchFuture<'_> {
        Box::pin(async move {
            let plugin_id = plugin_id(provider);
            let plugin_plan = self.plugins.launch_plan(&self.app, plugin_id)?;
            let cli_name = match provider {
                AgentProvider::Claude => "claude",
                AgentProvider::Codex => "codex",
            };
            let provider_cli = crate::cli_environment::find_executable(cli_name).ok_or_else(|| {
                AppError::Agent(format!(
                    "{} is not installed. Install its official local CLI, then start a new Agent session.",
                    provider_name(provider)
                ))
            })?;
            let (provider_cli, provider_cli_resolved, provider_cli_sha256) =
                tokio::task::spawn_blocking(move || verified_provider_cli(provider_cli))
                    .await
                    .map_err(|_| {
                        AppError::Config("the provider CLI verifier stopped unexpectedly".into())
                    })??;
            let runtime_executable = std::fs::canonicalize(&plugin_plan.node_executable)?;
            let adapter_entrypoint = std::fs::canonicalize(&plugin_plan.adapter_entrypoint)?;
            let agent_bridge =
                tokio::task::spawn_blocking(crate::cli_install::bundled_agent_bridge_binary)
                    .await
                    .map_err(|_| {
                        AppError::Config("the Agent bridge resolver stopped unexpectedly".into())
                    })??;
            Ok(PreparedAcpProcess {
                plugin_id,
                adapter_bundle_version: plugin_plan.adapter_bundle_version,
                plugin_installation_id: plugin_plan.installation_id,
                runtime_executable,
                runtime_sha256: plugin_plan.node_sha256,
                adapter_entrypoint,
                adapter_entrypoint_sha256: plugin_plan.adapter_entrypoint_sha256,
                provider_cli,
                provider_cli_resolved,
                provider_cli_sha256,
                plugin_candidate: plugin_plan.candidate,
                plugins: self.plugins.clone(),
                app: self.app.clone(),
                agent_bridge,
                working_directory: neutral_agent_working_directory()?,
                runtime_file: None,
            })
        })
    }

    fn has_ready_fallback(&self, provider: AgentProvider) -> AppResult<bool> {
        self.plugins.has_ready_fallback(plugin_id(provider))
    }
}

pub(super) struct PreparedAcpProcess {
    plugin_id: AcpPluginId,
    adapter_bundle_version: String,
    plugin_installation_id: String,
    runtime_executable: PathBuf,
    runtime_sha256: String,
    adapter_entrypoint: PathBuf,
    adapter_entrypoint_sha256: String,
    provider_cli: PathBuf,
    provider_cli_resolved: PathBuf,
    provider_cli_sha256: String,
    plugin_candidate: bool,
    plugins: AcpPluginManager,
    app: AppHandle,
    agent_bridge: PathBuf,
    working_directory: PathBuf,
    runtime_file: Option<PathBuf>,
}

impl PreparedAcpProcess {
    pub(super) fn registration(&self) -> AppResult<AgentSessionRegisterArguments> {
        Ok(AgentSessionRegisterArguments {
            plugin_id: self.plugin_id,
            adapter_bundle_version: self.adapter_bundle_version.clone(),
            runtime_executable: utf8_path(&self.runtime_executable, "bundled Node runtime")?,
            runtime_resolved_executable: utf8_path(
                &self.runtime_executable,
                "bundled Node runtime",
            )?,
            runtime_sha256: self.runtime_sha256.clone(),
            adapter_entrypoint: utf8_path(&self.adapter_entrypoint, "ACP adapter entrypoint")?,
            adapter_entrypoint_sha256: self.adapter_entrypoint_sha256.clone(),
            provider_cli_executable: utf8_path(&self.provider_cli, "provider CLI")?,
            provider_cli_resolved_executable: utf8_path(
                &self.provider_cli_resolved,
                "resolved provider CLI",
            )?,
            provider_cli_sha256: self.provider_cli_sha256.clone(),
        })
    }

    pub(super) fn bind(
        mut self,
        token: Zeroizing<String>,
        runtime_file: Option<PathBuf>,
    ) -> AcpProcess {
        self.runtime_file = runtime_file;
        AcpProcess {
            prepared: self,
            token,
        }
    }
}

pub(super) struct AcpProcess {
    prepared: PreparedAcpProcess,
    token: Zeroizing<String>,
}

impl AcpProcess {
    pub(super) fn candidate_receipt(&self) -> AcpPluginCandidateReceipt {
        AcpPluginCandidateReceipt {
            plugin_id: self.prepared.plugin_id,
            plugin_version: self.prepared.adapter_bundle_version.clone(),
            plugin_installation_id: self.prepared.plugin_installation_id.clone(),
            candidate: self.prepared.plugin_candidate,
            plugins: self.prepared.plugins.clone(),
            app: self.prepared.app.clone(),
        }
    }

    pub(super) fn working_directory(&self) -> &Path {
        &self.prepared.working_directory
    }

    pub(super) fn agent_config(
        &mut self,
        broker_session_id: TerminalSessionId,
        connection_id: ConnectionId,
    ) -> AcpAgentConfig {
        let token = std::mem::take(&mut *self.token);
        let launch = &self.prepared;
        let mut config = AcpAgentConfig::new(launch.agent_bridge.clone())
            .args([
                "launch".to_owned(),
                launch.plugin_id.as_str().to_owned(),
                launch.adapter_bundle_version.clone(),
                launch
                    .runtime_executable
                    .to_str()
                    .expect("verified bundled Node path remains UTF-8")
                    .to_owned(),
                launch
                    .runtime_executable
                    .to_str()
                    .expect("verified bundled Node path remains UTF-8")
                    .to_owned(),
                launch.runtime_sha256.clone(),
                launch
                    .adapter_entrypoint
                    .to_str()
                    .expect("verified adapter entrypoint remains UTF-8")
                    .to_owned(),
                launch.adapter_entrypoint_sha256.clone(),
                launch
                    .provider_cli
                    .to_str()
                    .expect("verified provider CLI path remains UTF-8")
                    .to_owned(),
                launch
                    .provider_cli_resolved
                    .to_str()
                    .expect("verified resolved provider CLI path remains UTF-8")
                    .to_owned(),
                launch.provider_cli_sha256.clone(),
            ])
            .env(
                "PATH",
                crate::cli_environment::executable_search_path(None)
                    .to_string_lossy()
                    .into_owned(),
            )
            .env("DOPEDB_TERMINAL_SESSION_ID", broker_session_id.to_string())
            .env("DOPEDB_CONNECTION_SCOPE", connection_id.to_string())
            .env("DOPEDB_SESSION_TOKEN", token)
            .env("TERM_PROGRAM", "DopeDB")
            .env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        if let Some(runtime_file) = &launch.runtime_file {
            config = config.env(
                "DOPEDB_RUNTIME_FILE",
                runtime_file.to_string_lossy().into_owned(),
            );
        }
        config
    }

    pub(super) fn mcp_server(
        &self,
        broker_session_id: TerminalSessionId,
        connection_id: ConnectionId,
    ) -> McpServer {
        let launch = &self.prepared;
        let mut environment = vec![
            EnvVariable::new("DOPEDB_TERMINAL_SESSION_ID", broker_session_id.to_string()),
            EnvVariable::new("DOPEDB_CONNECTION_SCOPE", connection_id.to_string()),
            EnvVariable::new("DOPEDB_AGENT_PROCESS_BOUND", "1"),
            EnvVariable::new("TERM_PROGRAM", "DopeDB"),
            EnvVariable::new("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION")),
        ];
        if let Some(runtime_file) = &launch.runtime_file {
            environment.push(EnvVariable::new(
                "DOPEDB_RUNTIME_FILE",
                runtime_file.to_string_lossy().into_owned(),
            ));
        }
        McpServer::Stdio(
            McpServerStdio::new(DOPEDB_MCP_SERVER_NAME, launch.agent_bridge.clone())
                .args(vec!["mcp".into()])
                .env(environment),
        )
    }
}

#[derive(Clone)]
pub(super) struct AcpPluginCandidateReceipt {
    plugin_id: AcpPluginId,
    plugin_version: String,
    plugin_installation_id: String,
    candidate: bool,
    plugins: AcpPluginManager,
    app: AppHandle,
}

impl AcpPluginCandidateReceipt {
    pub(super) fn plugin_id(&self) -> AcpPluginId {
        self.plugin_id
    }

    pub(super) fn plugin_version(&self) -> &str {
        &self.plugin_version
    }

    pub(super) fn is_candidate(&self) -> bool {
        self.candidate
    }

    pub(super) fn record_initialize_success(&self) -> AppResult<()> {
        self.plugins
            .record_initialize_success(&self.app, self.plugin_id, &self.plugin_installation_id)
            .map(|_| ())
    }

    pub(super) fn record_initialize_failure(&self, reason: &str) -> AppResult<()> {
        self.plugins
            .record_initialize_failure(
                &self.app,
                self.plugin_id,
                &self.plugin_installation_id,
                reason,
            )
            .map(|_| ())
    }
}

pub(super) fn mcp_server_name() -> &'static str {
    DOPEDB_MCP_SERVER_NAME
}

fn plugin_id(provider: AgentProvider) -> AcpPluginId {
    match provider {
        AgentProvider::Claude => AcpPluginId::Claude,
        AgentProvider::Codex => AcpPluginId::Codex,
    }
}

fn verified_provider_cli(path: PathBuf) -> AppResult<(PathBuf, PathBuf, String)> {
    if !path.is_absolute() || path.to_str().is_none() {
        return Err(AppError::Config(
            "the provider CLI must have an absolute UTF-8 path".into(),
        ));
    }
    let resolved = std::fs::canonicalize(&path)?;
    if !resolved.is_absolute() || resolved.to_str().is_none() {
        return Err(AppError::Config(
            "the resolved provider CLI must have an absolute UTF-8 path".into(),
        ));
    }
    let metadata = std::fs::metadata(&resolved)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_PROVIDER_CLI_BYTES {
        return Err(AppError::Blocked {
            reason: "the provider CLI is not a bounded regular file".into(),
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(AppError::Blocked {
                reason: "the provider CLI is not executable".into(),
            });
        }
    }
    let mut file = std::fs::File::open(&resolved)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok((path, resolved, hex::encode(hasher.finalize())))
}

fn utf8_path(path: &Path, label: &str) -> AppResult<String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| AppError::Config(format!("the {label} path is not valid UTF-8")))
}

fn neutral_agent_working_directory() -> AppResult<PathBuf> {
    let directory = crate::app_paths::local_data_root()?.join("agent-workdir");
    std::fs::create_dir_all(&directory)?;
    let metadata = std::fs::symlink_metadata(&directory)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppError::Blocked {
            reason: "the Agent working directory is not a safe directory".into(),
        });
    }
    Ok(directory)
}
