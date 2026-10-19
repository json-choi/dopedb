//! Catalog-pinned dialect-neutral DDL planning.
//!
//! Structured editors submit [`SchemaChangeRequest`] values. This module validates
//! them against the exact canonical Catalog snapshot and renders a complete,
//! reviewable plan without executing target-database mutations.

pub(crate) mod common;
mod mysql;
mod postgres;
mod sqlite;
mod validate;

use dopedb_protocol::{CatalogSnapshot, DatabaseEngine, DdlPlan, SchemaChangeRequest};

use crate::error::{AppError, AppResult};

/// Validate and render one exact schema change.
pub(crate) fn render(
    snapshot: &CatalogSnapshot,
    request: &SchemaChangeRequest,
) -> AppResult<DdlPlan> {
    validate::request(snapshot, request)?;
    match snapshot.engine() {
        DatabaseEngine::Postgres => postgres::render(snapshot, request),
        DatabaseEngine::Mysql => mysql::render(snapshot, request),
        DatabaseEngine::Sqlite => sqlite::render(snapshot, request),
        DatabaseEngine::Mongodb => Err(AppError::Blocked {
            reason: "relational DDL is unavailable for document databases".into(),
        }),
        DatabaseEngine::Bigquery => Err(AppError::Blocked {
            reason: "BigQuery DDL is unavailable through the read-only adapter".into(),
        }),
    }
}
