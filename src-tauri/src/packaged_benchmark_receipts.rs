//! Packaged benchmark backend action receipts.

use super::*;

#[cfg(feature = "packaged-benchmark")]
pub(super) fn packaged_result_receipt(
    action: String,
    metric: crate::features::queries::PackagedResultStoreMetric,
) -> AppResult<PackagedBackendReceipt> {
    let first_to_batch = metric
        .first_row_ms
        .map(|first| (metric.elapsed_ms - first).max(0.0));
    Ok(PackagedBackendReceipt {
        action,
        backend_request_to_first_row_ms: metric.first_row_ms,
        backend_first_row_to_ipc_batch_ms: first_to_batch,
        ipc_payload_bytes: metric.encoded_bytes,
        sqlite_transaction_count: metric.transaction_count,
        retained_bytes: metric.retained_bytes,
        row_count: metric.row_count,
        columns: Vec::new(),
        rows: Vec::new(),
    })
}

#[cfg(feature = "packaged-benchmark")]
pub(super) fn packaged_skill_reload_receipt(action: String) -> AppResult<PackagedBackendReceipt> {
    use dopedb_protocol::{SkillInstallState, SkillTargetSelection};

    // Recreate the manager from the process home instead of reusing AppState.
    // This exercises the same embedded bundle + disk inventory boundary that a
    // clean app restart uses, without weakening the production command surface.
    let manager = crate::skills::SkillManager::new()?;
    let status = manager.status(SkillTargetSelection::All)?;
    if status.targets.len() != 2
        || status
            .targets
            .iter()
            .any(|target| target.state != SkillInstallState::ManagedCurrent)
        || status.targets.iter().any(|target| {
            target.installed_revision != Some(status.skill.release_revision)
                || target.installed_package_digest.as_deref()
                    != Some(status.skill.package_digest.as_str())
        })
    {
        return Err(AppError::Config(
            "packaged Skill inventory did not survive manager recreation".into(),
        ));
    }
    Ok(PackagedBackendReceipt {
        action,
        backend_request_to_first_row_ms: None,
        backend_first_row_to_ipc_batch_ms: None,
        ipc_payload_bytes: 0,
        sqlite_transaction_count: 0,
        retained_bytes: 0,
        row_count: u64::try_from(status.targets.len())
            .map_err(|_| AppError::Config("packaged Skill target count is invalid".into()))?,
        columns: Vec::new(),
        rows: Vec::new(),
    })
}

#[cfg(feature = "packaged-benchmark")]
pub(super) async fn packaged_agent_receipt(
    store: &crate::store::Store,
    action: String,
) -> AppResult<PackagedBackendReceipt> {
    use crate::features::agents::domain::{
        AcpSessionEvent, AcpSessionEventPayload, AcpSessionLifecycle, AcpSessionSummary,
        AgentProvider,
    };
    use crate::kernel::identity::{AcpSessionId, ConnectionId};

    const EVENT_COUNT: u64 = 10_000;
    const BATCH_EVENTS: u64 = 64;
    let session_id = AcpSessionId::from(Uuid::from_u128(0xbed0_0000_0000_0000_0000_0000_0000_ac10));
    let connection_id =
        ConnectionId::from(Uuid::from_u128(0xbed0_0000_0000_0000_0000_0000_0000_0001));
    let created_at = chrono::DateTime::from_timestamp(1_767_225_600, 0)
        .ok_or_else(|| AppError::Config("packaged Agent timestamp is invalid".into()))?;
    let summary = AcpSessionSummary {
        id: session_id,
        connection_id,
        provider: AgentProvider::Codex,
        title: "Packaged benchmark".into(),
        lifecycle: AcpSessionLifecycle::Running,
        acp_session_id: Some("packaged-benchmark-session".into()),
        knowledge_grant_id: None,
        project_environment_id: None,
        environment_revision: None,
        knowledge_sources: Vec::new(),
        graph_revision_ids: Vec::new(),
        environment_connections: Vec::new(),
        knowledge_scopes: Vec::new(),
        write_connection_id: None,
        error: None,
        created_at,
        updated_at: created_at + chrono::Duration::minutes(10),
    };
    let scope = store.active_resource_scope().await?;
    let started = Instant::now();
    let mut first_batch_ms = None;
    let mut transaction_count = 0_u64;
    for first_sequence in (1..=EVENT_COUNT).step_by(BATCH_EVENTS as usize) {
        let last_sequence = (first_sequence + BATCH_EVENTS - 1).min(EVENT_COUNT);
        let events = (first_sequence..=last_sequence)
            .map(|sequence| AcpSessionEvent {
                session_id,
                sequence,
                created_at: created_at + chrono::Duration::milliseconds(sequence as i64 * 60),
                payload: AcpSessionEventPayload::SessionUpdate {
                    update: serde_json::json!({
                        "sessionUpdate": "agent_message_chunk",
                        "messageId": "packaged-benchmark-message",
                        "content": { "type": "text", "text": sequence % 10 },
                    }),
                },
            })
            .collect::<Vec<_>>();
        store
            .persist_agent_acp_events(&scope, &summary, &events)
            .await?;
        transaction_count = transaction_count.saturating_add(1);
        first_batch_ms.get_or_insert_with(|| benchmark_elapsed_ms(started));
    }
    let retained_bytes: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(length(CAST(payload AS BLOB))), 0) \
         FROM agent_acp_events WHERE session_id = ?1",
    )
    .bind(session_id.to_string())
    .fetch_one(store.pool())
    .await?;
    let elapsed = benchmark_elapsed_ms(started);
    Ok(PackagedBackendReceipt {
        action,
        backend_request_to_first_row_ms: first_batch_ms,
        backend_first_row_to_ipc_batch_ms: first_batch_ms.map(|first| (elapsed - first).max(0.0)),
        ipc_payload_bytes: 0,
        sqlite_transaction_count: transaction_count,
        retained_bytes: u64::try_from(retained_bytes).map_err(|_| {
            AppError::Config("packaged Agent retained byte count is invalid".into())
        })?,
        row_count: EVENT_COUNT,
        columns: Vec::new(),
        rows: Vec::new(),
    })
}

#[cfg(feature = "packaged-benchmark")]
pub(super) fn benchmark_elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1_000.0
}

#[cfg(feature = "packaged-benchmark")]
pub(super) async fn packaged_read_receipt(
    store: &crate::store::Store,
    action: String,
) -> AppResult<PackagedBackendReceipt> {
    let (statement, expected_rows, page_limit) = match action.as_str() {
        "query-first-batch" => (
            "WITH RECURSIVE counter(value) AS ( \
                 SELECT 0 UNION ALL SELECT value + 1 FROM counter WHERE value < 255 \
             ) SELECT value, value % 1000, value % 17 FROM counter",
            256_u64,
            256_usize,
        ),
        "history-10k" => (
            "SELECT rowid, COALESCE(duration_ms, 0), COALESCE(row_count, 0) \
             FROM query_history ORDER BY executed_at DESC, rowid DESC LIMIT 101",
            10_000,
            101,
        ),
        "audit-100k" => (
            "SELECT rowid, COALESCE(affected_estimate, 0), length(sql) \
             FROM audit_log ORDER BY rowid DESC LIMIT 51",
            100_000,
            51,
        ),
        "local-history-50" => (
            "SELECT local_revision, length(content), 0 \
             FROM sql_document_revisions ORDER BY local_revision DESC LIMIT 21",
            50,
            21,
        ),
        "analysis-article-local-results" => (
            "SELECT article_revision, length(ciphertext), length(result_hash) \
             FROM analysis_article_local_results ORDER BY created_at DESC LIMIT 8",
            8,
            8,
        ),
        _ => {
            return Err(AppError::Config(
                "unsupported packaged SQLite action".into(),
            ))
        }
    };
    let started = Instant::now();
    let mut stream = sqlx::query(statement).fetch(store.pool());
    let first = stream
        .try_next()
        .await?
        .ok_or_else(|| AppError::Config("packaged SQLite fixture is empty".into()))?;
    let first_row_ms = started.elapsed().as_secs_f64() * 1_000.0;
    let mut rows = vec![numeric_row(&first)?];
    while rows.len() < page_limit {
        let Some(row) = stream.try_next().await? else {
            break;
        };
        rows.push(numeric_row(&row)?);
    }
    drop(stream);
    let encoded = serde_json::to_vec(&rows)?;
    let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
    Ok(PackagedBackendReceipt {
        action,
        backend_request_to_first_row_ms: Some(first_row_ms),
        backend_first_row_to_ipc_batch_ms: Some((elapsed - first_row_ms).max(0.0)),
        ipc_payload_bytes: encoded.len() as u64,
        sqlite_transaction_count: 1,
        retained_bytes: encoded.len() as u64,
        row_count: expected_rows,
        columns: vec!["metric_a".into(), "metric_b".into(), "metric_c".into()],
        rows,
    })
}

#[cfg(feature = "packaged-benchmark")]
pub(super) fn numeric_row(row: &sqlx::sqlite::SqliteRow) -> AppResult<Vec<i64>> {
    Ok(vec![row.try_get(0)?, row.try_get(1)?, row.try_get(2)?])
}
