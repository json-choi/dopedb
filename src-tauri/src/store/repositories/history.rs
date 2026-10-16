//! Scope-pinned query history persistence and Analysis Article provenance reads.

use super::super::*;
use crate::kernel::access::PinnedConnection;

const HISTORY_PAGE_SIZE: usize = 100;
const HISTORY_SQL_PREVIEW_CHARS: i64 = 512;
const HISTORY_ERROR_PREVIEW_CHARS: i64 = 256;

impl Store {
    // ── query history ──────────────────────────────────────────────────────

    /// Persist an execution artifact only if the connection still has the exact
    /// workspace/account/material identity that authorized the operation. This is
    /// intentionally one `INSERT .. SELECT` statement: checking a pin and inserting
    /// separately would let a scope switch place an old operation in the new account.
    pub(crate) async fn insert_history_if_current(
        &self,
        pin: &PinnedConnection,
        h: &HistoryEntry,
    ) -> AppResult<()> {
        if h.connection_id != pin.connection_id {
            return Err(AppError::Config(
                "query history does not match its connection pin".into(),
            ));
        }
        let result = sqlx::query(
            r#"INSERT INTO query_history
                (id, connection_id, account_scope, sql, kind, status, row_count,
                 duration_ms, error, executed_at, origin, target_database,
                 target_namespace)
               SELECT ?10, ?5, ?9, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
               WHERE EXISTS(
                   SELECT 1
                   FROM app_settings workspace
                   JOIN workspaces w
                     ON workspace.key = 'active_workspace_id'
                    AND workspace.value = w.id
                    AND w.lifecycle_state = 'active'
                   LEFT JOIN app_settings account
                     ON account.key = 'active_workspace_account_id'
                   JOIN app_settings generation
                     ON generation.key = 'active_scope_generation'
                   JOIN connections c
                     ON c.id = ?5
                    AND c.workspace_id = w.id
                    AND c.deleted_at IS NULL
                   LEFT JOIN workspace_connection_bindings b
                     ON b.connection_id = c.id
                    AND b.account_user_id = account.value
                   WHERE w.id = ?1
                     AND w.kind = ?2
                     AND account.value IS ?3
                     AND generation.value = ?4
                     AND c.revision = ?6
                     AND CASE WHEN c.remote_id IS NOT NULL
                              THEN COALESCE(b.revision, 0) ELSE 0 END = ?7
                     AND CASE WHEN c.remote_id IS NOT NULL
                              THEN COALESCE(b.updated_at, '') ELSE '' END = ?8
                     AND CASE WHEN w.kind = 'personal'
                              THEN 'personal' ELSE account.value END = ?9
                     AND (w.kind = 'personal'
                          OR EXISTS(
                              SELECT 1 FROM workspace_members m
                              WHERE m.workspace_id = w.id
                                AND m.user_id = account.value
                                AND m.status = 'active'
                          ))
                     AND (w.kind = 'personal'
                          OR c.remote_id IS NOT NULL
                          OR c.account_user_id = account.value)
                     AND (c.remote_id IS NULL
                          OR COALESCE(b.workspace_access, 'view')
                             IN ('read', 'write', 'manage'))
               )"#,
        )
        .bind(pin.scope.workspace_id.to_string())
        .bind(workspace_kind_str(pin.scope.workspace_kind))
        .bind(pin.scope.selected_account_id.as_deref())
        .bind(pin.scope.generation.to_string())
        .bind(pin.connection_id.to_string())
        .bind(pin.connection_revision)
        .bind(pin.binding_revision)
        .bind(&pin.binding_updated_at)
        .bind(pin.scope.account_scope.storage_key())
        .bind(h.id.to_string())
        .bind(&h.sql)
        .bind(kind_str(h.kind))
        .bind(&h.status)
        .bind(h.row_count)
        .bind(h.duration_ms)
        .bind(&h.error)
        .bind(h.executed_at)
        .bind(&h.origin)
        .bind(&h.database)
        .bind(&h.namespace)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(AppError::Blocked {
                reason: "workspace scope changed before query history could be saved".into(),
            });
        }
        Ok(())
    }

    pub async fn list_history_page(
        &self,
        connection_id: Uuid,
        cursor: Option<HistoryCursor>,
        search: Option<&str>,
        status: Option<&str>,
        origin: Option<&str>,
    ) -> AppResult<HistoryPage> {
        self.get_connection(connection_id).await?;
        let account_scope = self.active_local_scope().await?;
        let cursor_time = cursor.as_ref().map(|value| value.executed_at);
        let cursor_row_id = cursor.as_ref().map(|value| value.row_id);
        let rows = sqlx::query(
            "SELECT rowid AS history_row_id, id, connection_id,
                    substr(sql, 1, ?8) AS sql_preview,
                    length(sql) > ?8 AS sql_truncated,
                    kind, status, row_count, duration_ms,
                    CASE WHEN error IS NULL THEN NULL ELSE substr(error, 1, ?9) END
                      AS error_preview,
                    COALESCE(length(error) > ?9, 0) AS error_truncated,
                    executed_at, origin
             FROM query_history
             WHERE connection_id = ?1 AND account_scope = ?2
               AND (
                 ?3 IS NULL OR executed_at < ?3
                 OR (executed_at = ?3 AND rowid < ?4)
               )
               AND (?5 IS NULL OR instr(lower(sql), lower(?5)) > 0)
               AND (?6 IS NULL OR status = ?6)
               AND (?7 IS NULL OR origin = ?7)
             ORDER BY executed_at DESC, rowid DESC
             LIMIT ?10",
        )
        .bind(connection_id.to_string())
        .bind(&account_scope)
        .bind(cursor_time)
        .bind(cursor_row_id)
        .bind(search)
        .bind(status)
        .bind(origin)
        .bind(HISTORY_SQL_PREVIEW_CHARS)
        .bind(HISTORY_ERROR_PREVIEW_CHARS)
        .bind(i64::try_from(HISTORY_PAGE_SIZE + 1).expect("history page size fits i64"))
        .fetch_all(&self.pool)
        .await?;
        let mut items = rows
            .iter()
            .map(row_to_history_summary)
            .collect::<AppResult<Vec<_>>>()?;
        let has_more = items.len() > HISTORY_PAGE_SIZE;
        if has_more {
            items.pop();
        }
        let next_cursor = if has_more {
            items.last().map(|(summary, row_id)| HistoryCursor {
                executed_at: summary.executed_at,
                row_id: *row_id,
            })
        } else {
            None
        };

        // Filter facets describe the whole connection history, not one page, so the
        // two DISTINCT scans run only for the first page. Later pages return empty
        // facets and the reader keeps the ones from the first page.
        let (statuses, origins) = if cursor.is_none() {
            let statuses = sqlx::query_scalar::<_, String>(
                "SELECT DISTINCT status FROM query_history
                 WHERE connection_id = ?1 AND account_scope = ?2
                 ORDER BY status LIMIT 32",
            )
            .bind(connection_id.to_string())
            .bind(&account_scope)
            .fetch_all(&self.pool)
            .await?;
            let origins = sqlx::query_scalar::<_, String>(
                "SELECT DISTINCT origin FROM query_history
                 WHERE connection_id = ?1 AND account_scope = ?2
                 ORDER BY origin LIMIT 32",
            )
            .bind(connection_id.to_string())
            .bind(&account_scope)
            .fetch_all(&self.pool)
            .await?;
            (statuses, origins)
        } else {
            (Vec::new(), Vec::new())
        };

        Ok(HistoryPage {
            items: items.into_iter().map(|(summary, _)| summary).collect(),
            next_cursor,
            statuses,
            origins,
        })
    }

    pub async fn get_history_entry(
        &self,
        connection_id: Uuid,
        history_id: Uuid,
    ) -> AppResult<HistoryEntry> {
        self.get_connection(connection_id).await?;
        let account_scope = self.active_local_scope().await?;
        let row = sqlx::query(
            "SELECT * FROM query_history
             WHERE id = ?1 AND connection_id = ?2 AND account_scope = ?3",
        )
        .bind(history_id.to_string())
        .bind(connection_id.to_string())
        .bind(account_scope)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("query history {history_id}")))?;
        row_to_history(&row)
    }
}

fn row_to_history_summary(row: &sqlx::sqlite::SqliteRow) -> AppResult<(HistoryEntrySummary, i64)> {
    Ok((
        HistoryEntrySummary {
            id: parse_uuid(row.try_get("id")?)?,
            connection_id: parse_uuid(row.try_get("connection_id")?)?,
            sql_preview: row.try_get("sql_preview")?,
            sql_truncated: row.try_get::<i64, _>("sql_truncated")? != 0,
            kind: parse_kind(row.try_get("kind")?)?,
            status: row.try_get("status")?,
            row_count: row.try_get("row_count")?,
            duration_ms: row.try_get("duration_ms")?,
            error_preview: row.try_get("error_preview")?,
            error_truncated: row.try_get::<i64, _>("error_truncated")? != 0,
            executed_at: row.try_get("executed_at")?,
            origin: row.try_get("origin")?,
        },
        row.try_get("history_row_id")?,
    ))
}
