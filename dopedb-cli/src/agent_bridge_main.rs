//! App-only ACP process launcher and typed MCP entrypoint.
//!
//! This binary is bundled with DopeDB but is never installed as the public CLI.
//! It registers the official ACP adapter process once, then serves typed MCP
//! tools that talk directly to the authenticated Local Broker.

mod acp_launch;
mod agent_mcp;
mod client;
mod exit_code;
mod schema_diff;

use std::process::ExitCode;

use client::ClientError;
use dopedb_protocol::{AcpPluginId, AgentSessionRegisterArguments};

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut arguments = std::env::args().skip(1);
    let result = match arguments.next().as_deref() {
        Some("launch") => {
            let plugin_id = arguments.next().as_deref().and_then(AcpPluginId::parse);
            let adapter_bundle_version = arguments.next();
            let runtime_executable = arguments.next();
            let runtime_resolved_executable = arguments.next();
            let runtime_sha256 = arguments.next();
            let adapter_entrypoint = arguments.next();
            let adapter_entrypoint_sha256 = arguments.next();
            let provider_cli_executable = arguments.next();
            let provider_cli_resolved_executable = arguments.next();
            let provider_cli_sha256 = arguments.next();
            if let (
                Some(plugin_id),
                Some(adapter_bundle_version),
                Some(runtime_executable),
                Some(runtime_resolved_executable),
                Some(runtime_sha256),
                Some(adapter_entrypoint),
                Some(adapter_entrypoint_sha256),
                Some(provider_cli_executable),
                Some(provider_cli_resolved_executable),
                Some(provider_cli_sha256),
                None,
            ) = (
                plugin_id,
                adapter_bundle_version,
                runtime_executable,
                runtime_resolved_executable,
                runtime_sha256,
                adapter_entrypoint,
                adapter_entrypoint_sha256,
                provider_cli_executable,
                provider_cli_resolved_executable,
                provider_cli_sha256,
                arguments.next(),
            ) {
                acp_launch::run(AgentSessionRegisterArguments {
                    plugin_id,
                    adapter_bundle_version,
                    runtime_executable,
                    runtime_resolved_executable,
                    runtime_sha256,
                    adapter_entrypoint,
                    adapter_entrypoint_sha256,
                    provider_cli_executable,
                    provider_cli_resolved_executable,
                    provider_cli_sha256,
                })
                .await
            } else {
                Err(ClientError::InvalidArguments)
            }
        }
        Some("mcp") if arguments.next().is_none() => agent_mcp::serve().await,
        _ => Err(ClientError::InvalidArguments),
    };
    match result {
        Ok(()) => ExitCode::from(exit_code::SUCCESS),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(exit_code::for_client_error(&error))
        }
    }
}
