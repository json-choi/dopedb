//! Feature-scoped SQLite repository implementations owned by the local store.

mod analysis_run_identity;
mod catalog;
mod connections;
mod history;
mod safety;
mod workspaces;

pub(super) use safety::{ensure_safety_row, reconcile_safety_write_ceiling};
pub(super) use workspaces::{
    account_scope_from_parts, bump_active_scope_generation, parse_scope_generation,
    repair_active_scope_on_open,
};
mod analysis_articles;
