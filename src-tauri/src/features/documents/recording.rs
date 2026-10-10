//! Shared document row bounds, policy projection, audit, and history recording.

use super::*;

pub(super) fn bounded_agent_rows(requested: Option<u64>, configured: u64) -> u64 {
    requested.unwrap_or(configured).min(MAX_AGENT_ROWS)
}

pub(super) fn bounded_desktop_rows(configured: u64) -> u64 {
    configured.clamp(1, MAX_DESKTOP_ROWS)
}

pub(super) fn agent_history_origin() -> &'static str {
    "agent"
}

pub(super) fn desktop_blocked_reason(
    settings: &SafetySettings,
    classification: &crate::model::Classification,
) -> Option<String> {
    if !matches!(classification.kind, QueryKind::Read) {
        return Some(
            classification
                .notes
                .first()
                .cloned()
                .unwrap_or_else(|| "document writes are not supported".into()),
        );
    }
    match safety::decide(settings, classification) {
        GateDecision::Block { reason } => Some(reason),
        GateDecision::AutoRun | GateDecision::RequireApproval => None,
    }
}

pub(super) fn document_operation_risk(
    classification: &crate::model::Classification,
) -> OperationRiskLevel {
    match classification.risk {
        crate::model::RiskLevel::Low => OperationRiskLevel::Low,
        crate::model::RiskLevel::Medium => OperationRiskLevel::Medium,
        crate::model::RiskLevel::High => OperationRiskLevel::High,
    }
}

/// Terminal CLI audit and history behavior. History is deliberately best-effort for
/// document reads and keeps the shared `"agent"` history origin.
pub(super) async fn record_agent_execution(
    store: &Store,
    pin: &PinnedConnection,
    query_text: &str,
    rows: Option<i64>,
    duration_ms: Option<i64>,
    error: Option<String>,
) {
    audit_best_effort(
        store,
        pin,
        query_text,
        QueryKind::Read,
        "cli:run_document_query",
        None,
        error.clone(),
    )
    .await;
    let status = if error.is_some() { "error" } else { "ok" };
    if let Err(history_error) = persist_history(
        store,
        pin,
        query_text,
        QueryKind::Read,
        status,
        rows,
        duration_ms,
        error,
        agent_history_origin(),
    )
    .await
    {
        tracing::error!("agent document-query history insert failed: {history_error}");
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn record_desktop_outcome(
    store: &Store,
    pin: &PinnedConnection,
    query_text: &str,
    kind: QueryKind,
    action: &str,
    status: &str,
    rows: Option<i64>,
    duration_ms: Option<i64>,
    error: Option<String>,
    history_origin: &str,
) {
    audit_best_effort(store, pin, query_text, kind, action, rows, error.clone()).await;
    if let Err(history_error) = persist_history(
        store,
        pin,
        query_text,
        kind,
        status,
        rows,
        duration_ms,
        error,
        history_origin,
    )
    .await
    {
        tracing::error!("desktop document-query history insert failed: {history_error}");
    }
}

pub(super) async fn audit_best_effort(
    store: &Store,
    pin: &PinnedConnection,
    query_text: &str,
    kind: QueryKind,
    action: &str,
    affected_estimate: Option<i64>,
    error: Option<String>,
) {
    if let Err(audit_error) = audit::record(
        store,
        RecordArgs {
            connection_id: pin.connection_id,
            engine: pin.profile.engine,
            agent_prompt: None,
            sql: query_text.to_string(),
            kind,
            action: action.to_string(),
            approved_by: None,
            affected_estimate,
            error,
        },
    )
    .await
    {
        tracing::error!("document-query audit insert failed: {audit_error}");
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn persist_history(
    store: &Store,
    pin: &PinnedConnection,
    query_text: &str,
    kind: QueryKind,
    status: &str,
    rows: Option<i64>,
    duration_ms: Option<i64>,
    error: Option<String>,
    origin: &str,
) -> Result<(), AppError> {
    store
        .insert_history_if_current(
            pin,
            &HistoryEntry {
                id: Uuid::new_v4(),
                connection_id: pin.connection_id,
                sql: query_text.to_string(),
                kind,
                status: status.to_string(),
                row_count: rows,
                duration_ms,
                error,
                executed_at: Utc::now(),
                origin: origin.to_string(),
                database: None,
                namespace: None,
            },
        )
        .await
}
