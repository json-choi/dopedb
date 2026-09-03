//! Signed ACP adapter plugin installation and bundled Node runtime verification.

mod archive;
mod domain;
mod manager;
mod verification;

pub(crate) use domain::{AcpPluginMutationReceipt, AcpPluginStatus};
pub(crate) use manager::AcpPluginManager;

#[cfg(test)]
pub(crate) fn assert_acp_plugin_runtime_contract() {
    archive::assert_archive_security_contract();
    manager::assert_candidate_fallback_contract();
    manager::assert_catalog_release_contract();
    manager::assert_installation_identity_contract();
}
