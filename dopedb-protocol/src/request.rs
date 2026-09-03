//! Versioned request envelope and command names for the local broker.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;
use zeroize::Zeroizing;

/// Version-17 command catalog. Any addition, removal, or meaning change requires a
/// command-schema version bump and an explicitly negotiated compatibility range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CommandName {
    #[serde(rename = "version")]
    Version,
    #[serde(rename = "status")]
    Status,
    #[serde(rename = "app.open")]
    AppOpen,
    #[serde(rename = "skills.list")]
    SkillsList,
    #[serde(rename = "skills.get")]
    SkillsGet,
    #[serde(rename = "skill.status")]
    SkillStatus,
    #[serde(rename = "skill.install")]
    SkillInstall,
    #[serde(rename = "skill.repair")]
    SkillRepair,
    #[serde(rename = "skill.remove")]
    SkillRemove,
    #[serde(rename = "agent.session.register")]
    AgentSessionRegister,
    #[serde(rename = "agent.config.create")]
    ExternalAgentConfigCreate,
    #[serde(rename = "agent.external_session.start")]
    ExternalAgentSessionStart,
    #[serde(rename = "agent.external_session.revoke")]
    ExternalAgentSessionRevoke,
    #[serde(rename = "connection.list")]
    ConnectionList,
    #[serde(rename = "connection.show")]
    ConnectionShow,
    #[serde(rename = "connection.test")]
    ConnectionTest,
    #[serde(rename = "database.list")]
    DatabaseList,
    #[serde(rename = "catalog.show")]
    CatalogShow,
    #[serde(rename = "catalog.search")]
    CatalogSearch,
    #[serde(rename = "schema.list")]
    SchemaList,
    #[serde(rename = "table.describe")]
    TableDescribe,
    #[serde(rename = "document.run")]
    DocumentRun,
    #[serde(rename = "query.plan")]
    QueryPlan,
    #[serde(rename = "query.run")]
    QueryRun,
    #[serde(rename = "query.cancel")]
    QueryCancel,
    #[serde(rename = "analysis_article.propose")]
    AnalysisArticlePropose,
    #[serde(rename = "analysis_article.update")]
    AnalysisArticleUpdate,
    #[serde(rename = "analysis_article.verify")]
    AnalysisArticleVerify,
    #[serde(rename = "analysis_article.list")]
    AnalysisArticleList,
    #[serde(rename = "sql.propose")]
    SqlPropose,
    #[serde(rename = "operation.show")]
    OperationShow,
    #[serde(rename = "operation.wait")]
    OperationWait,
    #[serde(rename = "operation.cancel")]
    OperationCancel,
    #[serde(rename = "knowledge.search")]
    KnowledgeSearch,
    #[serde(rename = "source.search")]
    SourceSearch,
    #[serde(rename = "source.read")]
    SourceRead,
    #[serde(rename = "knowledge.explain")]
    KnowledgeExplain,
    #[serde(rename = "knowledge.neighbors")]
    KnowledgeNeighbors,
    #[serde(rename = "knowledge.path")]
    KnowledgePath,
    #[serde(rename = "knowledge.evidence")]
    KnowledgeEvidence,
    #[serde(rename = "knowledge.diff")]
    KnowledgeDiff,
    #[serde(rename = "funnel.trace")]
    FunnelTrace,
    #[serde(rename = "environment.context")]
    EnvironmentContext,
    #[serde(rename = "knowledge.mapping.propose")]
    KnowledgeMappingPropose,
    /// Preserve envelope decodability long enough to return a stable schema/version
    /// error to a newer client. Unknown command payloads are never dispatched.
    #[serde(other)]
    Unknown,
}

impl CommandName {
    pub const ALL: [Self; 44] = [
        Self::Version,
        Self::Status,
        Self::AppOpen,
        Self::SkillsList,
        Self::SkillsGet,
        Self::SkillStatus,
        Self::SkillInstall,
        Self::SkillRepair,
        Self::SkillRemove,
        Self::AgentSessionRegister,
        Self::ExternalAgentConfigCreate,
        Self::ExternalAgentSessionStart,
        Self::ExternalAgentSessionRevoke,
        Self::ConnectionList,
        Self::ConnectionShow,
        Self::ConnectionTest,
        Self::DatabaseList,
        Self::CatalogShow,
        Self::CatalogSearch,
        Self::SchemaList,
        Self::TableDescribe,
        Self::DocumentRun,
        Self::QueryPlan,
        Self::QueryRun,
        Self::QueryCancel,
        Self::AnalysisArticlePropose,
        Self::AnalysisArticleUpdate,
        Self::AnalysisArticleVerify,
        Self::AnalysisArticleList,
        Self::SqlPropose,
        Self::OperationShow,
        Self::OperationWait,
        Self::OperationCancel,
        Self::KnowledgeSearch,
        Self::SourceSearch,
        Self::SourceRead,
        Self::KnowledgeExplain,
        Self::KnowledgeNeighbors,
        Self::KnowledgePath,
        Self::KnowledgeEvidence,
        Self::KnowledgeDiff,
        Self::FunnelTrace,
        Self::EnvironmentContext,
        Self::KnowledgeMappingPropose,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Version => "version",
            Self::Status => "status",
            Self::AppOpen => "app.open",
            Self::SkillsList => "skills.list",
            Self::SkillsGet => "skills.get",
            Self::SkillStatus => "skill.status",
            Self::SkillInstall => "skill.install",
            Self::SkillRepair => "skill.repair",
            Self::SkillRemove => "skill.remove",
            Self::AgentSessionRegister => "agent.session.register",
            Self::ExternalAgentConfigCreate => "agent.config.create",
            Self::ExternalAgentSessionStart => "agent.external_session.start",
            Self::ExternalAgentSessionRevoke => "agent.external_session.revoke",
            Self::ConnectionList => "connection.list",
            Self::ConnectionShow => "connection.show",
            Self::ConnectionTest => "connection.test",
            Self::DatabaseList => "database.list",
            Self::CatalogShow => "catalog.show",
            Self::CatalogSearch => "catalog.search",
            Self::SchemaList => "schema.list",
            Self::TableDescribe => "table.describe",
            Self::DocumentRun => "document.run",
            Self::QueryPlan => "query.plan",
            Self::QueryRun => "query.run",
            Self::QueryCancel => "query.cancel",
            Self::AnalysisArticlePropose => "analysis_article.propose",
            Self::AnalysisArticleUpdate => "analysis_article.update",
            Self::AnalysisArticleVerify => "analysis_article.verify",
            Self::AnalysisArticleList => "analysis_article.list",
            Self::SqlPropose => "sql.propose",
            Self::OperationShow => "operation.show",
            Self::OperationWait => "operation.wait",
            Self::OperationCancel => "operation.cancel",
            Self::KnowledgeSearch => "knowledge.search",
            Self::SourceSearch => "source.search",
            Self::SourceRead => "source.read",
            Self::KnowledgeExplain => "knowledge.explain",
            Self::KnowledgeNeighbors => "knowledge.neighbors",
            Self::KnowledgePath => "knowledge.path",
            Self::KnowledgeEvidence => "knowledge.evidence",
            Self::KnowledgeDiff => "knowledge.diff",
            Self::FunnelTrace => "funnel.trace",
            Self::EnvironmentContext => "environment.context",
            Self::KnowledgeMappingPropose => "knowledge.mapping.propose",
            Self::Unknown => "unknown",
        }
    }
}

impl fmt::Display for CommandName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Terminal-scoped broker authentication. Normal Terminal requests carry an
/// ephemeral bearer token. Agent MCP descendants instead omit the token and are
/// authenticated against the OS process tree registered by the token-bearing ACP
/// launcher. The Debug representation never reveals a bearer token.
#[derive(PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionAuthentication {
    pub terminal_session_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token: Option<Zeroizing<String>>,
}

impl SessionAuthentication {
    pub fn new(terminal_session_id: Uuid, token: impl Into<String>) -> Self {
        Self {
            terminal_session_id,
            token: Some(Zeroizing::new(token.into())),
        }
    }

    /// Construct authentication from an already protected allocation without
    /// introducing a second ordinary heap copy of the bearer.
    pub fn from_zeroizing_token(terminal_session_id: Uuid, token: Zeroizing<String>) -> Self {
        Self {
            terminal_session_id,
            token: Some(token),
        }
    }

    pub fn process_bound(terminal_session_id: Uuid) -> Self {
        Self {
            terminal_session_id,
            token: None,
        }
    }

    pub fn token(&self) -> Option<&str> {
        self.token.as_deref().map(String::as_str)
    }
}

impl fmt::Debug for SessionAuthentication {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionAuthentication")
            .field("terminal_session_id", &self.terminal_session_id)
            .field(
                "authentication_kind",
                &if self.token.is_some() {
                    "bearer"
                } else {
                    "process-bound"
                },
            )
            .finish()
    }
}

/// One length-prefixed broker control request.
#[derive(PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestEnvelope {
    pub protocol_version: u16,
    pub command_schema_version: u16,
    pub request_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authentication: Option<SessionAuthentication>,
    pub command: CommandName,
    #[serde(default)]
    pub arguments: Value,
}

impl fmt::Debug for RequestEnvelope {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RequestEnvelope")
            .field("protocol_version", &self.protocol_version)
            .field("command_schema_version", &self.command_schema_version)
            .field("request_id", &self.request_id)
            .field("authentication", &self.authentication)
            .field("command", &self.command)
            .field("arguments", &"<redacted>")
            .finish()
    }
}
