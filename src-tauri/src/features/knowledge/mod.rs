//! Project Knowledge composition boundary.

mod adapters;
pub(crate) mod application;
pub(crate) mod domain;
pub(crate) mod extractor;
mod facade;
mod ports;
mod reconciliation;
pub(crate) mod runtime;
mod runtime_adapter;
mod source_sync;
pub(crate) mod transport;

pub(crate) use adapters::local::LocalFolderAdapter;
pub(crate) use ports::{PinnedSourceAuthority, PinnedSourceReadRequest, PinnedSourceSearchRequest};
pub(crate) use reconciliation::{
    agent_entry_requires_hosted_reconciliation, KnowledgeAccessReconciliation,
};
pub(crate) use runtime_adapter::{KeychainKnowledgeSourceRoot, TauriKnowledgeSourceEventSink};
pub(crate) use source_sync::KnowledgeSourceSynchronizer;

pub(crate) type KnowledgeFeature = facade::KnowledgeFeature<
    adapters::SqliteKnowledgeRepository,
    adapters::HostedKnowledgeAuthority,
>;

pub(crate) fn compose(store: crate::store::Store) -> KnowledgeFeature {
    facade::KnowledgeFeature::new(
        adapters::SqliteKnowledgeRepository::new(store),
        adapters::HostedKnowledgeAuthority,
    )
}

#[cfg(test)]
pub(crate) mod test_support {
    pub(crate) use super::adapters::SqliteKnowledgeRepository;
    pub(crate) use super::ports::{
        KnowledgeGrantPort, KnowledgeGraphRepositoryPort, KnowledgeMappingRepositoryPort,
        KnowledgeRepositoryPort, KnowledgeScopeRepositoryPort,
    };
}
