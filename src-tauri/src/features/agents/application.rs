//! Read-only Agent CLI discovery composed from an explicit platform port.

use super::domain::AgentCliInfo;
use super::ports::AgentCliProbePort;

#[derive(Clone)]
pub(crate) struct AgentsUseCases<C> {
    cli_probe: C,
}

impl<C> AgentsUseCases<C>
where
    C: AgentCliProbePort,
{
    pub(crate) fn new(cli_probe: C) -> Self {
        Self { cli_probe }
    }

    /// Detect only the installed CLI's own status; provider credentials never cross this port.
    pub(crate) async fn detect_clis(&self) -> Vec<AgentCliInfo> {
        self.cli_probe.detect().await
    }
}
