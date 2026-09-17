//! Persistence and safety helpers shared by Terminal query planning and execution.

use chrono::Utc;
use uuid::Uuid;

use crate::audit::{self, RecordArgs};
use crate::connection::DbPool;
use crate::error::AppError;
use crate::kernel::access::PinnedConnection;
use crate::kernel::agent_policy::MAX_AGENT_ROWS;
use crate::kernel::identity::QueryRunId;
use crate::model::{Engine, HistoryEntry, QueryKind};
use crate::operations::canonical_hash;
use crate::safety::PoolRef;
use crate::store::Store;

use super::super::domain::AgentQueryInvocationOrigin;

pub(super) fn bounded_max_rows(requested: Option<u64>, configured: u64) -> u64 {
    requested.unwrap_or(configured).min(MAX_AGENT_ROWS)
}

pub(super) fn capture_agent_read_policy(
    pin: &PinnedConnection,
) -> Result<(serde_json::Value, String), AppError> {
    let snapshot = serde_json::json!({
        "accountScope": pin.scope.account_scope.storage_key(),
        "bindingRevision": pin.binding_revision,
        "bindingUpdatedAt": pin.binding_updated_at,
        "connectionRevision": pin.connection_revision,
        "credentialMode": pin.profile.credential_mode,
        "environment": pin.profile.env,
        "scopeGeneration": pin.scope.generation,
        "workspaceAccess": pin.profile.workspace_access,
        "workspaceId": pin.scope.workspace_id,
    });
    Ok((snapshot.clone(), canonical_hash(&snapshot)?))
}

pub(super) fn pool_ref(db: &DbPool) -> PoolRef<'_> {
    match db {
        DbPool::Postgres(pool) => PoolRef::Postgres(pool),
        DbPool::Mysql(pool) => PoolRef::Mysql(pool),
        DbPool::Sqlite(pool) => PoolRef::Sqlite(pool),
        DbPool::Bigquery(connection) => PoolRef::Bigquery(connection),
        DbPool::CloudflareD1(connection) => PoolRef::CloudflareD1(connection),
    }
}

pub(super) async fn audit_best_effort(
    store: &Store,
    connection_id: uuid::Uuid,
    engine: Engine,
    sql: &str,
    kind: QueryKind,
    action: &str,
    error: Option<String>,
) {
    if let Err(audit_error) = audit::record(
        store,
        RecordArgs {
            connection_id,
            engine,
            agent_prompt: None,
            sql: sql.to_string(),
            kind,
            action: action.to_string(),
            approved_by: None,
            affected_estimate: None,
            error,
        },
    )
    .await
    {
        tracing::error!("query audit insert failed: {audit_error}");
    }
}

pub(super) async fn persist_history(
    store: &Store,
    pin: &PinnedConnection,
    sql: &str,
    status: &str,
    rows: Option<i64>,
    duration_ms: Option<i64>,
    error: Option<String>,
) -> Result<QueryRunId, AppError> {
    let id = QueryRunId::from(Uuid::new_v4());
    store
        .insert_history_if_current(
            pin,
            &HistoryEntry {
                id: id.into(),
                connection_id: pin.connection_id,
                sql: sql.to_string(),
                kind: QueryKind::Read,
                status: status.to_string(),
                row_count: rows,
                duration_ms,
                error,
                executed_at: Utc::now(),
                origin: "agent".into(),
            },
        )
        .await?;
    Ok(id)
}

pub(super) async fn record_run_failure(
    store: &Store,
    pin: &PinnedConnection,
    sql: &str,
    engine: Engine,
    origin: AgentQueryInvocationOrigin,
    error: &AppError,
) {
    let message = error.to_string();
    audit_best_effort(
        store,
        pin.connection_id,
        engine,
        sql,
        QueryKind::Read,
        origin.run_audit_action(),
        Some(message.clone()),
    )
    .await;
    if let Err(history_error) =
        persist_history(store, pin, sql, "error", None, None, Some(message)).await
    {
        tracing::error!("query failure history insert failed: {history_error}");
    }
}
