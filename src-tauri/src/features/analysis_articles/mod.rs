//! Analysis Article vertical slice and adapter composition boundary.

pub(crate) mod adapters;
mod domain;
mod facade;
mod ports;
mod runner;
pub(crate) mod transport;
mod validation;

use crate::connection::ConnectionManager;
use crate::features::knowledge::KnowledgeFeature;
use crate::store::Store;

pub(crate) use domain::{
    deserialize_local_result, AnalysisDefinitionRunReceipt, AnalysisDefinitionRunRequest,
};
#[cfg(test)]
pub(crate) use runner::assert_runner_safety_contract;

pub(crate) type DesktopAnalysisArticlesFeature = facade::AnalysisArticlesFeature<
    adapters::SqliteAnalysisLocalRepository,
    adapters::DesktopAnalysisReadExecution,
    adapters::HostedAnalysisAuthority,
>;

pub(crate) fn compose(
    store: Store,
    connections: ConnectionManager,
    knowledge: KnowledgeFeature,
) -> DesktopAnalysisArticlesFeature {
    facade::AnalysisArticlesFeature::new(
        adapters::SqliteAnalysisLocalRepository::new(store.clone()),
        adapters::DesktopAnalysisReadExecution::new(store, connections, knowledge),
        adapters::HostedAnalysisAuthority,
    )
}
