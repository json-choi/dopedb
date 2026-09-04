//! Remembered account and workspace-membership reconciliation.

use super::super::super::*;
use super::scope::{
    active_scope_from_row, active_team_membership_authority,
    repair_active_scope_after_membership_change,
};
use crate::kernel::access::ActiveResourceScope;

impl Store {
    // ── workspaces ─────────────────────────────────────────────────────────

    /// List locally available, active workspaces.
    pub async fn list_workspaces(&self) -> AppResult<Vec<Workspace>> {
        let rows = sqlx::query(
            "SELECT * FROM workspaces WHERE lifecycle_state = 'active' ORDER BY kind, name",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_workspace).collect()
    }

    /// Return locally remembered accounts and their current hosted memberships. This
    /// index contains display metadata only; session tokens remain in the OS keychain.
    pub async fn workspace_accounts(&self) -> AppResult<Vec<WorkspaceAuthAccount>> {
        let account_rows = sqlx::query(
            "SELECT user_id, email, display_name FROM workspace_accounts
             ORDER BY last_used_at DESC, created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut accounts = Vec::with_capacity(account_rows.len());
        for row in account_rows {
            let user_id: String = row.try_get("user_id")?;
            let membership_rows = sqlx::query(
                "SELECT workspace_id, role FROM workspace_members
                 WHERE user_id = ?1 AND status = 'active'
                 ORDER BY joined_at ASC",
            )
            .bind(&user_id)
            .fetch_all(&self.pool)
            .await?;
            let memberships = membership_rows
                .iter()
                .map(|membership| {
                    Ok(WorkspaceAccountMembership {
                        workspace_id: Uuid::parse_str(membership.try_get("workspace_id")?)
                            .map(WorkspaceId::from)
                            .map_err(|error| AppError::Config(error.to_string()))?,
                        role: parse_workspace_role(membership.try_get("role")?)?,
                    })
                })
                .collect::<AppResult<Vec<_>>>()?;
            accounts.push(WorkspaceAuthAccount {
                user: WorkspaceAuthUser {
                    id: AccountId::new(user_id).ok_or_else(|| {
                        AppError::Config("stored workspace account id is empty".into())
                    })?,
                    email: row.try_get("email")?,
                    display_name: row.try_get("display_name")?,
                },
                memberships,
            });
        }
        Ok(accounts)
    }

    pub async fn active_workspace_account_id(&self) -> AppResult<Option<String>> {
        Ok(sqlx::query_scalar(
            "SELECT value FROM app_settings WHERE key = 'active_workspace_account_id'",
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    /// Read the complete active scope in one SQLite statement. Callers that need a
    /// durable identity for a longer operation must retain this value instead of
    /// re-reading workspace and account settings independently.
    pub(crate) async fn active_resource_scope(&self) -> AppResult<ActiveResourceScope> {
        let row = sqlx::query(
            "SELECT w.id AS workspace_id,
                    w.kind AS workspace_kind,
                    account.value AS selected_account_id,
                    generation.value AS scope_generation
             FROM app_settings active
             JOIN workspaces w
               ON active.key = 'active_workspace_id'
              AND active.value = w.id
              AND w.lifecycle_state = 'active'
             LEFT JOIN app_settings account
               ON account.key = 'active_workspace_account_id'
             JOIN app_settings generation
               ON generation.key = 'active_scope_generation'
             WHERE w.kind = 'personal'
                OR (account.value IS NOT NULL AND EXISTS(
                    SELECT 1 FROM workspace_members m
                    WHERE m.workspace_id = w.id
                      AND m.user_id = account.value
                      AND m.status = 'active'
                ))",
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::Config("no active workspace scope is configured".into()))?;
        active_scope_from_row(&row)
    }

    /// Remember public account identity before a possibly-offline membership refresh.
    /// This makes a completed device login durable without ever persisting its token.
    pub async fn remember_workspace_account(&self, user: &WorkspaceAuthUser) -> AppResult<()> {
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO workspace_accounts
                (user_id, email, display_name, created_at, updated_at, last_used_at)
             VALUES (?1, ?2, ?3, ?4, ?4, ?4)
             ON CONFLICT(user_id) DO UPDATE SET
                email = excluded.email,
                display_name = excluded.display_name,
                updated_at = excluded.updated_at",
        )
        .bind(user.id.as_str())
        .bind(&user.email)
        .bind(&user.display_name)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Reconcile one Better Auth account independently. A workspace stays visible while
    /// any remembered account still has an active membership, which prevents signing in
    /// as a second account from hiding the first account's workspaces.
    pub async fn sync_account_workspaces(
        &self,
        user: &WorkspaceAuthUser,
        workspaces: &[(Uuid, String, WorkspaceRole)],
    ) -> AppResult<()> {
        let personal_id = Uuid::parse_str(schema::PERSONAL_WORKSPACE_ID)
            .map_err(|_| AppError::Config("invalid personal workspace id".into()))?;
        if workspaces.iter().any(|(id, _, _)| *id == personal_id) {
            return Err(AppError::Config(
                "remote workspace conflicts with the Personal Workspace".into(),
            ));
        }
        self.remember_workspace_account(user).await?;
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;
        let previous_team_authority = active_team_membership_authority(&mut tx).await?;
        sqlx::query(
            "UPDATE workspace_members SET status = 'archived'
             WHERE user_id = ?1",
        )
        .bind(user.id.as_str())
        .execute(&mut *tx)
        .await?;
        for (id, name, role) in workspaces {
            sqlx::query(
                "INSERT INTO workspaces
                    (id, name, kind, lifecycle_state, created_at, updated_at)
                 VALUES (?1, ?2, 'team', 'active', ?3, ?3)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    lifecycle_state = 'active',
                    updated_at = excluded.updated_at
                 WHERE workspaces.kind = 'team'",
            )
            .bind(id.to_string())
            .bind(name)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            let member_id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO workspace_members
                    (id, workspace_id, user_id, display_name, role, status, joined_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6)
                 ON CONFLICT(workspace_id, user_id) WHERE user_id IS NOT NULL DO UPDATE SET
                    display_name = excluded.display_name,
                    role = excluded.role,
                    status = 'active'",
            )
            .bind(member_id.to_string())
            .bind(id.to_string())
            .bind(user.id.as_str())
            .bind(&user.display_name)
            .bind(workspace_role_str(*role))
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
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
        sqlx::query(
            "UPDATE workspace_accounts SET last_workspace_id = NULL
             WHERE user_id = ?1 AND last_workspace_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM workspace_members m
                 WHERE m.user_id = ?1
                   AND m.workspace_id = workspace_accounts.last_workspace_id
                   AND m.status = 'active'
             )",
        )
        .bind(user.id.as_str())
        .execute(&mut *tx)
        .await?;
        repair_active_scope_after_membership_change(&mut tx, now, previous_team_authority.as_ref())
            .await?;
        tx.commit().await?;
        Ok(())
    }
}
