//! Concrete desktop adapter for CLI discovery.

mod cli_account;
mod cli_probe;
mod cli_runtime;

pub(crate) use cli_probe::ProcessAgentCliProbe;
pub(crate) use cli_runtime::{provider_executable_search_path, resolve_provider_cli};

#[cfg(test)]
pub(crate) fn assert_agent_cli_probe_contract() {
    cli_probe::assert_agent_cli_probe_contract();
    cli_runtime::assert_cli_runtime_contract();
}
