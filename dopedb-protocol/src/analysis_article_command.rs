//! Exact Agent/Broker commands for the Analysis Article domain.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AnalysisArticleInputDefinition, AnalysisArticleRecord, AnalysisRunReceipt,
    AuthenticationRequirement, CommandName, CommandSpec,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArticleProposeArguments {
    pub connection_id: Uuid,
    pub definition: AnalysisArticleInputDefinition,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArticleUpdateArguments {
    pub article_id: Uuid,
    pub expected_revision: i64,
    pub connection_id: Uuid,
    pub definition: AnalysisArticleInputDefinition,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArticleVerifyArguments {
    pub connection_id: Uuid,
    pub definition: AnalysisArticleInputDefinition,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArticleRecordResult {
    pub article: AnalysisArticleRecord,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisArticleListResult {
    pub articles: Vec<AnalysisArticleRecord>,
}

pub struct AnalysisArticleProposeCommand;
pub struct AnalysisArticleUpdateCommand;
pub struct AnalysisArticleVerifyCommand;
pub struct AnalysisArticleListCommand;

macro_rules! analysis_article_command {
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

analysis_article_command!(
    AnalysisArticleProposeCommand,
    AnalysisArticleProposeArguments,
    AnalysisArticleRecordResult,
    CommandName::AnalysisArticlePropose
);
analysis_article_command!(
    AnalysisArticleUpdateCommand,
    AnalysisArticleUpdateArguments,
    AnalysisArticleRecordResult,
    CommandName::AnalysisArticleUpdate
);
analysis_article_command!(
    AnalysisArticleVerifyCommand,
    AnalysisArticleVerifyArguments,
    AnalysisRunReceipt,
    CommandName::AnalysisArticleVerify
);
analysis_article_command!(
    AnalysisArticleListCommand,
    crate::EmptyArguments,
    AnalysisArticleListResult,
    CommandName::AnalysisArticleList
);
