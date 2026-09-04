use std::fs::File;
use std::io::{BufWriter, Write};

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::features::jobs::{JobErrorPolicy, JobFileDirection, JobFormat, JobPlan};
use crate::operations::ClaimedOperation;

use super::super::super::ports::{
    Checkpoint, JobAuthorityGuard, JobAuthorityPort, JobCatalogPort, JobLedgerPort, JobPermission,
    JobRecord, WorkerOutcome,
};
use super::super::format::{create_error_writer, file_sha256, finalize_error_writer, ImportSource};
use super::files::{error_artifact_path, file_len};
use super::statements::{
    bounded_error, build_import_statements, execute_transaction, truncate_error_writer,
    write_item_error,
};
use super::validation::{
    ensure_record_scope, find_relation, validate_checkpoint_counters, validate_import_checkpoint,
};
use super::JobWorker;

impl JobWorker {
    pub(super) async fn run_import(
        &self,
        record: JobRecord,
        claimed: &ClaimedOperation,
        cancellation: CancellationToken,
    ) -> AppResult<WorkerOutcome> {
        let JobPlan::Import {
            capability_id,
            target_relation,
            mapping,
            validation,
            batch_size,
        } = &record.plan
        else {
            unreachable!()
        };
        let guard = self
            .authority
            .authorize(record.job.connection_id, JobPermission::Write)
            .await?;
        ensure_record_scope(&record, guard.authority())?;
        let engine = guard.authority().engine;
        if !guard.authority().workspace_access.can_write() {
            return Err(AppError::Blocked {
                reason: "your workspace role grants read-only database access".into(),
            });
        }
        let capability = self
            .repository
            .resolve_capability(
                guard.authority(),
                *capability_id,
                JobFileDirection::Input,
                Some(record.job.id),
            )
            .await?;
        let expected_source = capability
            .source_sha256
            .as_deref()
            .ok_or_else(|| AppError::Config("input capability has no source hash".into()))?;
        let snapshot = self.catalog.refresh(record.job.connection_id).await?;
        let target_fingerprint = snapshot.fingerprint().to_owned();
        let target_metadata = match target_relation {
            Some(reference) => Some(find_relation(&snapshot, reference)?),
            None if record.job.format.base() == JobFormat::Sql => None,
            None => {
                return Err(AppError::Config(
                    "structured import requires a target relation".into(),
                ))
            }
        };
        let source_path = capability.path.clone();
        let source_format = record.job.format;
        let resume_rows = record.job.rows_processed;
        let expected_source = expected_source.to_owned();
        let (mut source, actual_source) = tokio::task::spawn_blocking(move || {
            ImportSource::open_verified(
                &source_path,
                source_format,
                resume_rows,
                engine,
                &expected_source,
            )
        })
        .await
        .map_err(|_| AppError::Config("input preparation stopped unexpectedly".into()))??;
        let resume_checkpoint = self.repository.latest_checkpoint(record.job.id).await?;
        if let Some(checkpoint) = &resume_checkpoint {
            validate_checkpoint_counters(checkpoint, &record)?;
            validate_import_checkpoint(Some(checkpoint), &actual_source, &target_fingerprint)?;
        } else if record.job.rows_processed > 0 {
            return Err(AppError::Blocked {
                reason: "resumable import has no durable checkpoint".into(),
            });
        }
        let error_path = error_artifact_path(record.job.id)?;
        let append_errors = resume_checkpoint.is_some() && error_path.is_file();
        let mut error_writer = create_error_writer(&error_path, append_errors)?;
        let mut error_count = resume_checkpoint
            .as_ref()
            .and_then(|checkpoint| checkpoint.value.get("errors"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let mut committed_bytes = resume_checkpoint
            .as_ref()
            .and_then(|checkpoint| checkpoint.value.get("bytesProcessed"))
            .and_then(Value::as_u64)
            .unwrap_or(record.job.bytes_processed);
        let mut committed_error_count = error_count;
        let existing_error_bytes = std::fs::metadata(&error_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let mut committed_error_bytes = resume_checkpoint
            .as_ref()
            .and_then(|checkpoint| checkpoint.value.get("errorBytes"))
            .and_then(Value::as_u64)
            .unwrap_or(existing_error_bytes);
        truncate_error_writer(&mut error_writer, committed_error_bytes)?;
        let mut rows_processed = record.job.rows_processed;
        let mut error_artifact_needed =
            std::fs::metadata(&error_path).is_ok_and(|metadata| metadata.len() > 0);
        let result = if cancellation.is_cancelled() {
            self.checkpoint_import_stop(
                &record,
                &mut error_writer,
                &actual_source,
                &target_fingerprint,
                rows_processed,
                committed_bytes,
                committed_error_count,
                committed_error_bytes,
            )
            .await
        } else {
            let lease = guard.connect().await?;
            let live = lease.live().sql()?;
            let mut execute_batches = async || -> AppResult<WorkerOutcome> {
                loop {
                    if cancellation.is_cancelled() {
                        return self
                            .checkpoint_import_stop(
                                &record,
                                &mut error_writer,
                                &actual_source,
                                &target_fingerprint,
                                rows_processed,
                                committed_bytes,
                                committed_error_count,
                                committed_error_bytes,
                            )
                            .await;
                    }
                    let effective_batch_size = if record.job.format.base() == JobFormat::Sql {
                        1
                    } else {
                        *batch_size as usize
                    };
                    let items = source.next_batch(effective_batch_size)?;
                    if items.is_empty() {
                        break;
                    }
                    let statements = build_import_statements(
                        engine,
                        target_relation.as_ref(),
                        target_metadata,
                        mapping,
                        validation,
                        &items,
                    );
                    let mut executable = Vec::new();
                    for (item, statement) in items.iter().zip(statements) {
                        match statement {
                            Ok(statement) => executable.push((item, statement)),
                            Err(message) => {
                                error_artifact_needed = true;
                                error_count += 1;
                                write_item_error(&mut error_writer, item, &message)?;
                                if validation.on_error == JobErrorPolicy::Stop
                                    || error_count >= validation.max_errors
                                {
                                    return Err(AppError::Blocked {
                                        reason:
                                            "import validation failed; see the error rows artifact"
                                                .into(),
                                    });
                                }
                            }
                        }
                    }
                    if !executable.is_empty() {
                        let sql = executable
                            .iter()
                            .map(|(_, statement)| statement.clone())
                            .collect::<Vec<_>>();
                        if let Err(batch_error) = execute_transaction(
                            live.rw()?,
                            &sql,
                            claimed.grant(),
                            &cancellation,
                            record.job.format.base() == JobFormat::Sql,
                        )
                        .await
                        {
                            // An unacknowledged commit may already have reached the target.
                            // Retrying it row-by-row could duplicate data, so this state is
                            // terminal regardless of the configured validation policy.
                            if matches!(batch_error, AppError::OutcomeUnknown(_)) {
                                error_artifact_needed = true;
                                for (item, _) in &executable {
                                    write_item_error(
                                        &mut error_writer,
                                        item,
                                        &bounded_error(&batch_error),
                                    )?;
                                }
                                return Err(batch_error);
                            }
                            if cancellation.is_cancelled() {
                                return self
                                    .checkpoint_import_stop(
                                        &record,
                                        &mut error_writer,
                                        &actual_source,
                                        &target_fingerprint,
                                        rows_processed,
                                        committed_bytes,
                                        committed_error_count,
                                        committed_error_bytes,
                                    )
                                    .await;
                            }
                            if validation.on_error == JobErrorPolicy::Stop {
                                error_artifact_needed = true;
                                for (item, _) in &executable {
                                    write_item_error(
                                        &mut error_writer,
                                        item,
                                        &bounded_error(&batch_error),
                                    )?;
                                }
                                return Err(AppError::Blocked {
                                    reason: "import batch failed; see the error rows artifact"
                                        .into(),
                                });
                            }
                            let mut fallback_committed = false;
                            for (item, statement) in executable {
                                match execute_transaction(
                                    live.rw()?,
                                    &[statement],
                                    claimed.grant(),
                                    &cancellation,
                                    false,
                                )
                                .await
                                {
                                    Ok(()) => fallback_committed = true,
                                    Err(row_error)
                                        if matches!(row_error, AppError::OutcomeUnknown(_)) =>
                                    {
                                        error_artifact_needed = true;
                                        write_item_error(
                                            &mut error_writer,
                                            item,
                                            &bounded_error(&row_error),
                                        )?;
                                        return Err(row_error);
                                    }
                                    Err(_) if cancellation.is_cancelled() && fallback_committed => {
                                        return Err(AppError::OutcomeUnknown(
                                        "import cancellation followed committed row fallbacks; automatic resume is unsafe"
                                            .into(),
                                    ));
                                    }
                                    Err(_) if cancellation.is_cancelled() => {
                                        return self
                                            .checkpoint_import_stop(
                                                &record,
                                                &mut error_writer,
                                                &actual_source,
                                                &target_fingerprint,
                                                rows_processed,
                                                committed_bytes,
                                                committed_error_count,
                                                committed_error_bytes,
                                            )
                                            .await;
                                    }
                                    Err(row_error) => {
                                        error_artifact_needed = true;
                                        error_count += 1;
                                        write_item_error(
                                            &mut error_writer,
                                            item,
                                            &bounded_error(&row_error),
                                        )?;
                                        if error_count >= validation.max_errors {
                                            return Err(AppError::Blocked {
                                            reason:
                                                "import error limit reached; see the error rows artifact"
                                                    .into(),
                                        });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    rows_processed = rows_processed.saturating_add(items.len() as u64);
                    let bytes = source.bytes_consumed().unwrap_or(0);
                    error_writer.flush()?;
                    let error_bytes = error_writer.get_ref().metadata()?.len();
                    let checkpoint = record.job.resumable.then(|| Checkpoint {
                        source_fingerprint: actual_source.clone(),
                        target_fingerprint: target_fingerprint.clone(),
                        value: json!({
                            "bytesProcessed": bytes,
                            "errorBytes": error_bytes,
                            "errors": error_count,
                            "rowsProcessed": rows_processed,
                        }),
                    });
                    let updated = self
                        .repository
                        .update_progress(record.job.id, rows_processed, bytes, checkpoint)
                        .await?;
                    self.emit(&updated.job);
                    committed_bytes = bytes;
                    committed_error_count = error_count;
                    committed_error_bytes = error_bytes;
                }
                Ok(WorkerOutcome::Succeeded)
            };
            execute_batches().await
        };
        finalize_error_writer(error_writer)?;
        if !matches!(&result, Ok(WorkerOutcome::Paused)) {
            if error_artifact_needed {
                let size = file_len(&error_path)?;
                let hash = file_sha256(&error_path)?;
                self.repository
                    .record_artifact(record.job.id, "error_rows", &error_path, size, &hash)
                    .await?;
            } else {
                let _ = std::fs::remove_file(&error_path);
            }
        }
        if matches!(&result, Ok(WorkerOutcome::Succeeded)) {
            let size = capability
                .size_bytes
                .unwrap_or_else(|| file_len(&capability.path).unwrap_or(0));
            let _ = self
                .repository
                .update_progress(record.job.id, rows_processed, size, None)
                .await;
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn checkpoint_import_stop(
        &self,
        record: &JobRecord,
        error_writer: &mut BufWriter<File>,
        source_fingerprint: &str,
        target_fingerprint: &str,
        rows_processed: u64,
        bytes_processed: u64,
        error_count: u64,
        error_bytes: u64,
    ) -> AppResult<WorkerOutcome> {
        truncate_error_writer(error_writer, error_bytes)?;
        let checkpoint = record.job.resumable.then(|| Checkpoint {
            source_fingerprint: source_fingerprint.to_owned(),
            target_fingerprint: target_fingerprint.to_owned(),
            value: json!({
                "bytesProcessed": bytes_processed,
                "errorBytes": error_bytes,
                "errors": error_count,
                "rowsProcessed": rows_processed,
            }),
        });
        let updated = self
            .repository
            .update_progress(record.job.id, rows_processed, bytes_processed, checkpoint)
            .await?;
        self.emit(&updated.job);
        self.stop_outcome(record.job.id).await
    }
}
