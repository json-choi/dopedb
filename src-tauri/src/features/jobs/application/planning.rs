use dopedb_protocol::{OperationKind, OperationRiskLevel, OperationState};
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::features::jobs::{
    summaries, validate_mapping_sources, validate_plan, validate_required_target_columns,
    CreateJobRequest, Job, JobDetail, JobFileDirection, JobFormat, JobKind, JobPlan, JobProposal,
    JobSqlAudit,
};
use crate::kernel::identity::{ConnectionId, ConnectionJobId};
use crate::model::Engine;
use crate::operations::{
    canonical_hash, required_confirmation, NewOperation, OperationPlanDisposition,
};

use super::super::ports::{
    JobAuthorityGuard, JobAuthorityPort, JobCatalogPort, JobExecutionPort, JobFilePort,
    JobGeneratorPort, JobLedgerPort, JobOperationPort, JobPermission, NewJob,
};
use super::JobUseCases;

impl<L, A, F, C, O, E, G> JobUseCases<L, A, F, C, O, E, G>
where
    L: JobLedgerPort,
    A: JobAuthorityPort,
    F: JobFilePort,
    C: JobCatalogPort,
    O: JobOperationPort,
    E: JobExecutionPort<O::Claim>,
    G: JobGeneratorPort,
{
    pub(crate) async fn create(&self, request: CreateJobRequest) -> AppResult<JobProposal> {
        let kind = request.plan.kind();
        let permission = if kind == JobKind::Import {
            JobPermission::Write
        } else {
            JobPermission::Read
        };
        let guard = self
            .authority
            .authorize(request.connection_id, permission)
            .await?;
        let authority = guard.authority();
        if authority.engine.is_document() {
            return Err(AppError::Blocked {
                reason:
                    "document databases require the typed document job adapter; SQL-family jobs cannot be used for this connection"
                        .into(),
            });
        }
        if authority.engine == Engine::Bigquery {
            return Err(AppError::Blocked {
                reason: "BigQuery bulk import/export jobs are unavailable; export a bounded query result instead"
                    .into(),
            });
        }
        let operation_context = self
            .authority
            .operation_context(&guard, "job_engine")
            .await?;
        if kind == JobKind::Import {
            if !authority.workspace_access.can_write() {
                return Err(AppError::Blocked {
                    reason: "your workspace role grants read-only database access".into(),
                });
            }
            if !operation_context.safety.allow_writes {
                return Err(AppError::Blocked {
                    reason: "writes are disabled for this connection; enable them before importing"
                        .into(),
                });
            }
        }
        let direction = if kind == JobKind::Import {
            JobFileDirection::Input
        } else {
            JobFileDirection::Output
        };
        let capability = self
            .ledger
            .resolve_capability(authority, request.plan.capability_id(), direction, None)
            .await?;
        let (input_inspection, sql_audit) = if kind == JobKind::Import {
            let path = capability.path.clone();
            let format = request.format;
            let engine = authority.engine;
            let expected_hash = capability
                .source_sha256
                .clone()
                .ok_or_else(|| AppError::Config("input capability has no source hash".into()))?;
            let review = self
                .files
                .review_input(path, format, engine, expected_hash)
                .await?;
            (Some(review.inspection), review.sql_audit)
        } else {
            (None, None)
        };
        // A SQL import that creates, alters, or drops objects is a schema change:
        // it needs the same `manage` grant and device DDL opt-in as a DDL proposal.
        if sql_audit.as_ref().is_some_and(|audit| audit.ddl_count > 0) {
            if !authority.workspace_access.can_manage() {
                return Err(AppError::Blocked {
                    reason: "your workspace role does not permit schema changes".into(),
                });
            }
            if !operation_context.safety.allow_schema_changes {
                return Err(AppError::Blocked {
                    reason: "schema changes are disabled for this connection; this SQL import contains DDL. Enable schema changes in Safety settings to import it."
                        .into(),
                });
            }
        }
        let snapshot = self.catalog.refresh(request.connection_id).await?;
        validate_plan(&request, &snapshot)?;
        if let (
            Some(inspection),
            JobPlan::Import {
                mapping,
                target_relation: Some(_),
                ..
            },
        ) = (&input_inspection, &request.plan)
        {
            validate_mapping_sources(mapping, &inspection.fields)?;
            validate_required_target_columns(&request.plan, &snapshot, &inspection.fields)?;
        }
        let plan_value = serde_json::to_value(&request.plan)?;
        let plan_hash = canonical_hash(&plan_value)?;
        let job_id = self.generator.next_job_id();
        let operation_id = self.generator.next_operation_id();
        let (source_summary, target_summary) = summaries(&request.plan, &capability.display_name);
        let operation_kind = if kind == JobKind::Import {
            OperationKind::Import
        } else {
            OperationKind::Export
        };
        let risk = if kind == JobKind::Export {
            OperationRiskLevel::Low
        } else if request.format.base() == JobFormat::Sql {
            OperationRiskLevel::Critical
        } else {
            OperationRiskLevel::High
        };
        let operation = self
            .operation
            .plan(
                NewOperation {
                    id: operation_id.into(),
                    workspace_id: authority.resource.workspace_id.into(),
                    account_scope: authority.account_scope.as_str().into(),
                    connection_id: request.connection_id.into(),
                    connection_revision: authority.connection_revision,
                    terminal_session_id: None,
                    actor: operation_context.actor,
                    kind: operation_kind,
                    payload_schema_version: 1,
                    payload: json!({
                        "format": request.format,
                        "jobId": job_id,
                        "plan": plan_value,
                        "planHash": plan_hash,
                        "sourceSha256": capability.source_sha256,
                        "sqlAudit": sql_audit.as_ref().map(|audit| json!({
                            "ddlCount": audit.ddl_count,
                            "readCount": audit.read_count,
                            "statementCount": audit.statement_count,
                            "writeCount": audit.write_count,
                        })),
                        "inputInspection": input_inspection.as_ref().map(|inspection| json!({
                            "fieldCount": inspection.fields.len(),
                            "itemCount": inspection.item_count,
                            "resumable": inspection.resumable,
                        })),
                    }),
                    schema_fingerprint: Some(snapshot.fingerprint().to_owned()),
                    risk_level: risk,
                    preview: json!({
                        "format": request.format,
                        "source": source_summary,
                        "target": target_summary,
                        "sqlAudit": sql_audit.as_ref().map(|audit| json!({
                            "ddlCount": audit.ddl_count,
                            "readCount": audit.read_count,
                            "statementCount": audit.statement_count,
                            "writeCount": audit.write_count,
                        })),
                        "inputInspection": input_inspection.as_ref().map(|inspection| json!({
                            "fieldCount": inspection.fields.len(),
                            "itemCount": inspection.item_count,
                            "resumable": inspection.resumable,
                        })),
                    }),
                    policy_snapshot: operation_context.policy_snapshot,
                    policy_revision: operation_context.policy_revision,
                    single_use: true,
                    idempotency_key: format!("job:{job_id}"),
                    expires_at: (kind == JobKind::Import)
                        .then(|| self.generator.import_operation_expires_at()),
                },
                if kind == JobKind::Import {
                    OperationPlanDisposition::ApprovalRequired
                } else {
                    OperationPlanDisposition::Ready
                },
            )
            .await?;
        let resumable = request.format.resumable()
            && !(kind == JobKind::Import && request.format.base() == JobFormat::Sql);
        let rows_total = input_inspection
            .as_ref()
            .and_then(|inspection| inspection.item_count);
        // Streaming gzip readers report decompressed progress while a file
        // capability records compressed bytes. Do not present mismatched units.
        let bytes_total = (kind == JobKind::Import && !request.format.compressed())
            .then_some(capability.size_bytes)
            .flatten();
        let inserted = self
            .ledger
            .insert_job(
                authority,
                NewJob {
                    id: job_id,
                    operation_id,
                    connection_id: request.connection_id,
                    kind,
                    format: request.format,
                    plan: request.plan,
                    source_summary,
                    target_summary,
                    rows_total,
                    bytes_total,
                    resumable,
                },
            )
            .await;
        let inserted = match inserted {
            Ok(inserted) => inserted,
            Err(error) => {
                let _ = self
                    .operation
                    .cancel_before_execution(operation_id, &json!({"reason": "job_insert_failed"}))
                    .await;
                return Err(error);
            }
        };
        Ok(JobProposal {
            job: inserted.job,
            payload_hash: operation.payload_hash.clone(),
            approval_required: kind == JobKind::Import,
            confirmation_phrase: required_confirmation(&operation).map(str::to_owned),
            sql_audit: JobSqlAudit::from_operation_value(&operation.payload),
        })
    }

    pub(crate) async fn list(&self, connection_id: ConnectionId) -> AppResult<Vec<Job>> {
        let guard = self
            .authority
            .authorize(connection_id, JobPermission::Read)
            .await?;
        self.ledger.list(guard.authority()).await
    }

    pub(crate) async fn detail(&self, scoped_id: ConnectionJobId) -> AppResult<JobDetail> {
        let ConnectionJobId {
            connection_id,
            job_id,
        } = scoped_id;
        let guard = self
            .authority
            .authorize(connection_id, JobPermission::Read)
            .await?;
        let (job, artifacts) = self.ledger.detail(guard.authority(), job_id).await?;
        let operation = self.operation.get(job.operation_id).await?;
        Ok(JobDetail {
            job,
            artifacts,
            approval_required: operation.state == OperationState::PendingApproval,
            confirmation_phrase: required_confirmation(&operation).map(str::to_owned),
            sql_audit: JobSqlAudit::from_operation_value(&operation.payload),
            payload_hash: operation.payload_hash,
            operation_state: operation.state,
        })
    }
}
