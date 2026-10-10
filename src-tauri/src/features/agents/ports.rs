//! Port for local CLI discovery.

use std::future::Future;

use super::domain::{AgentCliInfo, AgentProvider};

pub(crate) trait AgentCliProbePort: Clone + Send + Sync + 'static {
    /// Probe only the named providers' CLIs, in the given order.
    fn detect(
        &self,
        providers: Vec<AgentProvider>,
    ) -> impl Future<Output = Vec<AgentCliInfo>> + Send;
}
