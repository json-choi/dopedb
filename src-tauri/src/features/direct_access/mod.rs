//! Direct shared database principals.
//!
//! A workspace can share a PostgreSQL or MySQL server directly by provisioning one
//! DopeDB-owned principal per member. This slice owns the transport-neutral
//! rules (`domain`, `verifier`, `plan`, `ownership`: engine/version gate, scope and
//! level types, principal naming, public password verifiers, the fixed SQL plan
//! templates, and the ownership proof before any ALTER/REVOKE/DROP), the use cases
//! over ports (`application`, `sync`, `revocation`), their adapters, the
//! administrator-device `worker`, and the IPC `transport`.

mod adapters;
mod application;
pub(crate) mod domain;
pub(crate) mod ownership;
pub(crate) mod plan;
mod ports;
mod revocation;
mod sync;
pub(crate) mod transport;
mod types;
pub(crate) mod verifier;
mod worker;

use std::sync::Arc;

use adapters::{
    HostedDirectControlPlane, KeyringAdminCredentialVault, SqlxTargetDatabase, StoreDirectLocal,
};
pub(crate) use application::DirectAccessUseCases;

use crate::features::connections::ConnectionCredentialVault;
use crate::store::Store;

pub(crate) type DirectAccessFeature = DirectAccessUseCases<
    KeyringAdminCredentialVault,
    SqlxTargetDatabase,
    HostedDirectControlPlane,
    StoreDirectLocal,
>;

pub(crate) fn compose(
    store: Store,
    credentials: Arc<dyn ConnectionCredentialVault>,
) -> DirectAccessFeature {
    DirectAccessUseCases::new(
        KeyringAdminCredentialVault,
        SqlxTargetDatabase,
        HostedDirectControlPlane::default(),
        StoreDirectLocal::new(store, credentials),
    )
}

#[cfg(test)]
mod application_contract;
#[cfg(test)]
mod contract;

#[cfg(test)]
pub(crate) use contract::assert_direct_access_contract;
