//! Redacted operation lifecycle command payloads.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AuthenticationRequirement, CommandName, CommandSpec, ConnectionSelector, OperationKind,
    OperationRiskLevel, OperationState,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationArguments {
    pub operation_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<ConnectionSelector>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationWaitArguments {
    pub operation_id: Uuid,
    pub timeout_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<ConnectionSelector>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationSummary {
    pub operation_id: Uuid,
    pub connection_id: Uuid,
    pub kind: OperationKind,
    pub state: OperationState,
    pub risk_level: OperationRiskLevel,
    pub payload_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// The short reason a person gave when rejecting this exact proposal, so the
    /// proposing Agent can adjust; at most [`MAX_DECISION_REASON_CHARS`]
    /// characters. Present only for rejected operations whose reviewer wrote
    /// one; approvals never expose their confirmation text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision_reason: Option<String>,
}

/// Upper bound, in characters, of [`OperationSummary::decision_reason`].
pub const MAX_DECISION_REASON_CHARS: usize = 280;

pub struct OperationShowCommand;

impl CommandSpec for OperationShowCommand {
    type Arguments = OperationArguments;
    type Result = OperationSummary;

    const NAME: CommandName = CommandName::OperationShow;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}

pub struct OperationWaitCommand;

impl CommandSpec for OperationWaitCommand {
    type Arguments = OperationWaitArguments;
    type Result = OperationSummary;

    const NAME: CommandName = CommandName::OperationWait;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}

pub struct OperationCancelCommand;

impl CommandSpec for OperationCancelCommand {
    type Arguments = OperationArguments;
    type Result = OperationSummary;

    const NAME: CommandName = CommandName::OperationCancel;
    const AUTHENTICATION: AuthenticationRequirement = AuthenticationRequirement::TerminalSession;
}
