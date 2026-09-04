//! Concrete desktop adapter for CLI discovery.

mod cli_probe;

pub(crate) use cli_probe::ProcessAgentCliProbe;

#[cfg(test)]
pub(crate) fn assert_agent_cli_probe_contract() {
    cli_probe::assert_agent_cli_probe_contract();
}
