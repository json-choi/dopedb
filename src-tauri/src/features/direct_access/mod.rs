//! Direct shared database principals: pure rules.
//!
//! A workspace can share a PostgreSQL or MySQL server directly by provisioning one
//! DopeDB-owned principal per member. This slice owns only the transport-neutral
//! rules for that: engine/version gate, scope and level types, principal naming,
//! public password verifiers, the fixed SQL plan templates, and the ownership proof
//! that must hold before any ALTER/REVOKE/DROP. It performs no I/O and has no
//! adapters, IPC, or worker yet; later layers must interpolate only values these
//! modules validated.

// The adapters, worker, and IPC that consume these rules arrive in later phases.
#![allow(dead_code)]

pub(crate) mod domain;
pub(crate) mod ownership;
pub(crate) mod plan;
pub(crate) mod verifier;

#[cfg(test)]
mod contract;

#[cfg(test)]
pub(crate) use contract::assert_direct_access_contract;
