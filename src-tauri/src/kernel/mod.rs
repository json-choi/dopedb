//! Small cross-feature domain primitives with no platform dependencies.

pub(crate) mod access;
pub(crate) mod agent_policy;
pub(crate) mod connection_failure;
pub(crate) mod identity;
pub(crate) mod sql_namespace;
pub(crate) mod sync;
mod terminal_authority;

pub(crate) use terminal_authority::TerminalAuthority;
