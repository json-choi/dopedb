//! Bounded workspace/account-local persistence for the Services result projection.
//!
//! Snapshots are display-only execution artifacts. They never become executable SQL,
//! operation grants, credentials, or authority inputs after being loaded.

use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::features::queries::{
    validate_query_service_session_snapshot, QueryServiceSessionSnapshot,
};

use super::Store;

const MAX_PERSISTED_QUERY_SERVICE_SESSIONS: i64 = 20;

impl Store {
    pub(crate) async fn list_query_service_sessions(
        &self,
        expected_workspace_id: uuid::Uuid,
        expected_account_scope: &str,
    ) -> AppResult<Vec<serde_json::Value>> {
        let scope = self.active_resource_scope().await?;
        if scope.workspace_id != expected_workspace_id
            || scope.account_scope.storage_key() != expected_account_scope
        {
            return Err(AppError::Blocked {
                reason: "workspace scope changed before Services results could be loaded".into(),
            });
        }
        let rows = sqlx::query(
            "SELECT id, connection_id, updated_at, status, snapshot_json
             FROM query_service_sessions
             WHERE workspace_id = ?1 AND account_scope = ?2
             ORDER BY updated_at DESC
             LIMIT ?3",
        )
        .bind(scope.workspace_id.to_string())
        .bind(scope.account_scope.storage_key())
        .bind(MAX_PERSISTED_QUERY_SERVICE_SESSIONS)
        .fetch_all(&self.pool)
        .await?;
        let mut snapshots = Vec::with_capacity(rows.len());
        for row in rows {
            let snapshot_json: String = row.try_get("snapshot_json")?;
            let snapshot = serde_json::from_str(&snapshot_json)?;
            let validated = validate_query_service_session_snapshot(snapshot)?;
            let stored_connection_id: String = row.try_get("connection_id")?;
            let stored_updated_at: i64 = row.try_get("updated_at")?;
            let stored_status: String = row.try_get("status")?;
            if validated.id != row.try_get::<String, _>("id")?
                || validated.connection_id.to_string() != stored_connection_id
                || validated.updated_at != stored_updated_at
                || validated.status.as_str() != stored_status
            {
                return Err(AppError::Config(
                    "persisted Services metadata does not match its snapshot".into(),
                ));
            }
            snapshots.push(validated.snapshot);
        }
        Ok(snapshots)
    }

    pub(crate) async fn save_query_service_session(
        &self,
        expected_workspace_id: uuid::Uuid,
        expected_account_scope: &str,
        snapshot: QueryServiceSessionSnapshot,
    ) -> AppResult<()> {
        let pin = self
            .pin_connection_for_read(snapshot.connection_id.into())
            .await?;
        if pin.scope.workspace_id != expected_workspace_id
            || pin.scope.account_scope.storage_key() != expected_account_scope
        {
            return Err(AppError::Blocked {
                reason: "workspace scope changed before the Services result could be saved".into(),
            });
        }
        let snapshot_json = serde_json::to_string(&snapshot.snapshot)?;
        let mut transaction = self.pool.begin().await?;
        if !Store::is_pin_current_with_access(&mut *transaction, &pin, false).await? {
            return Err(AppError::Blocked {
                reason: "workspace scope changed before the Services result could be saved".into(),
            });
        }
        let result = sqlx::query(
            "INSERT INTO query_service_sessions(
                 workspace_id, account_scope, id, connection_id, updated_at, status,
                 snapshot_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(workspace_id, account_scope, id) DO UPDATE SET
                 updated_at = excluded.updated_at,
                 status = excluded.status,
                 snapshot_json = excluded.snapshot_json
             WHERE query_service_sessions.connection_id = excluded.connection_id
               AND query_service_sessions.updated_at <= excluded.updated_at",
        )
        .bind(pin.scope.workspace_id.to_string())
        .bind(pin.scope.account_scope.storage_key())
        .bind(&snapshot.id)
        .bind(snapshot.connection_id.to_string())
        .bind(snapshot.updated_at)
        .bind(snapshot.status.as_str())
        .bind(snapshot_json)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() == 0 {
            let existing_connection_id: Option<String> = sqlx::query_scalar(
                "SELECT connection_id
                 FROM query_service_sessions
                 WHERE workspace_id = ?1 AND account_scope = ?2 AND id = ?3",
            )
            .bind(pin.scope.workspace_id.to_string())
            .bind(pin.scope.account_scope.storage_key())
            .bind(&snapshot.id)
            .fetch_optional(&mut *transaction)
            .await?;
            if existing_connection_id != Some(snapshot.connection_id.to_string()) {
                return Err(AppError::Blocked {
                    reason: "Services session identity is already bound to another connection"
                        .into(),
                });
            }
        }
        sqlx::query(
            "DELETE FROM query_service_sessions
             WHERE workspace_id = ?1 AND account_scope = ?2
               AND id NOT IN (
                   SELECT id
                   FROM query_service_sessions
                   WHERE workspace_id = ?1 AND account_scope = ?2
                   ORDER BY updated_at DESC
                   LIMIT ?3
               )",
        )
        .bind(pin.scope.workspace_id.to_string())
        .bind(pin.scope.account_scope.storage_key())
        .bind(MAX_PERSISTED_QUERY_SERVICE_SESSIONS)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }
}
