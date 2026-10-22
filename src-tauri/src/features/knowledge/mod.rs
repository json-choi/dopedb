//! Project Knowledge composition boundary.

mod adapters;
pub(crate) mod domain;
mod facade;
mod ports;
mod reconciliation;
pub(crate) mod transport;

pub(crate) use ports::{PinnedSourceAuthority, PinnedSourceReadRequest, PinnedSourceSearchRequest};
pub(crate) use reconciliation::{
    agent_entry_requires_hosted_reconciliation, KnowledgeAccessReconciliation,
};

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
    pub(crate) use super::ports::{KnowledgeRepositoryPort, KnowledgeScopeRepositoryPort};
}
