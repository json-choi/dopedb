//! Session-scoped Project Knowledge commands.
//!
//! Every command is authorized against the immutable graph revision set pinned
//! by Desktop when it launches the ACP session. Arguments therefore never carry
//! a workspace, project, environment, source, or grant selector.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AuthenticationRequirement, CommandName, CommandSpec, GraphRevisionDiffV1, KnowledgeEdgeV1,
    KnowledgeEvidenceV1, KnowledgeNodeV1,
};

pub const MAX_KNOWLEDGE_QUERY_BYTES: usize = 512;
pub const MAX_KNOWLEDGE_RESULTS: u32 = 50;
pub const MAX_KNOWLEDGE_NEIGHBORS: u32 = 100;
pub const MAX_KNOWLEDGE_EVIDENCE_IDS: usize = 64;
pub const MAX_KNOWLEDGE_TARGET_IDENTITY_BYTES: usize = 2_048;
pub const MAX_SOURCE_PATH_BYTES: usize = 4_096;
pub const MAX_SOURCE_READ_LINES: u32 = 400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeSearchArguments {
    pub query: String,
    #[serde(default = "default_search_limit")]
    pub limit: u32,
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
pub struct KnowledgeNodeArguments {
    pub node_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeNeighborDirection {
    Incoming,
    Outgoing,
    Both,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeNeighborsArguments {
    pub node_id: String,
    #[serde(default = "default_neighbor_direction")]
    pub direction: KnowledgeNeighborDirection,
    #[serde(default = "default_neighbor_limit")]
    pub limit: u32,
}

fn default_neighbor_direction() -> KnowledgeNeighborDirection {
    KnowledgeNeighborDirection::Both
}

fn default_neighbor_limit() -> u32 {
    30
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgePathArguments {
    pub from_node_id: String,
    pub to_node_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeEvidenceArguments {
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeDiffArguments {
    pub from_graph_revision_id: Uuid,
    pub to_graph_revision_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FunnelTraceArguments {
    pub query: String,
    #[serde(default = "default_search_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnowledgeMappingTargetKind {
    Table,
    Column,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeMappingProposeArguments {
    pub graph_revision_id: Uuid,
    pub connection_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    pub from_node_id: String,
    pub target_kind: KnowledgeMappingTargetKind,
    pub target_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeMappingProposalResult {
    pub id: Uuid,
    pub project_environment_id: Uuid,
    pub graph_revision_id: Uuid,
    pub connection_id: Uuid,
    pub connection_revision: i64,
    pub database: String,
    pub schema_fingerprint: String,
    pub from_node_id: String,
    pub target_kind: KnowledgeMappingTargetKind,
    pub target_identity: String,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeNodeMatch {
    pub graph_revision_id: Uuid,
    pub node: KnowledgeNodeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeSearchResult {
    pub graph_revision_ids: Vec<Uuid>,
    pub matches: Vec<KnowledgeNodeMatch>,
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
pub struct KnowledgeSubgraphResult {
    pub graph_revision_ids: Vec<Uuid>,
    pub nodes: Vec<KnowledgeNodeV1>,
    pub edges: Vec<KnowledgeEdgeV1>,
    pub evidence: Vec<KnowledgeEvidenceV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeEvidenceResult {
    pub graph_revision_ids: Vec<Uuid>,
    pub evidence: Vec<KnowledgeEvidenceV1>,
}

pub struct KnowledgeSearchCommand;
pub struct SourceSearchCommand;
pub struct SourceReadCommand;
pub struct KnowledgeExplainCommand;
pub struct KnowledgeNeighborsCommand;
pub struct KnowledgePathCommand;
pub struct KnowledgeEvidenceCommand;
pub struct KnowledgeDiffCommand;
pub struct FunnelTraceCommand;
pub struct EnvironmentContextCommand;
pub struct KnowledgeMappingProposeCommand;

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
    pub graph_revision_ids: Vec<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write_connection_id: Option<Uuid>,
}

macro_rules! knowledge_command {
    ($command:ty, $arguments:ty, $result:ty, $name:expr) => {
        impl CommandSpec for $command {
            type Arguments = $arguments;
            type Result = $result;

            const NAME: CommandName = $name;
            const AUTHENTICATION: AuthenticationRequirement =
                AuthenticationRequirement::TerminalSession;
        }
    };
}

knowledge_command!(
    KnowledgeSearchCommand,
    KnowledgeSearchArguments,
    KnowledgeSearchResult,
    CommandName::KnowledgeSearch
);
knowledge_command!(
    SourceSearchCommand,
    SourceSearchArguments,
    SourceSearchResult,
    CommandName::SourceSearch
);
knowledge_command!(
    SourceReadCommand,
    SourceReadArguments,
    SourceReadResult,
    CommandName::SourceRead
);
knowledge_command!(
    KnowledgeMappingProposeCommand,
    KnowledgeMappingProposeArguments,
    KnowledgeMappingProposalResult,
    CommandName::KnowledgeMappingPropose
);
knowledge_command!(
    EnvironmentContextCommand,
    crate::EmptyArguments,
    EnvironmentContextResult,
    CommandName::EnvironmentContext
);
knowledge_command!(
    KnowledgeExplainCommand,
    KnowledgeNodeArguments,
    KnowledgeSubgraphResult,
    CommandName::KnowledgeExplain
);
knowledge_command!(
    KnowledgeNeighborsCommand,
    KnowledgeNeighborsArguments,
    KnowledgeSubgraphResult,
    CommandName::KnowledgeNeighbors
);
knowledge_command!(
    KnowledgePathCommand,
    KnowledgePathArguments,
    KnowledgeSubgraphResult,
    CommandName::KnowledgePath
);
knowledge_command!(
    KnowledgeEvidenceCommand,
    KnowledgeEvidenceArguments,
    KnowledgeEvidenceResult,
    CommandName::KnowledgeEvidence
);
knowledge_command!(
    KnowledgeDiffCommand,
    KnowledgeDiffArguments,
    GraphRevisionDiffV1,
    CommandName::KnowledgeDiff
);
knowledge_command!(
    FunnelTraceCommand,
    FunnelTraceArguments,
    KnowledgeSubgraphResult,
    CommandName::FunnelTrace
);
