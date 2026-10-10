//! Append-only, hash-chained audit log (compliance record). Every
//! ask/classify/preview/run action is recordable here via [`record`].
//!
//! Rows are inserted, never updated or deleted. [`verify_chain`] recomputes the
//! chain to surface post-hoc edits and compares it with the per-connection tail
//! anchor that every append advances — see `chain` for the tamper-EVIDENT (not
//! tamper-proof) caveat.

pub mod chain;

use chrono::Utc;
use futures::TryStreamExt;
use sqlx::Row;
use uuid::Uuid;

use crate::error::AppResult;
use crate::model::{AuditCursor, AuditEntry, AuditEntrySummary, AuditPage, Engine, QueryKind};
use crate::store::{self, Store};

use chain::AuditFields;

const AUDIT_PAGE_SIZE: usize = 50;
const AUDIT_SQL_PREVIEW_CHARS: i64 = 2_048;
const AUDIT_ERROR_PREVIEW_CHARS: i64 = 512;

pub(crate) struct AuditVerification {
    pub(crate) ok: bool,
    pub(crate) first_bad_index: Option<i64>,
    pub(crate) first_bad_id: Option<Uuid>,
    /// Insertion-order cursor of the first broken row, so a reader can open the
    /// exact metadata page that contains it instead of scanning pages by hand.
    pub(crate) first_bad_row_id: Option<i64>,
    pub(crate) entry_count: i64,
    pub(crate) tail_hash: Option<String>,
    pub(crate) anchor_status: AuditAnchorStatus,
    /// Row count the tail anchor recorded at the last append, when one exists.
    pub(crate) anchored_count: Option<i64>,
}

/// How the recomputed chain compares with the tail anchor its appends maintain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AuditAnchorStatus {
    /// Same row count and tail hash as the last append, or an empty chain.
    Matched,
    /// Rows exist but their anchor is gone.
    Missing,
    /// Fewer rows than the anchor recorded: the newest rows were removed.
    Shorter,
    /// More rows than the anchor recorded: rows were inserted outside `record`.
    Longer,
    /// Same row count with a different tail: the newest rows were replaced.
    TailMismatch,
}

fn anchor_status(
    anchor: Option<&(i64, String)>,
    entry_count: i64,
    tail_hash: Option<&str>,
) -> AuditAnchorStatus {
    match anchor {
        None if entry_count == 0 => AuditAnchorStatus::Matched,
        None => AuditAnchorStatus::Missing,
        Some((count, _)) if entry_count < *count => AuditAnchorStatus::Shorter,
        Some((count, _)) if entry_count > *count => AuditAnchorStatus::Longer,
        Some((_, hash)) if tail_hash != Some(hash.as_str()) => AuditAnchorStatus::TailMismatch,
        Some(_) => AuditAnchorStatus::Matched,
    }
}

/// Owned inputs for one audit record. The caller supplies the semantic fields;
/// `record` assigns `id`/`ts`, resolves `prev_hash`, and computes `hash`.
pub struct RecordArgs {
    pub connection_id: Uuid,
    pub engine: Engine,
    pub agent_prompt: Option<String>,
    pub sql: String,
    pub kind: QueryKind,
    /// e.g. "propose" | "approve" | "reject" | "execute" | "blocked".
    pub action: String,
    pub approved_by: Option<String>,
    pub affected_estimate: Option<i64>,
    pub error: Option<String>,
}

/// Append one entry: fetch the connection's latest hash, chain onto it, insert, and
/// advance the connection's tail anchor in the same transaction.
pub async fn record(store: &Store, args: RecordArgs) -> AppResult<AuditEntry> {
    let id = Uuid::new_v4();
    let ts = Utc::now();

    // Hold the chain lock across read-tail + insert. Without it two concurrent records
    // on the pooled store read the same tail hash and both insert with the same
    // prev_hash, forking the chain (verify_chain then reports false tampering).
    let _chain = store.audit_lock().lock().await;
    // IMMEDIATE takes the write lock before the tail read, so another writer cannot
    // invalidate this WAL snapshot between the read and the insert.
    let mut transaction = store.pool().begin_with("BEGIN IMMEDIATE").await?;

    // Latest hash for THIS connection is the chain tail we link onto. Ordered by
    // rowid (insertion order) so concurrent same-ts rows still chain stably.
    let prev_hash: Option<String> = sqlx::query(
        "SELECT hash FROM audit_log WHERE connection_id = ?1 ORDER BY rowid DESC LIMIT 1",
    )
    .bind(args.connection_id.to_string())
    .fetch_optional(&mut *transaction)
    .await?
    .map(|r| r.try_get("hash"))
    .transpose()?;

    let fields = AuditFields {
        connection_id: args.connection_id,
        ts,
        engine: args.engine,
        agent_prompt: args.agent_prompt.as_deref(),
        sql: &args.sql,
        kind: args.kind,
        action: &args.action,
        approved_by: args.approved_by.as_deref(),
        affected_estimate: args.affected_estimate,
        error: args.error.as_deref(),
    };
    let hash = chain::compute_hash(prev_hash.as_deref(), &fields);

    sqlx::query(
        r#"INSERT INTO audit_log
            (id, connection_id, ts, engine, agent_prompt, sql, kind, action,
             approved_by, affected_estimate, error, prev_hash, hash)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)"#,
    )
    .bind(id.to_string())
    .bind(args.connection_id.to_string())
    .bind(ts)
    .bind(store::engine_str(args.engine))
    .bind(&args.agent_prompt)
    .bind(&args.sql)
    .bind(store::kind_str(args.kind))
    .bind(&args.action)
    .bind(&args.approved_by)
    .bind(args.affected_estimate)
    .bind(&args.error)
    .bind(&prev_hash)
    .bind(&hash)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "INSERT INTO audit_chain_anchors (connection_id, entry_count, tail_hash, updated_at)
         VALUES (?1, 1, ?2, ?3)
         ON CONFLICT(connection_id) DO UPDATE SET
             entry_count = audit_chain_anchors.entry_count + 1,
             tail_hash = excluded.tail_hash,
             updated_at = excluded.updated_at",
    )
    .bind(args.connection_id.to_string())
    .bind(&hash)
    .bind(ts)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok(AuditEntry {
        id,
        connection_id: args.connection_id,
        ts,
        engine: args.engine,
        agent_prompt: args.agent_prompt,
        sql: args.sql,
        kind: args.kind,
        action: args.action,
        approved_by: args.approved_by,
        affected_estimate: args.affected_estimate,
        error: args.error,
        prev_hash,
        hash,
    })
}

/// Read one bounded newest-first metadata page. Large SQL and error bodies remain
/// behind [`entry`] so the list has a deterministic IPC byte ceiling.
pub(crate) async fn page_after(
    store: &Store,
    connection_id: Uuid,
    cursor: Option<AuditCursor>,
) -> AppResult<AuditPage> {
    let rows = sqlx::query(
        "SELECT rowid AS audit_row_id, id, connection_id, ts, engine,
                substr(sql, 1, ?3) AS sql_preview,
                length(sql) > ?3 AS sql_truncated,
                kind, action, approved_by, affected_estimate,
                CASE WHEN error IS NULL THEN NULL ELSE substr(error, 1, ?4) END
                  AS error_preview,
                COALESCE(length(error) > ?4, 0) AS error_truncated,
                prev_hash, hash
         FROM audit_log
         WHERE connection_id = ?1 AND (?2 IS NULL OR rowid < ?2)
         ORDER BY rowid DESC
         LIMIT ?5",
    )
    .bind(connection_id.to_string())
    .bind(cursor.map(|value| value.row_id))
    .bind(AUDIT_SQL_PREVIEW_CHARS)
    .bind(AUDIT_ERROR_PREVIEW_CHARS)
    .bind(i64::try_from(AUDIT_PAGE_SIZE + 1).expect("audit page size fits i64"))
    .fetch_all(store.pool())
    .await?;
    let mut items = rows
        .iter()
        .map(row_to_audit_summary)
        .collect::<AppResult<Vec<_>>>()?;
    let has_more = items.len() > AUDIT_PAGE_SIZE;
    if has_more {
        items.pop();
    }
    let next_cursor = if has_more {
        items
            .last()
            .map(|(_, row_id)| AuditCursor { row_id: *row_id })
    } else {
        None
    };
    Ok(AuditPage {
        items: items.into_iter().map(|(summary, _)| summary).collect(),
        next_cursor,
    })
}

pub(crate) async fn entry(
    store: &Store,
    connection_id: Uuid,
    entry_id: Uuid,
) -> AppResult<AuditEntry> {
    let row = sqlx::query("SELECT * FROM audit_log WHERE id = ?1 AND connection_id = ?2")
        .bind(entry_id.to_string())
        .bind(connection_id.to_string())
        .fetch_optional(store.pool())
        .await?
        .ok_or_else(|| crate::error::AppError::NotFound(format!("audit entry {entry_id}")))?;
    row_to_audit(&row)
}

/// Recompute the chain in insertion order and confirm every stored hash matches.
/// Returns `(false, Some(index))` at the first row that was edited, reordered, or had
/// its `prev_hash` broken (index = 0-based insertion-order position); `(true, None)`
/// if the whole chain verifies.
///
/// The genesis link pins the start and the tail anchor (advanced by every append)
/// pins the end, so removing or replacing the newest rows is reported through
/// `anchor_status` even when the remaining links are intact. Rewriting the rows and
/// the anchor together in the same local file is still outside tamper-evidence.
pub async fn verify_chain(store: &Store, connection_id: Uuid) -> AppResult<AuditVerification> {
    // One read transaction gives the anchor and the rows a single WAL snapshot, so an
    // append that commits during the scan cannot look like a gap.
    let mut transaction = store.pool().begin().await?;
    let anchor: Option<(i64, String)> = sqlx::query_as(
        "SELECT entry_count, tail_hash FROM audit_chain_anchors WHERE connection_id = ?1",
    )
    .bind(connection_id.to_string())
    .fetch_optional(&mut *transaction)
    .await?;
    let mut rows = sqlx::query(
        "SELECT rowid AS audit_row_id, * FROM audit_log WHERE connection_id = ?1 ORDER BY rowid ASC",
    )
    .bind(connection_id.to_string())
    .fetch(&mut *transaction);
    let mut expected_prev: Option<String> = None;
    let mut first_bad_index = None;
    let mut first_bad_id = None;
    let mut first_bad_row_id = None;
    let mut entry_count = 0_i64;
    let mut tail_hash = None;
    while let Some(row) = rows.try_next().await? {
        let entry = row_to_audit(&row)?;
        // The stored prev_hash must equal the running tail…
        let link_matches = entry.prev_hash == expected_prev;
        // …and the stored hash must match a fresh recomputation.
        let fields = AuditFields {
            connection_id: entry.connection_id,
            ts: entry.ts,
            engine: entry.engine,
            agent_prompt: entry.agent_prompt.as_deref(),
            sql: &entry.sql,
            kind: entry.kind,
            action: &entry.action,
            approved_by: entry.approved_by.as_deref(),
            affected_estimate: entry.affected_estimate,
            error: entry.error.as_deref(),
        };
        let hash_matches = chain::compute_hash(entry.prev_hash.as_deref(), &fields) == entry.hash;
        if first_bad_index.is_none() && (!link_matches || !hash_matches) {
            first_bad_index = Some(entry_count);
            first_bad_id = Some(entry.id);
            first_bad_row_id = Some(row.try_get::<i64, _>("audit_row_id")?);
        }
        entry_count = entry_count.saturating_add(1);
        expected_prev = Some(entry.hash.clone());
        tail_hash = Some(entry.hash);
    }
    drop(rows);
    transaction.rollback().await?;
    let anchor_status = anchor_status(anchor.as_ref(), entry_count, tail_hash.as_deref());
    Ok(AuditVerification {
        ok: first_bad_index.is_none() && anchor_status == AuditAnchorStatus::Matched,
        first_bad_index,
        first_bad_id,
        first_bad_row_id,
        entry_count,
        tail_hash,
        anchor_status,
        anchored_count: anchor.map(|(count, _)| count),
    })
}

fn row_to_audit_summary(row: &sqlx::sqlite::SqliteRow) -> AppResult<(AuditEntrySummary, i64)> {
    Ok((
        AuditEntrySummary {
            id: store::parse_uuid(row.try_get("id")?)?,
            connection_id: store::parse_uuid(row.try_get("connection_id")?)?,
            ts: row.try_get("ts")?,
            engine: store::parse_engine(row.try_get("engine")?)?,
            sql_preview: row.try_get("sql_preview")?,
            sql_truncated: row.try_get::<i64, _>("sql_truncated")? != 0,
            kind: store::parse_kind(row.try_get("kind")?)?,
            action: row.try_get("action")?,
            approved_by: row.try_get("approved_by")?,
            affected_estimate: row.try_get("affected_estimate")?,
            error_preview: row.try_get("error_preview")?,
            error_truncated: row.try_get::<i64, _>("error_truncated")? != 0,
            prev_hash: row.try_get("prev_hash")?,
            hash: row.try_get("hash")?,
        },
        row.try_get("audit_row_id")?,
    ))
}

fn row_to_audit(r: &sqlx::sqlite::SqliteRow) -> AppResult<AuditEntry> {
    Ok(AuditEntry {
        id: store::parse_uuid(r.try_get("id")?)?,
        connection_id: store::parse_uuid(r.try_get("connection_id")?)?,
        ts: r.try_get("ts")?,
        engine: store::parse_engine(r.try_get("engine")?)?,
        agent_prompt: r.try_get("agent_prompt")?,
        sql: r.try_get("sql")?,
        kind: store::parse_kind(r.try_get("kind")?)?,
        action: r.try_get("action")?,
        approved_by: r.try_get("approved_by")?,
        affected_estimate: r.try_get("affected_estimate")?,
        error: r.try_get("error")?,
        prev_hash: r.try_get("prev_hash")?,
        hash: r.try_get("hash")?,
    })
}
