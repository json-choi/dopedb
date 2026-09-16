use std::path::Path;

use dopedb_protocol::ConstraintKind;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::features::jobs::{JobFileDirection, JobPlan};
use crate::kernel::identity::JobId;
use crate::model::Engine;
use crate::operations::ClaimedOperation;

use super::super::super::ports::{
    Checkpoint, JobAuthorityGuard, JobAuthorityPort, JobCatalogPort, JobLedgerPort, JobPermission,
    JobRecord, WorkerOutcome,
};
use super::super::format::{file_sha256, ExportSink};
use super::files::{
    file_len, finalize_output, partial_path, quote_identifier, quoted_relation,
    validate_output_parent,
};
use super::validation::{
    ensure_record_scope, export_field_names, find_relation, validate_checkpoint_counters,
    validate_columns, validate_export_checkpoint,
};
use super::JobWorker;

const MAX_EXPORT_BATCH_BYTES: usize = 16 * 1024 * 1024;

impl JobWorker {
    pub(super) async fn run_export(
        &self,
        record: JobRecord,
        claimed: &ClaimedOperation,
        cancellation: CancellationToken,
    ) -> AppResult<WorkerOutcome> {
        let JobPlan::Export {
            capability_id,
            relation,
            columns,
            field_names,
            batch_size,
            ..
        } = &record.plan
        else {
            unreachable!()
        };
        let guard = self
            .authority
            .authorize(record.job.connection_id, JobPermission::Read)
            .await?;
        ensure_record_scope(&record, guard.authority())?;
        let engine = guard.authority().engine;
        if engine == Engine::Bigquery {
            return Err(AppError::Blocked {
                reason: "BigQuery bulk export jobs are unavailable; export a bounded query result instead"
                    .into(),
            });
        }
        let capability = self
            .repository
            .resolve_capability(
                guard.authority(),
                *capability_id,
                JobFileDirection::Output,
                Some(record.job.id),
            )
            .await?;
        let snapshot = self.catalog.refresh(record.job.connection_id).await?;
        let relation_metadata = find_relation(&snapshot, relation)?;
        let source_columns = if columns.is_empty() {
            relation_metadata
                .columns
                .iter()
                .map(|column| column.name.clone())
                .collect::<Vec<_>>()
        } else {
            validate_columns(
                columns,
                &relation_metadata
                    .columns
                    .iter()
                    .map(|column| column.name.as_str())
                    .collect::<Vec<_>>(),
            )?;
            columns.clone()
        };
        if source_columns.is_empty() {
            return Err(AppError::Config(
                "export relation contains no columns".into(),
            ));
        }
        let output_columns = export_field_names(&source_columns, field_names)?;
        let type_families = source_columns
            .iter()
            .map(|name| {
                relation_metadata
                    .columns
                    .iter()
                    .find(|column| column.name == *name)
                    .map(|column| column.type_family)
                    .ok_or_else(|| {
                        AppError::Config(format!(
                            "export column `{name}` has no catalog type metadata"
                        ))
                    })
            })
            .collect::<AppResult<Vec<_>>>()?;
        validate_output_parent(&capability.path)?;
        let partial = partial_path(&capability.path, record.job.id)?;
        let table_sql = quoted_relation(engine, relation);
        let source_fingerprint = snapshot.fingerprint().to_owned();
        let resume_checkpoint = self.repository.latest_checkpoint(record.job.id).await?;
        if let Some(checkpoint) = &resume_checkpoint {
            validate_checkpoint_counters(checkpoint, &record)?;
            if record.job.rows_processed == 0 {
                let checkpoint_partial = partial.clone();
                let partial_hash =
                    tokio::task::spawn_blocking(move || file_sha256(&checkpoint_partial))
                        .await
                        .map_err(|_| {
                            AppError::Config(
                                "partial output validation stopped unexpectedly".into(),
                            )
                        })??;
                validate_export_checkpoint(
                    Some(checkpoint),
                    &source_fingerprint,
                    Some(&partial_hash),
                )?;
            }
        } else if record.job.rows_processed > 0 {
            return Err(AppError::Blocked {
                reason: "resumable export has no durable checkpoint".into(),
            });
        }
        let mut sink = ExportSink::open(
            &partial,
            record.job.format,
            output_columns,
            type_families,
            table_sql.clone(),
            engine,
            record.job.rows_processed,
        )?;
        if record.job.rows_processed > 0 {
            let checkpoint = resume_checkpoint
                .as_ref()
                .ok_or_else(|| AppError::Blocked {
                    reason: "resumable export has no durable checkpoint".into(),
                })?;
            validate_export_checkpoint(
                Some(checkpoint),
                &source_fingerprint,
                sink.fingerprint().as_deref(),
            )?;
        }
        if cancellation.is_cancelled() {
            return self
                .checkpoint_export_stop(
                    &record,
                    &mut sink,
                    &partial,
                    &source_fingerprint,
                    record.job.rows_processed,
                )
                .await;
        }
        let lease = guard.connect().await?;
        let live = lease.live().sql()?;
        let order_columns = relation_metadata
            .constraints
            .iter()
            .find(|constraint| constraint.kind == ConstraintKind::Primary)
            .map(|constraint| constraint.columns.clone())
            .filter(|values| !values.is_empty())
            .unwrap_or_else(|| vec![source_columns[0].clone()]);
        let select_columns = source_columns
            .iter()
            .map(|column| quote_identifier(engine, column))
            .collect::<Vec<_>>()
            .join(", ");
        let order = order_columns
            .iter()
            .map(|column| quote_identifier(engine, column))
            .collect::<Vec<_>>()
            .join(", ");
        let mut rows_processed = record.job.rows_processed;
        let total = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                return self
                    .checkpoint_export_stop(
                        &record,
                        &mut sink,
                        &partial,
                        &source_fingerprint,
                        rows_processed,
                    )
                    .await;
            }
            result = count_rows(live, engine, &table_sql, record.job.id) => {
                match result {
                    Ok(total) => total,
                    Err(_) if cancellation.is_cancelled() => {
                        return self
                            .checkpoint_export_stop(
                                &record,
                                &mut sink,
                                &partial,
                                &source_fingerprint,
                                rows_processed,
                            )
                            .await;
                    }
                    Err(error) => return Err(error),
                }
            }
        };
        if let Err(error) = self
            .repository
            .update_totals(record.job.id, Some(total), None)
            .await
        {
            if cancellation.is_cancelled() {
                return self
                    .checkpoint_export_stop(
                        &record,
                        &mut sink,
                        &partial,
                        &source_fingerprint,
                        rows_processed,
                    )
                    .await;
            }
            return Err(error);
        }
        loop {
            if cancellation.is_cancelled() {
                return self
                    .checkpoint_export_stop(
                        &record,
                        &mut sink,
                        &partial,
                        &source_fingerprint,
                        rows_processed,
                    )
                    .await;
            }
            let sql = format!(
                "SELECT {select_columns} FROM {table_sql} ORDER BY {order} LIMIT {} OFFSET {}",
                batch_size, rows_processed
            );
            let result = match crate::executor::read::run_read_byte_capped(
                live,
                engine,
                &sql,
                u64::from(*batch_size),
                MAX_EXPORT_BATCH_BYTES,
                Some(record.job.id.into()),
            )
            .await
            {
                Ok(result) => result,
                Err(_) if cancellation.is_cancelled() => {
                    return self
                        .checkpoint_export_stop(
                            &record,
                            &mut sink,
                            &partial,
                            &source_fingerprint,
                            rows_processed,
                        )
                        .await;
                }
                Err(error) => return Err(error),
            };
            if cancellation.is_cancelled() {
                return self
                    .checkpoint_export_stop(
                        &record,
                        &mut sink,
                        &partial,
                        &source_fingerprint,
                        rows_processed,
                    )
                    .await;
            }
            if let Some(failure) = result.decode_failures.first() {
                let failed_row = rows_processed
                    .saturating_add(u64::try_from(failure.row_index).unwrap_or(u64::MAX));
                let error = AppError::Blocked {
                    reason: format!(
                        "export blocked: cell at source row {}, column {} could not be decoded as {}",
                        failed_row.saturating_add(1),
                        failure.column_index + 1,
                        failure.database_type
                    ),
                };
                drop(sink);
                match std::fs::remove_file(&partial) {
                    Ok(()) => return Err(error),
                    Err(remove_error) if remove_error.kind() == std::io::ErrorKind::NotFound => {
                        return Err(error);
                    }
                    Err(remove_error) => {
                        return Err(AppError::OutcomeUnknown(format!(
                            "{error}; failed export partial could not be removed: {remove_error}"
                        )));
                    }
                }
            }
            if result.rows.is_empty() {
                break;
            }
            sink.write_rows(&result.rows)?;
            rows_processed = sink.rows_written();
            let bytes = file_len(&partial)?;
            let checkpoint = sink.fingerprint().map(|target| Checkpoint {
                source_fingerprint: source_fingerprint.clone(),
                target_fingerprint: target,
                value: json!({
                    "bytesProcessed": bytes,
                    "rowsProcessed": rows_processed,
                }),
            });
            let updated = self
                .repository
                .update_progress(record.job.id, rows_processed, bytes, checkpoint)
                .await?;
            self.emit(&updated.job);
        }
        sink.finish()?;
        finalize_output(&partial, &capability.path)?;
        let size = file_len(&capability.path)?;
        let sha256 = file_sha256(&capability.path)?;
        self.repository
            .record_artifact(record.job.id, "output", &capability.path, size, &sha256)
            .await?;
        self.repository
            .update_progress(record.job.id, rows_processed, size, None)
            .await?;
        let _ = claimed.grant();
        Ok(WorkerOutcome::Succeeded)
    }

    async fn checkpoint_export_stop(
        &self,
        record: &JobRecord,
        sink: &mut ExportSink,
        partial: &Path,
        source_fingerprint: &str,
        rows_processed: u64,
    ) -> AppResult<WorkerOutcome> {
        sink.flush()?;
        let bytes = file_len(partial)?;
        let checkpoint = sink.fingerprint().map(|target| Checkpoint {
            source_fingerprint: source_fingerprint.to_owned(),
            target_fingerprint: target,
            value: json!({
                "bytesProcessed": bytes,
                "rowsProcessed": rows_processed,
            }),
        });
        let updated = self
            .repository
            .update_progress(record.job.id, rows_processed, bytes, checkpoint)
            .await?;
        self.emit(&updated.job);
        self.stop_outcome(record.job.id).await
    }
}

async fn count_rows(
    live: &crate::connection::LiveConnection,
    engine: Engine,
    table_sql: &str,
    job_id: JobId,
) -> AppResult<u64> {
    let result = crate::executor::read::run_read_byte_capped(
        live,
        engine,
        &format!("SELECT COUNT(*) AS n FROM {table_sql}"),
        1,
        64 * 1024,
        Some(job_id.into()),
    )
    .await?;
    let value = result
        .rows
        .first()
        .and_then(|row| row.first())
        .ok_or_else(|| AppError::Config("export count returned no value".into()))?;
    match value {
        Value::Number(value) => value
            .as_u64()
            .ok_or_else(|| AppError::Config("export count is invalid".into())),
        Value::String(value) => value
            .parse()
            .map_err(|_| AppError::Config("export count is invalid".into())),
        _ => Err(AppError::Config("export count is invalid".into())),
    }
}
