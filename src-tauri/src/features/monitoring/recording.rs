//! Monitoring role SQL projection and audit/history recording.

use super::*;

pub(super) const fn monitoring_role_sql(enabled: bool) -> &'static str {
    if enabled {
        "GRANT pg_monitor TO CURRENT_USER"
    } else {
        "REVOKE pg_monitor FROM CURRENT_USER"
    }
}

pub(super) struct MonitoringRunRecord<'a> {
    pub(super) sql: &'a str,
    pub(super) status: &'a str,
    pub(super) error: Option<String>,
    pub(super) approved_by: Option<&'a str>,
}

pub(super) async fn record_monitoring_change(
    store: &Store,
    pin: &PinnedConnection,
    record: MonitoringRunRecord<'_>,
) {
    let action = if record.status == "blocked" {
        "monitoring:blocked"
    } else if record.sql.starts_with("GRANT") {
        "monitoring:grant"
    } else {
        "monitoring:revoke"
    };
    if let Err(error) = audit::record(
        store,
        RecordArgs {
            connection_id: pin.connection_id,
            engine: pin.profile.engine,
            agent_prompt: None,
            sql: record.sql.into(),
            kind: QueryKind::Privilege,
            action: action.into(),
            approved_by: record.approved_by.map(str::to_string),
            affected_estimate: None,
            error: record.error.clone(),
        },
    )
    .await
    {
        tracing::error!(
            connection_id = %pin.connection_id,
            %error,
            "monitoring audit record failed"
        );
    }
    if let Err(error) = store
        .insert_history_if_current(
            pin,
            &HistoryEntry {
                id: Uuid::new_v4(),
                connection_id: pin.connection_id,
                sql: record.sql.into(),
                kind: QueryKind::Privilege,
                status: record.status.into(),
                row_count: None,
                duration_ms: None,
                error: record.error,
                executed_at: Utc::now(),
                origin: "manual".into(),
                database: None,
                namespace: None,
            },
        )
        .await
    {
        tracing::error!(
            connection_id = %pin.connection_id,
            %error,
            "monitoring history insert failed"
        );
    }
}
