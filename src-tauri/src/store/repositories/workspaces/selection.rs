//! Atomic account/workspace selection and account removal.

use super::super::super::*;
use crate::kernel::access::WorkspaceKind;

impl Store {
    /// Atomically select an account and workspace. Team scopes require an active
    /// membership for that exact account; Personal remains account-free.
    pub async fn activate_workspace(
        &self,
        id: Uuid,
        account_user_id: Option<&str>,
    ) -> AppResult<Workspace> {
        let mut tx = self.pool.begin().await?;
        let row =
            sqlx::query("SELECT * FROM workspaces WHERE id = ?1 AND lifecycle_state = 'active'")
                .bind(id.to_string())
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("workspace {id}")))?;
        let workspace = row_to_workspace(&row)?;
        if let Some(user_id) = account_user_id {
            let account_exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM workspace_accounts WHERE user_id = ?1)",
            )
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;
            if !account_exists {
                return Err(AppError::NotFound(format!("workspace account {user_id}")));
            }
            if workspace.kind == WorkspaceKind::Team {
                let membership_exists: bool = sqlx::query_scalar(
                    "SELECT EXISTS(
                         SELECT 1 FROM workspace_members
                         WHERE workspace_id = ?1 AND user_id = ?2 AND status = 'active'
                     )",
                )
                .bind(id.to_string())
                .bind(user_id)
                .fetch_one(&mut *tx)
                .await?;
                if !membership_exists {
                    return Err(AppError::NotFound(format!(
                        "workspace {id} for account {user_id}"
                    )));
                }
            }
        } else if workspace.kind == WorkspaceKind::Team {
            return Err(AppError::Config(
                "a team workspace must be selected with an authenticated account".into(),
            ));
        }

        let now = Utc::now();
        match account_user_id {
            Some(user_id) => {
                sqlx::query(
                    "INSERT INTO app_settings (key, value)
                     VALUES ('active_workspace_account_id', ?1)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
                sqlx::query(
                    "UPDATE workspace_accounts SET
                         last_workspace_id = CASE WHEN ?2 = 'team' THEN ?1 ELSE last_workspace_id END,
                         last_used_at = ?3,
                         updated_at = ?3
                     WHERE user_id = ?4",
                )
                .bind(id.to_string())
                .bind(workspace_kind_str(workspace.kind))
                .bind(now)
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
            }
            None => {
                sqlx::query("DELETE FROM app_settings WHERE key = 'active_workspace_account_id'")
                    .execute(&mut *tx)
                    .await?;
            }
        }
        sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES ('active_workspace_id', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(id.to_string())
        .execute(&mut *tx)
        .await?;
        bump_active_scope_generation(&mut tx).await?;
        tx.commit().await?;
        Ok(workspace)
    }

    /// Select an authenticated account without selecting a different workspace.
    /// Personal always remains active; a Team remains active only when the new account
    /// is a current member. Losing that exact authority falls back to Personal rather
    /// than guessing another Team from the account's membership list.
    pub async fn activate_workspace_account(&self, user_id: &str) -> AppResult<Workspace> {
        let workspace_id: Option<String> = sqlx::query_scalar(
            "SELECT CASE
                 WHEN w.kind = 'personal' THEN w.id
                 WHEN EXISTS(
                     SELECT 1 FROM workspace_members m
                     WHERE m.workspace_id = w.id
                       AND m.user_id = ?1
                       AND m.status = 'active'
                 ) THEN w.id
                 ELSE ?2
             END
             FROM app_settings active
             JOIN workspaces w
               ON active.key = 'active_workspace_id'
              AND active.value = w.id
              AND w.lifecycle_state = 'active'",
        )
        .bind(user_id)
        .bind(schema::PERSONAL_WORKSPACE_ID)
        .fetch_one(&self.pool)
        .await?;
        let id = Uuid::parse_str(
            workspace_id
                .as_deref()
                .unwrap_or(schema::PERSONAL_WORKSPACE_ID),
        )
        .map_err(|error| AppError::Config(error.to_string()))?;
        self.activate_workspace(id, Some(user_id)).await
    }

    pub async fn remove_workspace_account(&self, user_id: &str) -> AppResult<()> {
        let personal_id = schema::PERSONAL_WORKSPACE_ID;
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM workspace_members WHERE user_id = ?1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM workspace_accounts WHERE user_id = ?1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE workspaces SET lifecycle_state = 'archived', updated_at = ?1
             WHERE kind = 'team' AND NOT EXISTS (
                 SELECT 1 FROM workspace_members m
                 WHERE m.workspace_id = workspaces.id AND m.status = 'active'
             )",
        )
        .bind(now)
        .execute(&mut *tx)
        .await?;

        let active_account: Option<String> = sqlx::query_scalar(
            "SELECT value FROM app_settings WHERE key = 'active_workspace_account_id'",
        )
        .fetch_optional(&mut *tx)
        .await?;
        if active_account.as_deref() == Some(user_id) {
            let fallback_account: Option<String> = sqlx::query_scalar(
                "SELECT user_id FROM workspace_accounts ORDER BY last_used_at DESC LIMIT 1",
            )
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(fallback_account) = fallback_account.as_deref() {
                sqlx::query(
                    "UPDATE app_settings SET value = ?1
                     WHERE key = 'active_workspace_account_id'",
                )
                .bind(fallback_account)
                .execute(&mut *tx)
                .await?;
                let fallback_workspace: Option<String> = sqlx::query_scalar(
                    "SELECT CASE
                         WHEN w.kind = 'personal' THEN w.id
                         WHEN EXISTS(
                             SELECT 1 FROM workspace_members m
                             WHERE m.workspace_id = w.id
                               AND m.user_id = ?1
                               AND m.status = 'active'
                         ) THEN w.id
                         ELSE ?2
                     END
                     FROM app_settings active
                     JOIN workspaces w
                       ON active.key = 'active_workspace_id'
                      AND active.value = w.id
                      AND w.lifecycle_state = 'active'",
                )
                .bind(fallback_account)
                .bind(personal_id)
                .fetch_optional(&mut *tx)
                .await?;
                sqlx::query("UPDATE app_settings SET value = ?1 WHERE key = 'active_workspace_id'")
                    .bind(fallback_workspace.as_deref().unwrap_or(personal_id))
                    .execute(&mut *tx)
                    .await?;
            } else {
                sqlx::query("DELETE FROM app_settings WHERE key = 'active_workspace_account_id'")
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("UPDATE app_settings SET value = ?1 WHERE key = 'active_workspace_id'")
                    .bind(personal_id)
                    .execute(&mut *tx)
                    .await?;
            }
            bump_active_scope_generation(&mut tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn active_workspace(&self) -> AppResult<Workspace> {
        let row = sqlx::query(
            "SELECT w.* FROM workspaces w
             JOIN app_settings s ON s.key = 'active_workspace_id' AND s.value = w.id
             LEFT JOIN app_settings account
               ON account.key = 'active_workspace_account_id'
             WHERE w.lifecycle_state = 'active'
               AND (w.kind = 'personal'
                    OR (account.value IS NOT NULL AND EXISTS(
                        SELECT 1 FROM workspace_members m
                        WHERE m.workspace_id = w.id
                          AND m.user_id = account.value
                          AND m.status = 'active'
                    )))",
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::Config("no active workspace is configured".into()))?;
        row_to_workspace(&row)
    }

    pub async fn active_workspace_id(&self) -> AppResult<Uuid> {
        Ok(self.active_resource_scope().await?.workspace_id)
    }

    /// Local execution artifacts use a stable non-secret scope key. Personal data is
    /// device-local; team data follows the exact authenticated account selected with
    /// that workspace so caches, history, and Agent sessions cannot cross accounts.
    pub(crate) async fn active_local_scope(&self) -> AppResult<String> {
        Ok(self
            .active_resource_scope()
            .await?
            .account_scope
            .storage_key()
            .to_owned())
    }
}
