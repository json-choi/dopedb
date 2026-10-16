use dopedb_protocol::OperationState;
use serde_json::json;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::features::jobs::{Job, JobKind, JobSqlAudit, JobState};
use crate::kernel::identity::ConnectionJobId;

use super::super::ports::{
    JobAuthorityGuard, JobAuthorityPort, JobCatalogPort, JobExecutionPort, JobFilePort,
    JobGeneratorPort, JobLedgerPort, JobOperationPort, JobPermission, JobRecord, WorkerOutcome,
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
    pub(crate) async fn start(&self, scoped_id: ConnectionJobId) -> AppResult<Job> {
        let ConnectionJobId {
            connection_id,
            job_id,
        } = scoped_id;
        if self.running.contains_key(&job_id) {
            return Err(AppError::Blocked {
                reason: "job is already running".into(),
            });
        }
        let read_guard = self
            .authority
            .authorize(connection_id, JobPermission::Read)
            .await?;
        let current = self
            .ledger
            .get_scoped(read_guard.authority(), job_id)
            .await?;
        let operation = self.operation.get(current.job.operation_id).await?;
        let contains_ddl = JobSqlAudit::from_operation_value(&operation.payload)
            .is_some_and(|audit| audit.ddl_count > 0);
        let permission = match current.job.kind {
            JobKind::Import if contains_ddl => JobPermission::Schema,
            JobKind::Import => JobPermission::Write,
            JobKind::Export => JobPermission::Read,
        };
        let guard = self.authority.authorize(connection_id, permission).await?;
        if current.job.kind == JobKind::Import {
            // Re-check the current policy: an approved plan never outlives a
            // narrowed Safety gate or workspace grant.
            let safety = self.authority.safety(&guard).await?;
            let access = guard.authority().workspace_access;
            if !safety.allow_writes
                || !access.can_write()
                || (contains_ddl && (!safety.allow_schema_changes || !access.can_manage()))
            {
                return Err(AppError::Blocked {
                    reason: "current policy no longer allows this import".into(),
                });
            }
        }
        if operation.state == OperationState::PendingApproval {
            return Err(AppError::Blocked {
                reason: "approve the exact import plan before starting it".into(),
            });
        }
        if current.job.state == JobState::Paused && !current.job.resumable {
            return Err(AppError::Blocked {
                reason: "this file format cannot resume; create a new job".into(),
            });
        }
        if current.job.state == JobState::Paused {
            self.execution.validate_resume(&current).await?;
        }
        let running = self.ledger.claim_running(guard.authority(), job_id).await?;
        let claimed = if matches!(
            operation.state,
            OperationState::Ready | OperationState::Approved
        ) {
            self.operation.claim(operation.id.into()).await
        } else if operation.state == OperationState::Executing
            && current.job.state == JobState::Paused
        {
            self.operation
                .resume_job_claim(operation.id.into(), &operation.payload_hash)
                .await
        } else {
            Err(AppError::Blocked {
                reason: "job operation is not executable".into(),
            })
        };
        let claimed = match claimed {
            Ok(claimed) => claimed,
            Err(error) => {
                // `claim_running` is intentionally performed before the Operation
                // claim so only one worker can win. If it fails, restore the exact
                // prior durable state instead of stranding a workerless `running`.
                let latest = self.ledger.get_unscoped(job_id).await?;
                if latest.job.state == JobState::CancelRequested {
                    return self.finish_cancelled_without_worker(&latest).await;
                }
                if current.job.state == JobState::Paused {
                    let _ = self.ledger.finish_pause(job_id).await;
                } else {
                    let _ = self.ledger.rollback_initial_start(job_id).await;
                }
                return Err(error);
            }
        };
        let token = CancellationToken::new();
        self.running.insert(job_id, token.clone());
        let latest = match self.ledger.get_unscoped(job_id).await {
            Ok(latest) => latest,
            Err(error) => {
                self.running.remove(&job_id);
                return Err(error);
            }
        };
        if latest.job.state == JobState::CancelRequested {
            token.cancel();
            self.running.remove(&job_id);
            return self.finish_cancelled_without_worker(&latest).await;
        }
        if latest.job.state == JobState::PauseRequested {
            token.cancel();
        }
        let service = self.clone();
        let execution = self.execution.clone();
        let record = running.clone();
        tokio::spawn(async move {
            let permit = tokio::select! {
                biased;
                _ = token.cancelled() => None,
                permit = service.concurrency.clone().acquire_owned() => Some(permit),
            };
            let result = match permit {
                Some(Ok(_permit)) => execution.run(record.clone(), claimed, token).await,
                Some(Err(_)) => Err(AppError::Config("job scheduler stopped".into())),
                None => match service.ledger.get_unscoped(job_id).await {
                    Ok(current) if current.job.state == JobState::CancelRequested => {
                        Ok(WorkerOutcome::Cancelled)
                    }
                    Ok(_) => execution.run(record.clone(), claimed, token).await,
                    Err(error) => Err(error),
                },
            };
            service.complete(record, result).await;
            service.running.remove(&job_id);
        });
        self.emit(&latest.job);
        Ok(latest.job)
    }

    async fn finish_cancelled_without_worker(&self, record: &JobRecord) -> AppResult<Job> {
        let updated = self
            .ledger
            .finish(record.job.id, JobState::Cancelled, None, None)
            .await?;
        let operation = self.operation.get(record.job.operation_id).await?;
        if operation.state == OperationState::Executing {
            let _ = self
                .operation
                .confirm_cancelled(operation.id.into(), &json!({"reason": "job_cancelled"}))
                .await;
        } else if !operation.state.is_terminal() {
            let _ = self
                .operation
                .cancel_before_execution(operation.id.into(), &json!({"reason": "job_cancelled"}))
                .await;
        }
        self.emit(&updated.job);
        self.retire_import_source(&updated).await;
        Ok(updated.job)
    }

    async fn complete(&self, record: JobRecord, result: AppResult<WorkerOutcome>) {
        match result {
            Ok(WorkerOutcome::Succeeded) => {
                if let Ok(updated) = self
                    .ledger
                    .finish(record.job.id, JobState::Succeeded, None, None)
                    .await
                {
                    let _ = self
                        .operation
                        .succeed(
                            record.job.operation_id,
                            &json!({
                                "bytesProcessed": updated.job.bytes_processed,
                                "rowsProcessed": updated.job.rows_processed,
                            }),
                        )
                        .await;
                    self.emit(&updated.job);
                    self.retire_import_source(&updated).await;
                }
            }
            Ok(WorkerOutcome::Paused) => {
                match self.ledger.finish_pause(record.job.id).await {
                    Ok(updated) => self.emit(&updated.job),
                    Err(_) => {
                        // Cancel may win after the worker observed pause_requested
                        // but before this durable transition. Never strand the Job
                        // in cancel_requested without a worker.
                        if let Ok(current) = self.ledger.get_unscoped(record.job.id).await {
                            if current.job.state == JobState::CancelRequested {
                                let _ = self.finish_cancelled_without_worker(&current).await;
                            } else if current.job.state == JobState::Paused {
                                self.emit(&current.job);
                            }
                        }
                    }
                }
            }
            Ok(WorkerOutcome::Cancelled) => {
                if let Ok(updated) = self
                    .ledger
                    .finish(record.job.id, JobState::Cancelled, None, None)
                    .await
                {
                    let _ = self
                        .operation
                        .confirm_cancelled(
                            record.job.operation_id,
                            &json!({"reason": "job_cancelled"}),
                        )
                        .await;
                    self.emit(&updated.job);
                    self.retire_import_source(&updated).await;
                }
            }
            Err(error) => {
                let current = self.ledger.get_unscoped(record.job.id).await;
                if current
                    .as_ref()
                    .is_ok_and(|value| value.job.state == JobState::Paused)
                {
                    if let Ok(current) = current {
                        self.emit(&current.job);
                    }
                    return;
                }
                let code = error_code(&error);
                let outcome_unknown = matches!(&error, AppError::OutcomeUnknown(_));
                let redacted = if outcome_unknown {
                    "The database may have committed the last import statement. Do not retry automatically; inspect the target first."
                } else {
                    "The job failed. Review its error artifact or retry the plan."
                };
                if let Ok(updated) = self
                    .ledger
                    .finish(record.job.id, JobState::Failed, Some(code), Some(redacted))
                    .await
                {
                    if outcome_unknown {
                        let _ = self
                            .operation
                            .mark_outcome_unknown(record.job.operation_id, &json!({"reason": code}))
                            .await;
                    } else {
                        let _ = self
                            .operation
                            .fail(record.job.operation_id, &json!({"reason": code}))
                            .await;
                    }
                    self.emit(&updated.job);
                    self.retire_import_source(&updated).await;
                }
            }
        }
    }

    pub(crate) async fn pause(&self, scoped_id: ConnectionJobId) -> AppResult<Job> {
        let ConnectionJobId {
            connection_id,
            job_id,
        } = scoped_id;
        let guard = self
            .authority
            .authorize(connection_id, JobPermission::Read)
            .await?;
        let current = self.ledger.get_scoped(guard.authority(), job_id).await?;
        if !current.job.resumable {
            return Err(AppError::Blocked {
                reason: "this format cannot pause and resume".into(),
            });
        }
        let updated = self.ledger.request_pause(job_id).await?;
        if let Some(token) = self.running.get(&job_id) {
            token.cancel();
        }
        self.execution.cancel(job_id);
        self.emit(&updated.job);
        Ok(updated.job)
    }

    pub(crate) async fn cancel(&self, scoped_id: ConnectionJobId) -> AppResult<Job> {
        let ConnectionJobId {
            connection_id,
            job_id,
        } = scoped_id;
        let guard = self
            .authority
            .authorize(connection_id, JobPermission::Read)
            .await?;
        let current = self.ledger.get_scoped(guard.authority(), job_id).await?;
        if current.job.state.terminal() {
            return Ok(current.job);
        }
        if current.job.state == JobState::CancelRequested {
            return Ok(current.job);
        }
        let updated = self.ledger.request_cancel(job_id).await?;
        if let Some(token) = self.running.get(&job_id) {
            token.cancel();
            self.execution.cancel(job_id);
        } else {
            let operation = self.operation.get(current.job.operation_id).await?;
            if operation.state == OperationState::Executing {
                let _ = self
                    .operation
                    .confirm_cancelled(operation.id.into(), &json!({"reason": "job_cancelled"}))
                    .await;
            } else if !operation.state.is_terminal() {
                let _ = self
                    .operation
                    .cancel_before_execution(
                        operation.id.into(),
                        &json!({"reason": "job_cancelled"}),
                    )
                    .await;
            }
            if updated.job.state == JobState::CancelRequested {
                return self.finish_cancelled_without_worker(&updated).await;
            }
            if updated.job.state.terminal() {
                self.retire_import_source(&updated).await;
            }
        }
        self.emit(&updated.job);
        Ok(updated.job)
    }
}

fn error_code(error: &AppError) -> &'static str {
    match error {
        AppError::Blocked { .. } => "blocked",
        AppError::Network(_) => "network",
        AppError::OutcomeUnknown(_) => "outcome_unknown",
        AppError::Db(_) | AppError::Mongo(_) => "database",
        AppError::Io(_) => "io",
        _ => "job_failed",
    }
}
