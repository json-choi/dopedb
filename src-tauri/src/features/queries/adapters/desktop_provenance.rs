//! Best-effort desktop query audit and history persistence.

use chrono::Utc;
use std::time::Instant;
use uuid::Uuid;

use crate::audit::{self, RecordArgs};
use crate::kernel::access::PinnedConnection;
use crate::model::{HistoryEntry, QueryKind};
use crate::store::Store;

use super::desktop_trace::{AUDIT_PERSIST, HISTORY_PERSIST};

pub(super) struct DesktopRunRecord<'a> {
    pub(super) sql: &'a str,
    pub(super) kind: QueryKind,
    pub(super) action: &'a str,
    pub(super) status: &'a str,
    pub(super) row_count: Option<i64>,
    pub(super) duration_ms: Option<i64>,
    pub(super) error: Option<String>,
    pub(super) origin: &'a str,
    /// The database and schema the console selected for the run, recorded so
    /// History reopens the SQL there; empty means the connection's default.
    pub(super) database: &'a str,
    pub(super) namespace: Option<&'a str>,
}

/// Append the established desktop audit and history pair. Logging remains
/// best-effort so provenance outages do not mask the target operation result.
pub(super) async fn record_desktop_run(
    store: &Store,
    pin: &PinnedConnection,
    record: DesktopRunRecord<'_>,
) {
    let audit_started = Instant::now();
    if let Err(error) = audit::record(
        store,
        RecordArgs {
            connection_id: pin.connection_id,
            engine: pin.profile.engine,
            agent_prompt: None,
            sql: record.sql.to_string(),
            kind: record.kind,
            action: record.action.to_string(),
            approved_by: None,
            affected_estimate: record.row_count,
            error: record.error.clone(),
        },
    )
    .await
    {
        tracing::error!(
            connection_id = %pin.connection_id,
            action = record.action,
            %error,
            "desktop SQL audit record failed"
        );
    }
    tracing::debug!(
        phase = AUDIT_PERSIST,
        duration_ms = audit_started.elapsed().as_millis() as u64,
        "desktop query provenance phase"
    );
    let history_started = Instant::now();
    if let Err(error) = store
        .insert_history_if_current(
            pin,
            &HistoryEntry {
                id: Uuid::new_v4(),
                connection_id: pin.connection_id,
                sql: record.sql.to_string(),
                kind: record.kind,
                status: record.status.to_string(),
                row_count: record.row_count,
                duration_ms: record.duration_ms,
                error: record.error,
                executed_at: Utc::now(),
                origin: record.origin.to_string(),
                database: Some(record.database)
                    .filter(|database| !database.is_empty())
                    .map(str::to_string),
                namespace: record
                    .namespace
                    .filter(|namespace| !namespace.is_empty())
                    .map(str::to_string),
            },
        )
        .await
    {
        tracing::error!(
            connection_id = %pin.connection_id,
            %error,
            "desktop SQL history insert failed"
        );
    }
    tracing::debug!(
        phase = HISTORY_PERSIST,
        duration_ms = history_started.elapsed().as_millis() as u64,
        "desktop query provenance phase"
    );
}
