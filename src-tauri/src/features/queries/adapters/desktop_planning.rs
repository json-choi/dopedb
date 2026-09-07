//! Durable desktop and Terminal SQL proposal planning adapter operations.

use chrono::{Duration as ChronoDuration, Utc};
use uuid::Uuid;

use crate::error::AppError;
use crate::kernel::agent_policy::QUERY_PLAN_TTL;
use crate::kernel::identity::OperationId;
use crate::kernel::TerminalAuthority;
use crate::model::QueryKind;
use crate::operations::{
    actor_for_pin, agent_actor_for_pin, required_confirmation, NewOperation,
    OperationPlanDisposition,
};
use crate::safety;

use super::super::domain::{
    DesktopPreviewIntent, DesktopSqlInspectionRequest, DesktopSqlProposalRequest,
    TerminalSqlProposalRequest,
};
use super::desktop_contracts::{
    DesktopSqlInspectionError, DesktopSqlProposalReceipt, StoredDesktopSqlPayload,
    DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION,
};
use super::desktop_support::{operation_kind, operation_risk};
use super::platform::QueryPlatformAdapter;

impl QueryPlatformAdapter {
    pub(crate) async fn propose_desktop_sql(
        &self,
        request: DesktopSqlProposalRequest,
    ) -> Result<DesktopSqlProposalReceipt, DesktopSqlInspectionError> {
        self.propose_sql(request, None).await
    }

    pub(crate) async fn propose_terminal_sql(
        &self,
        request: TerminalSqlProposalRequest,
    ) -> Result<DesktopSqlProposalReceipt, DesktopSqlInspectionError> {
        self.propose_sql(
            DesktopSqlProposalRequest {
                connection_id: request.connection_id,
                sql: request.sql,
                database: request.database,
                namespace: None,
                origin: Some("cli".into()),
            },
            Some(request.authority),
        )
        .await
    }

    async fn propose_sql(
        &self,
        request: DesktopSqlProposalRequest,
        terminal: Option<TerminalAuthority>,
    ) -> Result<DesktopSqlProposalReceipt, DesktopSqlInspectionError> {
        let inspection = self
            .inspect_sql(
                DesktopSqlInspectionRequest {
                    connection_id: request.connection_id,
                    sql: request.sql.clone(),
                    database: request.database,
                    namespace: request.namespace,
                    intent: DesktopPreviewIntent::ImpactPreview,
                },
                terminal.as_ref(),
            )
            .await?;
        let pin = inspection.pin.clone();
        let classification = inspection.classification.clone();
        let is_write = !matches!(classification.kind, QueryKind::Read);

        let access_allowed = match classification.kind {
            QueryKind::Read => pin.profile.workspace_access.can_read(),
            QueryKind::Ddl => pin.profile.workspace_access.can_manage(),
            QueryKind::Write | QueryKind::Privilege => pin.profile.workspace_access.can_write(),
        };
        if !access_allowed {
            return Err(inspection.into_error(AppError::Blocked {
                reason: if classification.kind == QueryKind::Ddl {
                    "your workspace role does not permit schema changes".into()
                } else {
                    "your workspace role grants read-only database access".into()
                },
            }));
        }
        let settings = match inspection
            .policy_snapshot
            .get("safety")
            .cloned()
            .ok_or_else(|| AppError::Config("inspection policy is missing safety settings".into()))
            .and_then(|value| serde_json::from_value(value).map_err(AppError::from))
        {
            Ok(settings) => settings,
            Err(error) => return Err(inspection.into_error(error)),
        };
        if let safety::GateDecision::Block { reason } = safety::decide(&settings, &classification) {
            if classification.kind == QueryKind::Privilege {
                return Err(inspection.into_error(AppError::SqlPolicyBlocked { position: Some(1) }));
            }
            return Err(inspection.into_error(AppError::Blocked { reason }));
        }
        let history_origin = request.origin.unwrap_or_else(|| "manual".into());
        let payload = match serde_json::to_value(StoredDesktopSqlPayload {
            sql: request.sql,
            history_origin: history_origin.clone(),
            database: inspection.database.clone(),
            namespace: inspection.namespace.clone(),
        })
        .map_err(AppError::from)
        {
            Ok(payload) => payload,
            Err(error) => return Err(inspection.into_error(error)),
        };
        let preview = match serde_json::to_value(&inspection.report).map_err(AppError::from) {
            Ok(preview) => preview,
            Err(error) => return Err(inspection.into_error(error)),
        };
        let operation_id = OperationId::from(Uuid::new_v4());
        let expires_at = Utc::now()
            + if is_write {
                ChronoDuration::minutes(5)
            } else {
                ChronoDuration::from_std(QUERY_PLAN_TTL)
                    .expect("query plan TTL is representable by chrono")
            };
        let disposition = if is_write {
            OperationPlanDisposition::ApprovalRequired
        } else {
            OperationPlanDisposition::Ready
        };
        let actor = if let Some(authority) = terminal.as_ref() {
            let mut actor = agent_actor_for_pin(&pin, "cli".into(), "cli".into());
            actor.provenance.client_protocol_version = Some(authority.client_protocol_version);
            actor
        } else {
            actor_for_pin(&pin, history_origin)
        };
        let operation = self
            .operation
            .plan(
                NewOperation {
                    id: operation_id.into(),
                    workspace_id: pin.scope.workspace_id,
                    account_scope: pin.scope.account_scope.storage_key().into(),
                    connection_id: pin.connection_id,
                    connection_revision: pin.connection_revision,
                    terminal_session_id: terminal
                        .as_ref()
                        .map(|authority| authority.terminal_session_id.into()),
                    actor,
                    kind: operation_kind(classification.kind),
                    payload_schema_version: DESKTOP_SQL_PAYLOAD_SCHEMA_VERSION,
                    payload,
                    schema_fingerprint: None,
                    risk_level: operation_risk(&classification),
                    preview,
                    policy_snapshot: inspection.policy_snapshot.clone(),
                    policy_revision: inspection.policy_revision.clone(),
                    single_use: true,
                    idempotency_key: operation_id.to_string(),
                    expires_at: Some(expires_at),
                },
                disposition,
            )
            .await;
        let operation = match operation {
            Ok(operation) => operation,
            Err(error) => return Err(inspection.into_error(error)),
        };
        let confirmation_phrase = required_confirmation(&operation).map(str::to_owned);

        Ok(DesktopSqlProposalReceipt {
            operation_id: operation.id.into(),
            payload_hash: operation.payload_hash,
            state: operation.state,
            approval_required: is_write,
            auto_run: !is_write && settings.auto_run_reads,
            confirmation_phrase,
            expires_at,
            classification: inspection.classification.clone(),
            preview: inspection.report.clone(),
        })
    }
}
