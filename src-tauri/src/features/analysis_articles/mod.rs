//! Analysis Article vertical slice and adapter composition boundary.

pub(crate) mod adapters;
pub(crate) mod desktop_links;
mod domain;
mod facade;
mod html;
mod ports;
mod runner;
pub(crate) mod sharing_transport;
pub(crate) mod transport;
mod validation;

use crate::connection::ConnectionManager;
use crate::features::knowledge::KnowledgeFeature;
use crate::store::Store;

pub(crate) use domain::{
    deserialize_local_result, AnalysisArticleMutation, AnalysisArticleRevision,
    AnalysisArticleSummary, AnalysisDefinitionRunReceipt, AnalysisDefinitionRunRequest,
    AnalysisRunRecord,
};
mod personal_transport;
pub(crate) use html::sanitize_article_html;
#[cfg(test)]
pub(crate) use runner::assert_runner_safety_contract;
#[cfg(test)]
pub(crate) use runner::AnalysisArticleRunner;

pub(crate) type DesktopAnalysisArticlesFeature = facade::AnalysisArticlesFeature<
    adapters::SqliteAnalysisLocalRepository,
    adapters::DesktopAnalysisReadExecution,
    adapters::ScopedAnalysisAuthority,
>;

pub(crate) fn compose(
    store: Store,
    connections: ConnectionManager,
    knowledge: KnowledgeFeature,
) -> DesktopAnalysisArticlesFeature {
    facade::AnalysisArticlesFeature::new(
        adapters::SqliteAnalysisLocalRepository::new(store.clone()),
        adapters::DesktopAnalysisReadExecution::new(store.clone(), connections, knowledge),
        adapters::ScopedAnalysisAuthority::new(store),
    )
}
