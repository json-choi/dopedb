use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};

use dopedb_protocol::{NormalizedTypeFamily, ObjectRef};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::AssertSqlSafe;
use tokio_util::sync::CancellationToken;

use crate::connection::DbPool;
use crate::error::{AppError, AppResult};
use crate::features::jobs::{JobFieldMapping, JobValidation};
use crate::model::Engine;
use crate::operations::ExecutionGrant;

use super::super::format::{typed_sql_literal, write_error_row, ImportDataRow, ImportItem};
use super::files::{quote_identifier, quoted_relation};

pub(super) fn build_import_statements(
    engine: Engine,
    target: Option<&ObjectRef>,
    target_metadata: Option<&dopedb_protocol::Relation>,
    mappings: &[JobFieldMapping],
    validation: &JobValidation,
    items: &[ImportItem],
) -> Vec<Result<String, String>> {
    items
        .iter()
        .map(|item| match item {
            ImportItem::Sql { statement, .. } => match crate::safety::classify(statement, engine) {
                Ok(classification) if classification.kind != crate::model::QueryKind::Privilege => {
                    Ok(statement.clone())
                }
                Ok(_) => Err("arbitrary privilege statements are blocked in SQL imports".into()),
                Err(error) => Err(format!("SQL statement failed safety inspection: {error}")),
            },
            ImportItem::Data(row) => build_insert(
                engine,
                target.ok_or_else(|| "target relation is missing".to_owned())?,
                target_metadata.ok_or_else(|| "target metadata is missing".to_owned())?,
                mappings,
                validation,
                row,
            ),
        })
        .collect()
}

fn build_insert(
    engine: Engine,
    target: &ObjectRef,
    target_metadata: &dopedb_protocol::Relation,
    mappings: &[JobFieldMapping],
    validation: &JobValidation,
    row: &ImportDataRow,
) -> Result<String, String> {
    let effective = if mappings.is_empty() {
        target_metadata
            .columns
            .iter()
            .filter(|column| row.values.contains_key(&column.name))
            .map(|column| JobFieldMapping {
                source: column.name.clone(),
                target: column.name.clone(),
                required: false,
            })
            .collect::<Vec<_>>()
    } else {
        mappings.to_vec()
    };
    if effective.is_empty() {
        return Err("no input fields map to target columns".into());
    }
    let available = target_metadata
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect::<Vec<_>>();
    let mut columns = Vec::with_capacity(effective.len());
    let mut values = Vec::with_capacity(effective.len());
    for mapping in effective {
        if !available.contains(&mapping.target.as_str()) {
            return Err(format!("unknown target column `{}`", mapping.target));
        }
        let mut value = row
            .values
            .get(&mapping.source)
            .cloned()
            .unwrap_or(Value::Null);
        if let Value::String(text) = &value {
            if validation.null_values.iter().any(|null| null == text) {
                value = Value::Null;
            }
        }
        if mapping.required && value.is_null() {
            return Err(format!("required field `{}` is missing", mapping.source));
        }
        columns.push(quote_identifier(engine, &mapping.target));
        let family = target_metadata
            .columns
            .iter()
            .find(|column| column.name == mapping.target)
            .map(|column| column.type_family)
            .unwrap_or(NormalizedTypeFamily::Other);
        values.push(typed_sql_literal(engine, family, &value)?);
    }
    Ok(format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quoted_relation(engine, target),
        columns.join(", "),
        values.join(", ")
    ))
}

pub(super) async fn execute_transaction(
    pool: &DbPool,
    statements: &[String],
    grant: &ExecutionGrant,
    cancellation: &CancellationToken,
    conservative_statement_outcome: bool,
) -> AppResult<()> {
    if statements.is_empty() {
        return Ok(());
    }
    if grant.connection_id() == uuid::Uuid::nil() {
        return Err(AppError::Blocked {
            reason: "import execution grant has no connection".into(),
        });
    }
    macro_rules! execute {
        ($pool:expr) => {{
            let mut transaction = tokio::select! {
                result = tokio::time::timeout(
                    crate::executor::cancel::QUERY_TIMEOUT,
                    $pool.begin(),
                ) => match result {
                    Ok(Ok(transaction)) => transaction,
                    Ok(Err(error)) => return Err(error.into()),
                    Err(_) => return Err(AppError::Blocked {
                        reason: "import transaction start timed out".into(),
                    }),
                },
                _ = cancellation.cancelled() => return Err(AppError::Blocked {
                    reason: "import transaction was cancelled before it started".into(),
                }),
            };
            for statement in statements {
                let result = tokio::select! {
                    result = tokio::time::timeout(
                        crate::executor::cancel::QUERY_TIMEOUT,
                        sqlx::query(AssertSqlSafe(statement.as_str()))
                            .execute(&mut *transaction),
                    ) => result,
                    _ = cancellation.cancelled() => {
                        if conservative_statement_outcome {
                            return Err(AppError::OutcomeUnknown(
                                "SQL import statement acknowledgement was interrupted by cancellation".into(),
                            ));
                        }
                        return Err(AppError::Blocked {
                            reason: "import transaction was cancelled and rolled back".into(),
                        });
                    },
                };
                match result {
                    Ok(Ok(_)) => {}
                    Ok(Err(error)) => return Err(error.into()),
                    Err(_) if conservative_statement_outcome => return Err(
                        AppError::OutcomeUnknown(
                            "SQL import statement acknowledgement timed out".into(),
                        ),
                    ),
                    Err(_) => return Err(AppError::Blocked {
                        reason: "import statement timed out and was rolled back".into(),
                    }),
                }
            }
            let commit = transaction.commit();
            tokio::select! {
                result = tokio::time::timeout(
                    crate::executor::cancel::QUERY_TIMEOUT,
                    commit,
                ) => match result {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => return Err(AppError::OutcomeUnknown(format!(
                        "import commit acknowledgement failed: {error}"
                    ))),
                    Err(_) => return Err(AppError::OutcomeUnknown(
                        "import commit acknowledgement timed out".into(),
                    )),
                },
                _ = cancellation.cancelled() => return Err(AppError::OutcomeUnknown(
                    "import commit acknowledgement was interrupted by cancellation".into(),
                )),
            }
        }};
    }
    match pool {
        DbPool::Postgres(pool) => execute!(pool),
        DbPool::Mysql(pool) => execute!(pool),
        DbPool::Sqlite(pool) => execute!(pool),
        DbPool::Bigquery(_) => {
            return Err(AppError::Blocked {
                reason: "BigQuery import jobs are unavailable through the read-only adapter".into(),
            })
        }
        DbPool::CloudflareD1(_) => {
            return Err(AppError::Blocked {
                reason: "Cloudflare D1 import jobs require a dedicated remote batch workflow"
                    .into(),
            })
        }
    }
    Ok(())
}

pub(super) fn write_item_error(
    writer: &mut BufWriter<File>,
    item: &ImportItem,
    error: &str,
) -> AppResult<()> {
    match item {
        ImportItem::Data(row) => write_error_row(writer, row.source_line, &row.raw, error),
        ImportItem::Sql {
            source_line,
            statement,
        } => write_error_row(
            writer,
            *source_line,
            &json!({
                "statementSha256": hex::encode(Sha256::digest(statement.as_bytes())),
            }),
            error,
        ),
    }
}

pub(super) fn truncate_error_writer(writer: &mut BufWriter<File>, length: u64) -> AppResult<()> {
    writer.flush()?;
    writer.get_mut().set_len(length)?;
    writer.seek(SeekFrom::Start(length))?;
    Ok(())
}

pub(super) fn bounded_error(error: &AppError) -> String {
    let value = error.to_string();
    value.chars().take(1_000).collect()
}
