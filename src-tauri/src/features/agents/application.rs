//! Read-only Agent CLI discovery composed from an explicit platform port.

use super::domain::{AgentCliInfo, AgentProvider};
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
    /// `None` probes every provider; a list re-probes just those (for example the
    /// ones that were not ready), so a ready CLI is never spawned again.
    pub(crate) async fn detect_clis(
        &self,
        providers: Option<Vec<AgentProvider>>,
    ) -> Vec<AgentCliInfo> {
        let mut providers =
            providers.unwrap_or_else(|| vec![AgentProvider::Claude, AgentProvider::Codex]);
        providers.dedup();
        self.cli_probe.detect(providers).await
    }
}
