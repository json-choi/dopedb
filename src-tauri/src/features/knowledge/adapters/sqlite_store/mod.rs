//! Aggregate-owned SQLite statements for the Project Knowledge adapter.
//!
//! These modules extend Store only inside the Knowledge adapter. The sibling
//! sqlite facade is the sole production caller exposed to the application.

mod access;
mod codec;
mod projects;
mod scopes;
