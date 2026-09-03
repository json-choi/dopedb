//! Read compatibility for encrypted local results written before the one-result DTO.
//!
//! The retired fragment container never reaches current execution or IPC. It is
//! accepted only while opening an existing device-local cache entry and is
//! immediately projected into the current result shape.

use chrono::{DateTime, Utc};
use dopedb_protocol::{AnalysisColumn, AnalysisQueryReceipt, AnalysisResultData};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::domain::AnalysisDefinitionRunReceipt;
use super::validation::MAX_ARTICLE_RESULT_BYTES;

const LEGACY_FRAGMENT_LIMIT: usize = 256;
const RESULT_ROW_LIMIT: usize = 50_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyResultFragment {
    version: u32,
    block_id: String,
    ordinal: u16,
    columns: Vec<AnalysisColumn>,
    rows: Vec<Vec<Value>>,
    truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyRunReceipt {
    run_id: Uuid,
    article_id: Uuid,
    article_revision: i64,
    query_receipts: Vec<AnalysisQueryReceipt>,
    fragments: Vec<LegacyResultFragment>,
    result_hash: String,
    started_at: DateTime<Utc>,
    finished_at: DateTime<Utc>,
}

pub(crate) fn deserialize_local_result(bytes: &[u8]) -> AppResult<AnalysisDefinitionRunReceipt> {
    if let Ok(current) = serde_json::from_slice::<AnalysisDefinitionRunReceipt>(bytes) {
        return Ok(current);
    }
    let legacy = serde_json::from_slice::<LegacyRunReceipt>(bytes).map_err(|_| {
        AppError::Config("Analysis Article local result format is unsupported".into())
    })?;
    project_legacy_result(legacy)
}

fn project_legacy_result(mut legacy: LegacyRunReceipt) -> AppResult<AnalysisDefinitionRunReceipt> {
    if legacy.fragments.is_empty() || legacy.fragments.len() > LEGACY_FRAGMENT_LIMIT {
        return invalid_legacy_result();
    }
    legacy.fragments.sort_by_key(|fragment| fragment.ordinal);
    let first = legacy.fragments.first().ok_or_else(invalid_legacy_error)?;
    if first.version != 1 || first.block_id.is_empty() {
        return invalid_legacy_result();
    }
    let block_id = first.block_id.clone();
    let columns = first.columns.clone();
    let mut rows = Vec::new();
    let mut truncated = false;
    for (ordinal, fragment) in legacy.fragments.into_iter().enumerate() {
        if fragment.version != 1
            || fragment.block_id != block_id
            || usize::from(fragment.ordinal) != ordinal
            || fragment.columns != columns
            || fragment.rows.iter().any(|row| row.len() != columns.len())
            || rows.len().saturating_add(fragment.rows.len()) > RESULT_ROW_LIMIT
        {
            return invalid_legacy_result();
        }
        truncated |= fragment.truncated;
        rows.extend(fragment.rows);
    }
    let result = AnalysisResultData {
        columns,
        rows,
        truncated,
    };
    if serde_json::to_vec(&result)?.len() > MAX_ARTICLE_RESULT_BYTES {
        return invalid_legacy_result();
    }
    Ok(AnalysisDefinitionRunReceipt {
        run_id: legacy.run_id,
        article_id: legacy.article_id,
        article_revision: legacy.article_revision,
        query_receipts: legacy.query_receipts,
        result,
        result_hash: legacy.result_hash,
        started_at: legacy.started_at,
        finished_at: legacy.finished_at,
    })
}

fn invalid_legacy_error() -> AppError {
    AppError::Config("Analysis Article local result requires a fresh manual run".into())
}

fn invalid_legacy_result<T>() -> AppResult<T> {
    Err(invalid_legacy_error())
}

#[cfg(test)]
pub(super) fn assert_result_compat_contract() {
    let legacy = serde_json::json!({
        "runId": "11111111-1111-4111-8111-111111111111",
        "articleId": "22222222-2222-4222-8222-222222222222",
        "articleRevision": 3,
        "queryReceipts": [],
        "fragments": [{
            "version": 1,
            "blockId": "query_result",
            "ordinal": 0,
            "columns": [{
                "name": "total",
                "type": "number",
                "nullable": false,
                "role": "measure",
                "sensitivity": "internal",
                "masking": "none"
            }],
            "rows": [[7]],
            "truncated": false
        }],
        "resultHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "startedAt": "2026-09-03T00:00:00Z",
        "finishedAt": "2026-09-03T00:00:01Z"
    });
    let projected = deserialize_local_result(
        &serde_json::to_vec(&legacy).expect("legacy result fixture must encode"),
    )
    .expect("bounded legacy local result must project");
    assert_eq!(projected.result.rows, vec![vec![Value::from(7)]]);
    let current = serde_json::to_vec(&projected).expect("current result must encode");
    let reparsed = deserialize_local_result(&current).expect("current result must decode");
    assert_eq!(reparsed.result, projected.result);

    let mut multiple_results = legacy;
    multiple_results["fragments"][0]["blockId"] = Value::String("first".into());
    let mut second = multiple_results["fragments"][0].clone();
    second["blockId"] = Value::String("second".into());
    second["ordinal"] = Value::from(1);
    multiple_results["fragments"]
        .as_array_mut()
        .expect("fixture fragments")
        .push(second);
    assert!(deserialize_local_result(
        &serde_json::to_vec(&multiple_results).expect("invalid fixture must encode")
    )
    .is_err());
}
