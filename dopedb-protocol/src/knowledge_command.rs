//! File browsing and Environment context commands inside one exact Agent resource grant.

use crate::{AuthenticationRequirement, CommandName, CommandSpec};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MAX_KNOWLEDGE_QUERY_BYTES: usize = 512;
pub const MAX_KNOWLEDGE_RESULTS: u32 = 50;
pub const MAX_SOURCE_PATH_BYTES: usize = 4_096;
pub const MAX_SOURCE_READ_LINES: u32 = 400;

fn default_line_start() -> u32 {
    1
}
fn default_line_end() -> u32 {
    200
}
fn default_search_limit() -> u32 {
    20
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceSearchArguments {
    pub query: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<Uuid>,
    #[serde(default = "default_search_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceReadArguments {
    pub source_id: Uuid,
    pub path: String,
    #[serde(default = "default_line_start")]
    pub line_start: u32,
    #[serde(default = "default_line_end")]
    pub line_end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceFileMatch {
    pub source_id: Uuid,
    pub repository: String,
    pub commit_sha: String,
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceSearchResult {
    pub matches: Vec<SourceFileMatch>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceReadResult {
    pub source_id: Uuid,
    pub repository: String,
    pub commit_sha: String,
    pub path: String,
    pub line_start: u32,
    pub line_end: u32,
    pub total_lines: u32,
    pub truncated: bool,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentConnectionScope {
    pub project_environment_id: Uuid,
    pub connection_id: Uuid,
    pub connection_revision: i64,
    pub role: String,
    pub alias: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentSourceScope {
    pub project_environment_id: Uuid,
    pub source_id: Uuid,
    pub display_name: String,
    pub repository: String,
    pub ref_name: String,
    pub commit_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentRevisionScope {
    pub project_environment_id: Uuid,
    pub environment_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentContextResult {
    pub project_id: Uuid,
    pub environments: Vec<EnvironmentRevisionScope>,
    pub connections: Vec<EnvironmentConnectionScope>,
    pub sources: Vec<EnvironmentSourceScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write_connection_id: Option<Uuid>,
}

pub struct SourceSearchCommand;
impl CommandSpec for SourceSearchCommand {
    type Arguments = SourceSearchArguments;
    type Result = SourceSearchResult;
    const NAME: CommandName = CommandName::SourceSearch;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}

pub struct SourceReadCommand;
impl CommandSpec for SourceReadCommand {
    type Arguments = SourceReadArguments;
    type Result = SourceReadResult;
    const NAME: CommandName = CommandName::SourceRead;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}

pub struct EnvironmentContextCommand;
impl CommandSpec for EnvironmentContextCommand {
    type Arguments = crate::EmptyArguments;
    type Result = EnvironmentContextResult;
    const NAME: CommandName = CommandName::EnvironmentContext;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}
