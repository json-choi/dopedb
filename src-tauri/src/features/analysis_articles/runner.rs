//! Exact-revision, read-only execution for one current Analysis Article query.

use chrono::Utc;
use dopedb_protocol::{
    AnalysisColumn, AnalysisColumnMasking, AnalysisColumnType, AnalysisResultData,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::executor::cancel;

use super::domain::{AnalysisDataSet, AnalysisDefinitionRunReceipt, AnalysisDefinitionRunRequest};
use super::ports::{AnalysisReadExecutionPort, AnalysisReadExecutionRequest};
use super::validation::{validate_definition, MAX_ARTICLE_RESULT_BYTES};

#[derive(Clone)]
pub(crate) struct AnalysisArticleRunner<E> {
    execution: E,
}

impl<E> AnalysisArticleRunner<E>
where
    E: AnalysisReadExecutionPort,
{
    pub(crate) fn new(execution: E) -> Self {
        Self { execution }
    }

    pub(crate) async fn run_definition(
        &self,
        request: AnalysisDefinitionRunRequest,
    ) -> AppResult<AnalysisDefinitionRunReceipt> {
        let started_at = Utc::now();
        if request.article_revision < 1 {
            return Err(AppError::Config(
                "Analysis Article revision must be positive".into(),
            ));
        }
        validate_definition(&request.definition, &request.connections)?;
        let cancellation = cancel::register(request.run_id);
        if cancellation.is_cancelled() {
            return Err(AppError::Safety("Analysis Article run cancelled".into()));
        }
        let query = &request.definition.query;
        let authority = request
            .connections
            .iter()
            .find(|connection| connection.role == query.connection_role)
            .ok_or_else(|| {
                AppError::Config("Analysis Article query lost its connection authority".into())
            })?;
        let outcome = self
            .execution
            .execute_read(AnalysisReadExecutionRequest {
                workspace_id: request.workspace_id,
                project_environment_id: request.project_environment_id,
                authority,
                query,
                run_id: Uuid::new_v4(),
                cancellation_id: request.run_id,
            })
            .await?;
        let result = build_result(&outcome.data, &cancellation)?;
        let result_hash = sha256(&serde_json::to_vec(&result)?);
        Ok(AnalysisDefinitionRunReceipt {
            run_id: request.run_id,
            article_id: request.article_id,
            article_revision: request.article_revision,
            query_receipts: vec![outcome.receipt],
            result,
            result_hash,
            started_at,
            finished_at: Utc::now(),
        })
    }
}

fn build_result(
    dataset: &AnalysisDataSet,
    cancellation: &cancel::CancelHandle,
) -> AppResult<AnalysisResultData> {
    let rows = dataset
        .rows
        .iter()
        .enumerate()
        .map(|(ordinal, row)| {
            if ordinal % 256 == 0 && cancellation.is_cancelled() {
                return Err(AppError::Safety("Analysis Article run cancelled".into()));
            }
            dataset
                .columns
                .iter()
                .enumerate()
                .map(|(column_index, column)| {
                    mask_value(column, row.get(column_index).unwrap_or(&Value::Null))
                })
                .collect::<AppResult<Vec<_>>>()
        })
        .collect::<AppResult<Vec<_>>>()?;
    let result = AnalysisResultData {
        columns: dataset.columns.clone(),
        rows,
        truncated: dataset.truncated,
    };
    ensure_result_size(serde_json::to_vec(&result)?.len())?;
    Ok(result)
}

fn ensure_result_size(serialized_bytes: usize) -> AppResult<()> {
    if serialized_bytes <= MAX_ARTICLE_RESULT_BYTES {
        return Ok(());
    }
    Err(AppError::Blocked {
        reason: "Analysis Article local result exceeds 16 MiB".into(),
    })
}

fn mask_value(column: &AnalysisColumn, value: &Value) -> AppResult<Value> {
    Ok(match column.masking {
        AnalysisColumnMasking::None => value.clone(),
        AnalysisColumnMasking::Redact => Value::Null,
        AnalysisColumnMasking::Hash => value
            .as_str()
            .map(|value| Value::String(sha256(value.as_bytes())))
            .unwrap_or(Value::Null),
        AnalysisColumnMasking::Bucket => match column.column_type {
            AnalysisColumnType::Date | AnalysisColumnType::Datetime => value
                .as_str()
                .map(|value| Value::String(value.chars().take(7).collect()))
                .unwrap_or(Value::Null),
            AnalysisColumnType::Number
            | AnalysisColumnType::Duration
            | AnalysisColumnType::Currency
            | AnalysisColumnType::Percent => value
                .as_f64()
                .or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok()))
                .filter(|value| value.is_finite())
                .and_then(|value| {
                    let magnitude = if value == 0.0 {
                        1.0
                    } else {
                        10_f64.powf(value.abs().log10().floor())
                    };
                    serde_json::Number::from_f64((value / magnitude).floor() * magnitude)
                })
                .map(Value::Number)
                .unwrap_or(Value::Null),
            AnalysisColumnType::String | AnalysisColumnType::Json => value
                .as_str()
                .map(|value| match value.chars().count() {
                    0..=3 => "0-3",
                    4..=7 => "4-7",
                    8..=15 => "8-15",
                    _ => "16+",
                })
                .map(|value| Value::String(value.into()))
                .unwrap_or(Value::Null),
            AnalysisColumnType::Boolean => value.clone(),
        },
    })
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
pub(crate) fn assert_runner_safety_contract() {
    super::adapters::assert_exact_query_contract();
    super::adapters::assert_hosted_mutation_error_contract();
    super::result_compat::assert_result_compat_contract();

    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../dopedb-protocol/tests/fixtures/control-plane-contracts-v1.json"
    ))
    .expect("control-plane fixture must decode");
    let valid_article: dopedb_protocol::SharedAnalysisArticleCreate =
        serde_json::from_value(fixture["analysisArticleCreate"].clone())
            .expect("current compact fixture must decode");
    assert!(super::validation::validate_shared_create(&valid_article).is_ok());
    let serialized = serde_json::to_value(&valid_article).expect("current article must encode");
    assert!(serialized["definition"].get("query").is_some());
    assert!(serialized["definition"].get("queries").is_none());

    assert!(ensure_result_size(MAX_ARTICLE_RESULT_BYTES).is_ok());
    assert!(ensure_result_size(MAX_ARTICLE_RESULT_BYTES + 1).is_err());
}
