//! Workspace-scoped persistence for current ACP conversation projections.
//!
//! Only opaque session ids and bounded UI events live here. Provider tokens,
//! refresh credentials, broker capabilities, and prompt context rows are never
//! persisted by this repository.

use std::collections::VecDeque;

use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::features::agents::domain::{
    AcpSessionEvent, AcpSessionFocus, AcpSessionLifecycle, AcpSessionSummary, AgentProvider,
};
use crate::features::knowledge::domain::KnowledgeSessionScope;
use crate::kernel::access::ActiveResourceScope;
use crate::kernel::identity::{AcpSessionId, ConnectionId};

use super::{parse_uuid, Store};

const MAX_PERSISTED_EVENTS: i64 = 512;
const MAX_PERSISTED_BYTES: i64 = 4 * 1024 * 1024;
const MAX_EVENT_BYTES: usize = 512 * 1024;
const MAX_PERSISTED_SESSIONS_PER_SCOPE: i64 = 100;
const ACP_SESSION_METADATA_UNAVAILABLE: &str = "agent_session_metadata_unavailable";

impl Store {
    pub(crate) async fn recover_interrupted_agent_acp_sessions(&self) -> AppResult<()> {
        sqlx::query(
            "UPDATE agent_acp_sessions
             SET lifecycle = 'closed',
                 error = NULL,
                 updated_at = ?1
             WHERE lifecycle IN ('starting', 'ready', 'running', 'waiting_permission')",
        )
        .bind(chrono::Utc::now())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub(crate) async fn list_agent_acp_sessions(&self) -> AppResult<Vec<AcpSessionSummary>> {
        let scope = self.active_resource_scope().await?;
        let rows = sqlx::query(
            "SELECT * FROM agent_acp_sessions
             WHERE workspace_id = ?1 AND account_scope = ?2
             ORDER BY updated_at DESC
             LIMIT ?3",
        )
        .bind(scope.workspace_id.to_string())
        .bind(scope.account_scope.storage_key())
        .bind(MAX_PERSISTED_SESSIONS_PER_SCOPE)
        .fetch_all(&self.pool)
        .await?;
        let mut sessions = Vec::with_capacity(rows.len());
        for row in &rows {
            match row_to_summary(row) {
                Ok(summary) => sessions.push(summary),
                Err(error) => {
                    let session_id = row
                        .try_get::<String, _>("id")
                        .unwrap_or_else(|_| "unreadable".into());
                    tracing::warn!(
                        session_id = %session_id,
                        %error,
                        "skipping an unreadable persisted ACP session"
                    );
                }
            }
        }
        Ok(sessions)
    }

    pub(crate) async fn focus_agent_acp_session(
        &self,
        id: AcpSessionId,
        after_sequence: Option<u64>,
    ) -> AppResult<AcpSessionFocus> {
        let scope = self.active_resource_scope().await?;
        let summary_row = sqlx::query(
            "SELECT * FROM agent_acp_sessions
             WHERE id = ?1 AND workspace_id = ?2 AND account_scope = ?3",
        )
        .bind(id.to_string())
        .bind(scope.workspace_id.to_string())
        .bind(scope.account_scope.storage_key())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Agent session not found".into()))?;
        let summary = row_to_summary(&summary_row)?;
        let rows = sqlx::query(
            "SELECT sequence, created_at, payload
             FROM agent_acp_events
             WHERE session_id = ?1
             ORDER BY sequence ASC",
        )
        .bind(id.to_string())
        .fetch_all(&self.pool)
        .await?;
        let mut events = VecDeque::with_capacity(rows.len());
        for row in rows {
            events.push_back(row_to_event(id, &row)?);
        }
        let earliest = events.front().map(|event| event.sequence);
        let replay_truncated = after_sequence
            .zip(earliest)
            .is_some_and(|(after, first)| after.saturating_add(1) < first);
        Ok(AcpSessionFocus {
            session: summary,
            events: events
                .into_iter()
                .filter(|event| after_sequence.is_none_or(|after| event.sequence > after))
                .collect(),
            replay_truncated,
        })
    }

    pub(crate) async fn persist_agent_acp_session(
        &self,
        scope: &ActiveResourceScope,
        summary: &AcpSessionSummary,
    ) -> AppResult<()> {
        let mut transaction = self.pool.begin().await?;
        upsert_session(&mut *transaction, scope, summary).await?;
        prune_sessions(&mut *transaction, scope).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn discard_agent_acp_events_through(
        &self,
        scope: &ActiveResourceScope,
        id: AcpSessionId,
        sequence: u64,
    ) -> AppResult<()> {
        let sequence = i64::try_from(sequence)
            .map_err(|_| AppError::Config("the ACP event sequence exceeded SQLite range".into()))?;
        sqlx::query(
            "DELETE FROM agent_acp_events
             WHERE session_id = ?1 AND sequence <= ?2
               AND EXISTS (
                   SELECT 1 FROM agent_acp_sessions
                   WHERE id = ?1 AND workspace_id = ?3 AND account_scope = ?4
               )",
        )
        .bind(id.to_string())
        .bind(sequence)
        .bind(scope.workspace_id.to_string())
        .bind(scope.account_scope.storage_key())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub(crate) async fn persist_agent_acp_events(
        &self,
        scope: &ActiveResourceScope,
        summary: &AcpSessionSummary,
        events: &[AcpSessionEvent],
    ) -> AppResult<()> {
        if events.is_empty() {
            return Ok(());
        }
        let mut rows = Vec::with_capacity(events.len());
        for event in events {
            if event.session_id != summary.id {
                return Err(AppError::Config(
                    "an ACP persistence batch crossed session boundaries".into(),
                ));
            }
            let payload = serde_json::to_string(&event.payload)?;
            if payload.len() > MAX_EVENT_BYTES {
                return Err(AppError::Blocked {
                    reason: "the ACP event exceeded the local replay limit".into(),
                });
            }
            rows.push((
                i64::try_from(event.sequence).map_err(|_| {
                    AppError::Config("the ACP event sequence exceeded SQLite range".into())
                })?,
                event.created_at,
                payload,
            ));
        }
        let mut transaction = self.pool.begin().await?;
        upsert_session(&mut *transaction, scope, summary).await?;
        for (sequence, created_at, payload) in rows {
            sqlx::query(
                "INSERT OR IGNORE INTO agent_acp_events(
                     session_id, sequence, created_at, payload
                 ) VALUES (?1, ?2, ?3, ?4)",
            )
            .bind(summary.id.to_string())
            .bind(sequence)
            .bind(created_at)
            .bind(payload)
            .execute(&mut *transaction)
            .await?;
        }
        sqlx::query(
            "DELETE FROM agent_acp_events
             WHERE session_id = ?1
               AND sequence NOT IN (
                   SELECT sequence FROM agent_acp_events
                   WHERE session_id = ?1
                   ORDER BY sequence DESC
                   LIMIT ?2
               )",
        )
        .bind(summary.id.to_string())
        .bind(MAX_PERSISTED_EVENTS)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "DELETE FROM agent_acp_events
             WHERE session_id = ?1
               AND sequence IN (
                   SELECT sequence FROM (
                       SELECT sequence,
                              SUM(length(CAST(payload AS BLOB))) OVER (
                                  ORDER BY sequence DESC
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                              ) AS retained_bytes
                       FROM agent_acp_events
                       WHERE session_id = ?1
                   )
                   WHERE retained_bytes > ?2
               )",
        )
        .bind(summary.id.to_string())
        .bind(MAX_PERSISTED_BYTES)
        .execute(&mut *transaction)
        .await?;
        prune_sessions(&mut *transaction, scope).await?;
        transaction.commit().await?;
        Ok(())
    }
}

async fn prune_sessions<'e, E>(executor: E, scope: &ActiveResourceScope) -> AppResult<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    sqlx::query(
        "DELETE FROM agent_acp_sessions
         WHERE workspace_id = ?1
           AND account_scope = ?2
           AND lifecycle NOT IN ('starting', 'ready', 'running', 'waiting_permission')
           AND id NOT IN (
               SELECT id FROM agent_acp_sessions
               WHERE workspace_id = ?1
                 AND account_scope = ?2
                 AND lifecycle NOT IN ('starting', 'ready', 'running', 'waiting_permission')
               ORDER BY updated_at DESC
               LIMIT max(0, ?3 - (
                   SELECT COUNT(*) FROM agent_acp_sessions
                   WHERE workspace_id = ?1
                     AND account_scope = ?2
                     AND lifecycle IN ('starting', 'ready', 'running', 'waiting_permission')
               ))
           )",
    )
    .bind(scope.workspace_id.to_string())
    .bind(scope.account_scope.storage_key())
    .bind(MAX_PERSISTED_SESSIONS_PER_SCOPE)
    .execute(executor)
    .await?;
    Ok(())
}

async fn upsert_session<'e, E>(
    executor: E,
    scope: &ActiveResourceScope,
    summary: &AcpSessionSummary,
) -> AppResult<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    sqlx::query(
        "INSERT INTO agent_acp_sessions(
             id, connection_id, workspace_id, account_scope, provider, title,
             lifecycle, acp_session_id, knowledge_scopes, write_connection_id,
             error, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             lifecycle = excluded.lifecycle,
             acp_session_id = excluded.acp_session_id,
             error = excluded.error,
             updated_at = excluded.updated_at
         WHERE excluded.updated_at >= agent_acp_sessions.updated_at",
    )
    .bind(summary.id.to_string())
    .bind(summary.connection_id.to_string())
    .bind(scope.workspace_id.to_string())
    .bind(scope.account_scope.storage_key())
    .bind(provider_str(summary.provider))
    .bind(&summary.title)
    .bind(lifecycle_str(summary.lifecycle))
    .bind(&summary.acp_session_id)
    .bind(serde_json::to_string(&summary.knowledge_scopes)?)
    .bind(summary.write_connection_id.map(|value| value.to_string()))
    .bind(&summary.error)
    .bind(summary.created_at)
    .bind(summary.updated_at)
    .execute(executor)
    .await?;
    Ok(())
}

fn row_to_summary(row: &sqlx::sqlite::SqliteRow) -> AppResult<AcpSessionSummary> {
    let mut summary = AcpSessionSummary {
        id: AcpSessionId::from(parse_uuid(row.try_get("id")?)?),
        connection_id: ConnectionId::from(parse_uuid(row.try_get("connection_id")?)?),
        provider: parse_provider(row.try_get("provider")?)?,
        title: row.try_get("title")?,
        lifecycle: parse_lifecycle(row.try_get("lifecycle")?)?,
        acp_session_id: row.try_get("acp_session_id")?,
        knowledge_scopes: Vec::new(),
        write_connection_id: None,
        error: row.try_get("error")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    };
    if let Err(error) = hydrate_session_metadata(row, &mut summary) {
        tracing::warn!(
            session_id = %summary.id,
            %error,
            "preserving an ACP transcript with unreadable access metadata"
        );
        summary.lifecycle = AcpSessionLifecycle::Failed;
        summary.acp_session_id = None;
        summary.knowledge_scopes.clear();
        summary.write_connection_id = None;
        summary.error = Some(ACP_SESSION_METADATA_UNAVAILABLE.into());
    }
    Ok(summary)
}

fn hydrate_session_metadata(
    row: &sqlx::sqlite::SqliteRow,
    summary: &mut AcpSessionSummary,
) -> AppResult<()> {
    summary.knowledge_scopes = serde_json::from_str::<Vec<KnowledgeSessionScope>>(
        &row.try_get::<String, _>("knowledge_scopes")?,
    )?;
    summary.write_connection_id = row
        .try_get::<Option<String>, _>("write_connection_id")?
        .map(parse_uuid)
        .transpose()?;
    Ok(())
}

fn row_to_event(
    session_id: AcpSessionId,
    row: &sqlx::sqlite::SqliteRow,
) -> AppResult<AcpSessionEvent> {
    let sequence: i64 = row.try_get("sequence")?;
    Ok(AcpSessionEvent {
        session_id,
        sequence: u64::try_from(sequence)
            .map_err(|_| AppError::Config("invalid persisted ACP event sequence".into()))?,
        created_at: row.try_get("created_at")?,
        payload: serde_json::from_str(row.try_get::<String, _>("payload")?.as_str())?,
    })
}

fn provider_str(provider: AgentProvider) -> &'static str {
    match provider {
        AgentProvider::Codex => "codex",
        AgentProvider::Claude => "claude",
    }
}

fn parse_provider(value: String) -> AppResult<AgentProvider> {
    match value.as_str() {
        "claude" => Ok(AgentProvider::Claude),
        "codex" => Ok(AgentProvider::Codex),
        other => Err(AppError::Config(format!(
            "unknown persisted ACP provider '{other}'"
        ))),
    }
}

fn lifecycle_str(lifecycle: AcpSessionLifecycle) -> &'static str {
    match lifecycle {
        AcpSessionLifecycle::Starting => "starting",
        AcpSessionLifecycle::Ready => "ready",
        AcpSessionLifecycle::Running => "running",
        AcpSessionLifecycle::WaitingPermission => "waiting_permission",
        AcpSessionLifecycle::Failed => "failed",
        AcpSessionLifecycle::Closed => "closed",
    }
}

fn parse_lifecycle(value: String) -> AppResult<AcpSessionLifecycle> {
    match value.as_str() {
        "starting" => Ok(AcpSessionLifecycle::Starting),
        "ready" => Ok(AcpSessionLifecycle::Ready),
        "running" => Ok(AcpSessionLifecycle::Running),
        "waiting_permission" => Ok(AcpSessionLifecycle::WaitingPermission),
        "failed" => Ok(AcpSessionLifecycle::Failed),
        "closed" => Ok(AcpSessionLifecycle::Closed),
        other => Err(AppError::Config(format!(
            "unknown persisted ACP lifecycle '{other}'"
        ))),
    }
}
