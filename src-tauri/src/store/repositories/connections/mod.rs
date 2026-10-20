//! Connection persistence grouped by mutation, lookup, and batch operations.

mod grouping;
mod lookup;
mod mutations;

pub(crate) use mutations::PublishedBinding;
