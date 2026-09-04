//! Typed, read-only document query path — MongoDB's stand-in for L1+L2.
//!
//! L1 equivalent: [`classify`] walks the actual request tree (never strings)
//! against a hard stage allowlist, recursing into `$lookup`/`$facet`/`$unionWith`
//! sub-pipelines, and fail-safes anything unrecognized to a High-risk write so
//! the L4 gate blocks it. L2 has no MongoDB equivalent (no server read-only
//! session), so [`run`] is structurally read-only instead: it only ever calls
//! the driver's typed `find`/`aggregate`/`count_documents` — never `run_command`.

use std::time::{Duration, Instant};

use futures::TryStreamExt;
use mongodb::bson::{Bson, Document};

use crate::error::{AppError, AppResult};
use crate::model::{Classification, DocumentPage, DocumentQuery, QueryKind, RiskLevel};

use super::MongoConnection;

/// Aggregate stages that only read. Anything absent here — `$out`, `$merge`,
/// or a stage added by a future server version — fails safe as a write.
const ALLOWED_STAGES: &[&str] = &[
    "$addFields",
    "$bucket",
    "$bucketAuto",
    "$count",
    "$densify",
    "$facet",
    "$fill",
    "$geoNear",
    "$graphLookup",
    "$group",
    "$limit",
    "$lookup",
    "$match",
    "$project",
    "$redact",
    "$replaceRoot",
    "$replaceWith",
    "$sample",
    "$set",
    "$setWindowFields",
    "$skip",
    "$sort",
    "$sortByCount",
    "$unionWith",
    "$unset",
    "$unwind",
];

/// Server-side JavaScript operators — rejected anywhere in a filter or stage.
const BANNED_OPERATORS: &[&str] = &["$where", "$function", "$accumulator"];

/// Classify a typed document query. Mirrors `safety::classify`'s contract: any
/// ambiguity fail-safes to `(Write, High)` with a note naming the offender —
/// it never errors — so the existing L4 gate blocks it downstream.
pub fn classify(query: &DocumentQuery) -> Classification {
    let (collection, violation) = match query {
        DocumentQuery::Find {
            collection,
            filter,
            projection,
            sort,
            ..
        } => (
            collection,
            [filter, projection, sort]
                .into_iter()
                .flatten()
                .find_map(banned_operator),
        ),
        DocumentQuery::Aggregate {
            collection,
            pipeline,
        } => (collection, pipeline_violation(pipeline)),
        DocumentQuery::Count { collection, filter } => {
            (collection, filter.as_ref().and_then(banned_operator))
        }
    };

    match violation {
        None => Classification {
            kind: QueryKind::Read,
            risk: RiskLevel::Low,
            statement_count: 1,
            no_where: false,
            tables: vec![collection.clone()],
            notes: Vec::new(),
            direct_dml: false,
        },
        Some(note) => Classification {
            kind: QueryKind::Write,
            risk: RiskLevel::High,
            statement_count: 1,
            no_where: false,
            tables: vec![collection.clone()],
            notes: vec![note],
            direct_dml: false,
        },
    }
}

/// First violation in an aggregation pipeline, recursing into nested pipelines.
fn pipeline_violation(pipeline: &[serde_json::Value]) -> Option<String> {
    pipeline.iter().find_map(stage_violation)
}

fn stage_violation(stage: &serde_json::Value) -> Option<String> {
    let Some(obj) = stage.as_object().filter(|o| o.len() == 1) else {
        return Some("each aggregate stage must be an object with exactly one $stage key".into());
    };
    let (name, body) = obj.iter().next().expect("len checked above");
    if !ALLOWED_STAGES.contains(&name.as_str()) {
        return Some(format!(
            "aggregate stage {name:?} is not in the read-only allowlist"
        ));
    }
    if let Some(banned) = banned_operator(body) {
        return Some(banned);
    }
    // Stages that embed sub-pipelines — a banned stage must not hide inside them.
    match name.as_str() {
        "$lookup" | "$unionWith" => body
            .get("pipeline")
            .and_then(|p| p.as_array())
            .and_then(|stages| pipeline_violation(stages)),
        "$facet" => body.as_object().and_then(|facets| {
            facets.values().find_map(|sub| match sub.as_array() {
                Some(stages) => pipeline_violation(stages),
                None => Some("$facet values must be arrays of stages".into()),
            })
        }),
        _ => None,
    }
}

/// Depth-first scan for server-side JavaScript operators.
fn banned_operator(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => map.iter().find_map(|(k, v)| {
            if BANNED_OPERATORS.contains(&k.as_str()) {
                Some(format!(
                    "operator {k:?} (server-side JavaScript) is not allowed"
                ))
            } else {
                banned_operator(v)
            }
        }),
        serde_json::Value::Array(items) => items.iter().find_map(banned_operator),
        _ => None,
    }
}

/// Execute one classified-as-Read query. `max_rows` caps the returned page
/// (fetching one document past the cap sets `truncated`, mirroring the SQL
/// executor); `max_time` is enforced server-side via `maxTimeMS` so a cancelled
/// client future cannot leave a runaway server operation behind.
pub async fn run(
    conn: &MongoConnection,
    query: &DocumentQuery,
    max_rows: u64,
    max_time: Duration,
) -> AppResult<DocumentPage> {
    let started = Instant::now();
    let db = conn.database();
    let max = max_rows.max(1) as usize;

    let (documents, truncated) = match query {
        DocumentQuery::Find {
            collection,
            filter,
            projection,
            sort,
            skip,
            limit,
        } => {
            let coll = db.collection::<Document>(collection);
            let mut find = coll
                .find(to_document(filter.as_ref(), "filter")?)
                .max_time(max_time);
            if let Some(projection) = projection {
                find = find.projection(to_document(Some(projection), "projection")?);
            }
            if let Some(sort) = sort {
                find = find.sort(to_document(Some(sort), "sort")?);
            }
            if let Some(skip) = skip {
                find = find.skip(*skip);
            }
            match fetch_limit(*limit, max) {
                // `limit: 0` means "no documents" to the caller but "no limit"
                // to MongoDB — honor the caller and skip the round trip.
                None => (Vec::new(), false),
                Some(fetch) => {
                    find = find.limit(i64::try_from(fetch).unwrap_or(i64::MAX));
                    drain(find.await?, max).await?
                }
            }
        }
        DocumentQuery::Aggregate {
            collection,
            pipeline,
        } => {
            let stages = pipeline
                .iter()
                .map(|s| to_document(Some(s), "pipeline stage"))
                .collect::<AppResult<Vec<_>>>()?;
            let coll = db.collection::<Document>(collection);
            drain(coll.aggregate(stages).max_time(max_time).await?, max).await?
        }
        DocumentQuery::Count { collection, filter } => {
            let coll = db.collection::<Document>(collection);
            let n = coll
                .count_documents(to_document(filter.as_ref(), "filter")?)
                .max_time(max_time)
                .await?;
            (
                vec![stringify_unsafe_ints(serde_json::json!({ "count": n }))],
                false,
            )
        }
    };

    Ok(DocumentPage {
        doc_count: documents.len(),
        documents,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// Effective driver-side fetch limit. A user limit at or under the cap is
/// authoritative (no truncation flag); otherwise fetch one past the cap so
/// `truncated` is exact. `None` means "return nothing" — MongoDB itself treats
/// `limit: 0` as *unlimited*, the exact opposite of the caller's intent, so
/// zero never reaches the driver.
fn fetch_limit(limit: Option<u64>, max: usize) -> Option<u64> {
    match limit {
        Some(0) => None,
        Some(l) if l as usize <= max => Some(l),
        _ => Some((max + 1) as u64),
    }
}

/// Stream documents to relaxed Extended JSON, capping at `max` (one fetch past
/// the cap ⇒ `truncated`), so memory stays bounded regardless of result size.
async fn drain(
    mut cursor: mongodb::Cursor<Document>,
    max: usize,
) -> AppResult<(Vec<serde_json::Value>, bool)> {
    let mut documents = Vec::new();
    let mut truncated = false;
    while let Some(doc) = cursor.try_next().await? {
        if documents.len() >= max {
            truncated = true;
            break;
        }
        documents.push(stringify_unsafe_ints(
            Bson::Document(doc).into_relaxed_extjson(),
        ));
    }
    Ok((documents, truncated))
}

/// JavaScript parses raw JSON numbers as f64, so a large Int64 would silently
/// corrupt at the Tauri IPC boundary. Route every integer through the SQL
/// executor's `int_json`/`uint_json` so both engines share one precision rule.
fn stringify_unsafe_ints(value: serde_json::Value) -> serde_json::Value {
    use crate::executor::read::{int_json, uint_json};
    match value {
        serde_json::Value::Number(n) => {
            if let Some(v) = n.as_i64() {
                int_json(v)
            } else if let Some(v) = n.as_u64() {
                uint_json(v)
            } else {
                serde_json::Value::Number(n)
            }
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.into_iter().map(stringify_unsafe_ints).collect())
        }
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, stringify_unsafe_ints(v)))
                .collect(),
        ),
        other => other,
    }
}

/// Parse one JSON (or canonical Extended JSON) object into a BSON document.
/// `None` means "no filter" and yields the empty document.
fn to_document(value: Option<&serde_json::Value>, what: &str) -> AppResult<Document> {
    let Some(value) = value else {
        return Ok(Document::new());
    };
    match Bson::try_from(value.clone()) {
        Ok(Bson::Document(doc)) => Ok(doc),
        Ok(_) => Err(AppError::Config(format!("{what} must be a JSON object"))),
        Err(e) => Err(AppError::Config(format!("invalid {what}: {e}"))),
    }
}
