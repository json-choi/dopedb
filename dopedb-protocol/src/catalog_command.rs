//! Typed catalog, schema, and relation command payloads.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AuthenticationRequirement, CatalogSnapshot, CommandName, CommandSpec, ConnectionSelector,
    DatabaseEngine, ObjectKind, ObjectRef, Relation,
};

pub const MAX_CATALOG_SEARCH_QUERY_BYTES: usize = 256;
pub const MAX_CATALOG_SEARCH_KINDS: usize = 8;
pub const MAX_CATALOG_SEARCH_MATCHES: u32 = 50;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogArguments {
    pub connection: ConnectionSelector,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseListArguments {
    pub connection: ConnectionSelector,
}

pub struct DatabaseListCommand;

impl CommandSpec for DatabaseListCommand {
    type Arguments = DatabaseListArguments;
    type Result = DatabaseListResult;

    const NAME: CommandName = CommandName::DatabaseList;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseSummary {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseListResult {
    pub connection_id: Uuid,
    pub databases: Vec<DatabaseSummary>,
}

pub struct CatalogShowCommand;

impl CommandSpec for CatalogShowCommand {
    type Arguments = CatalogArguments;
    type Result = CatalogSnapshot;

    const NAME: CommandName = CommandName::CatalogShow;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSearchArguments {
    pub connection: ConnectionSelector,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    pub query: String,
    #[serde(default)]
    pub kinds: Vec<ObjectKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

pub struct CatalogSearchCommand;

impl CommandSpec for CatalogSearchCommand {
    type Arguments = CatalogSearchArguments;
    type Result = CatalogSearchResult;

    const NAME: CommandName = CommandName::CatalogSearch;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogSearchMatchType {
    Relation,
    Routine,
    Object,
}

/// One intentionally compact catalog match. Detailed relation metadata stays behind
/// `table.describe`, so a large schema can never overflow the Broker response merely
/// because the Agent searched it. The bounded comment and row estimate let a caller
/// skip empty or deprecated look-alike relations without describing each one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSearchMatch {
    pub match_type: CatalogSearchMatchType,
    pub qualified_name: String,
    pub object: ObjectRef,
    #[serde(default)]
    pub matched_fields: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_estimate: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSearchResult {
    pub connection_id: Uuid,
    pub engine: DatabaseEngine,
    pub database: String,
    pub captured_at: DateTime<Utc>,
    pub fingerprint: String,
    pub query: String,
    pub total_matches: u64,
    pub truncated: bool,
    pub matches: Vec<CatalogSearchMatch>,
}

pub struct SchemaListCommand;

impl CommandSpec for SchemaListCommand {
    type Arguments = CatalogArguments;
    type Result = SchemaListResult;

    const NAME: CommandName = CommandName::SchemaList;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaSummary {
    pub name: String,
    pub relation_count: u64,
    pub routine_count: u64,
    pub object_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaListResult {
    pub connection_id: Uuid,
    pub database: String,
    pub schemas: Vec<SchemaSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableDescribeArguments {
    pub connection: ConnectionSelector,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    pub table: String,
}

pub struct TableDescribeCommand;

impl CommandSpec for TableDescribeCommand {
    type Arguments = TableDescribeArguments;
    type Result = TableDescribeResult;

    const NAME: CommandName = CommandName::TableDescribe;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableDescribeResult {
    pub connection_id: Uuid,
    pub database: String,
    pub relation: Relation,
}
