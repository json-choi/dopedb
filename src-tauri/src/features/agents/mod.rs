//! ACP runtime and local CLI readiness slice.

pub(crate) mod acp;
pub(crate) mod adapters;
mod application;
pub(crate) mod domain;
pub(crate) mod external_transport;
mod ports;
pub(crate) mod runtime;
pub(crate) mod transport;

use adapters::ProcessAgentCliProbe;
pub(crate) use application::AgentsUseCases;
pub(crate) type AgentsFeature = AgentsUseCases<ProcessAgentCliProbe>;

pub(crate) fn compose() -> AgentsFeature {
    AgentsUseCases::new(ProcessAgentCliProbe)
}

#[cfg(test)]
pub(crate) fn assert_agent_cli_probe_contract() {
    adapters::assert_agent_cli_probe_contract();
    transport::assert_agent_transport_contract();
}
