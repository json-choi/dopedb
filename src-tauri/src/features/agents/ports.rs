//! Port for local CLI discovery.

use std::future::Future;

use super::domain::AgentCliInfo;

pub(crate) trait AgentCliProbePort: Clone + Send + Sync + 'static {
    fn detect(&self) -> impl Future<Output = Vec<AgentCliInfo>> + Send;
}
