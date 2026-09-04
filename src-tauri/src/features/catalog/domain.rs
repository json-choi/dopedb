//! Catalog wire values and read policy.
//!
//! These values stay independent from Tauri, SQLx, connection pools, and the
//! introspection implementation. Current IPC values use one exact shape.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CatalogReadPolicy {
    CacheFirst,
    Refresh,
}

/// One database the current credential can reach through a server connection.
///
/// The configured database is always retained as the default even when the server
/// cannot enumerate peers. Names are target identifiers only; credentials and
/// connection fields never travel in this projection.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSummary {
    pub name: String,
    pub is_default: bool,
}

/// The intentionally bounded shape returned by the workspace connection tree.
///
/// An overview is a complete relation tree, not a partial `Catalog` snapshot.
/// Detailed metadata remains deferred until a consumer requests the full catalog.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogOverviewDetailState {
    /// Columns, constraints, indexes, estimates, and auxiliary objects were not read.
    #[default]
    Deferred,
}

/// Stable reference used to express a relation's parent in the overview tree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogOverviewRelationRef {
    pub schema: Option<String>,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub native_id: Option<String>,
}

/// One relation in the bounded relation tree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogOverviewRelation {
    pub schema: Option<String>,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub native_id: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub row_estimate: Option<i64>,
    #[serde(default)]
    pub parent: Option<CatalogOverviewRelationRef>,
}

/// Complete, basic relation tree for a connection.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogOverview {
    /// Exact target database used for this overview.
    pub database: String,
    /// Namespaces visible inside the profile's configured database. This list is
    /// independent of relations so empty PostgreSQL schemas remain selectable.
    #[serde(default)]
    pub namespaces: Vec<String>,
    pub relations: Vec<CatalogOverviewRelation>,
    #[serde(default)]
    pub detail_state: CatalogOverviewDetailState,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub pk: bool,
    #[serde(default)]
    pub ordinal: u32,
    #[serde(default)]
    pub length: Option<u64>,
    #[serde(default)]
    pub precision: Option<u32>,
    #[serde(default)]
    pub scale: Option<u32>,
    #[serde(default)]
    pub default_expression: Option<String>,
    #[serde(default)]
    pub generated_expression: Option<String>,
    #[serde(default)]
    pub identity: bool,
    #[serde(default)]
    pub auto_increment: bool,
    #[serde(default)]
    pub collation: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKey {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub ordinal: u32,
    pub column: String,
    pub references_table: String,
    pub references_column: String,
    #[serde(default)]
    pub references_schema: Option<String>,
    #[serde(default)]
    pub update_action: Option<String>,
    #[serde(default)]
    pub delete_action: Option<String>,
    #[serde(default)]
    pub deferrable: bool,
    #[serde(default = "default_true")]
    pub validated: bool,
}

impl Default for ForeignKey {
    fn default() -> Self {
        Self {
            name: None,
            ordinal: 0,
            column: String::new(),
            references_table: String::new(),
            references_column: String::new(),
            references_schema: None,
            update_action: None,
            delete_action: None,
            deferrable: false,
            validated: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub keys: Vec<dopedb_protocol::catalog::IndexKey>,
    #[serde(default)]
    pub included_columns: Vec<String>,
    #[serde(default)]
    pub predicate: Option<String>,
    #[serde(default = "default_true")]
    pub valid: bool,
}

impl Default for Index {
    fn default() -> Self {
        Self {
            name: String::new(),
            columns: Vec::new(),
            unique: false,
            method: None,
            keys: Vec::new(),
            included_columns: Vec::new(),
            predicate: None,
            valid: true,
        }
    }
}

const fn default_true() -> bool {
    true
}

fn default_kind() -> String {
    "table".into()
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    #[serde(default)]
    pub database: Option<String>,
    pub schema: Option<String>,
    pub name: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub native_id: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub partition_parent: Option<dopedb_protocol::catalog::ObjectRef>,
    #[serde(default)]
    pub partition_children: Vec<dopedb_protocol::catalog::ObjectRef>,
    pub columns: Vec<Column>,
    pub foreign_keys: Vec<ForeignKey>,
    #[serde(default)]
    pub constraints: Vec<dopedb_protocol::catalog::Constraint>,
    #[serde(default)]
    pub indexes: Vec<Index>,
    pub row_estimate: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObject {
    pub schema: Option<String>,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub native_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub return_type: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub tables: Vec<Table>,
    #[serde(default)]
    pub objects: Vec<DatabaseObject>,
}
