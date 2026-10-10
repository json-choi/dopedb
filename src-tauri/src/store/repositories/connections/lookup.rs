//! Scoped connection lookup and retained authority validation.

use super::super::super::*;
use crate::kernel::access::{CatalogCachePolicy, PinnedConnection, WorkspaceKind};

impl Store {
    /// Read the exact active connection authority in one SQLite snapshot. This
    /// projection contains no secret or target metadata; it exists so a hosted
    /// refresh can keep unrelated ACP conversations alive while fencing only a
    /// connection whose template or member-local binding revision changed.
    pub(crate) async fn active_connection_authority_fingerprint(
        &self,
    ) -> AppResult<Vec<(Uuid, i64, i64)>> {
        let rows: Vec<(String, i64, i64)> = sqlx::query_as(
            "WITH active AS (
                 SELECT w.id AS workspace_id,
                        w.kind AS workspace_kind,
                        account.value AS selected_account_id
                 FROM app_settings workspace
                 JOIN workspaces w
                   ON workspace.key = 'active_workspace_id'
                  AND workspace.value = w.id
                  AND w.lifecycle_state = 'active'
                 LEFT JOIN app_settings account
                   ON account.key = 'active_workspace_account_id'
             )
             SELECT c.id,
                    c.revision,
                    CASE WHEN c.remote_id IS NOT NULL
                         THEN COALESCE(binding.revision, 0) ELSE 0 END
             FROM active
             JOIN connections c
               ON c.workspace_id = active.workspace_id
              AND c.deleted_at IS NULL
             LEFT JOIN workspace_connection_bindings binding
               ON binding.connection_id = c.id
              AND binding.account_user_id = active.selected_account_id
             WHERE (active.workspace_kind = 'personal'
                    OR (active.selected_account_id IS NOT NULL AND EXISTS(
                        SELECT 1 FROM workspace_members member
                        WHERE member.workspace_id = active.workspace_id
                          AND member.user_id = active.selected_account_id
                          AND member.status = 'active'
                    )))
               AND (active.workspace_kind = 'personal'
                    OR (c.remote_id IS NOT NULL AND binding.connection_id IS NOT NULL)
                    OR c.account_user_id = active.selected_account_id)
             ORDER BY c.id",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|(id, connection_revision, binding_revision)| {
                if connection_revision < 1 || binding_revision < 0 {
                    return Err(AppError::Config(
                        "active connection authority revision is invalid".into(),
                    ));
                }
                Ok((parse_uuid(id)?, connection_revision, binding_revision))
            })
            .collect()
    }

    pub async fn list_connections(&self) -> AppResult<Vec<ConnectionProfile>> {
        let workspace = self.active_workspace().await?;
        let account_user_id = self.active_workspace_account_id().await?;
        if workspace.kind == WorkspaceKind::Team && account_user_id.is_none() {
            return Err(AppError::Config(
                "a team workspace has no active authenticated account".into(),
            ));
        }
        let rows = sqlx::query(
            "SELECT c.*,
                    b.username AS binding_username,
                    b.extra_params AS binding_extra_params,
                    b.secret_ref AS binding_secret_ref,
                    b.bound_endpoint AS binding_bound_endpoint,
                    b.workspace_access AS binding_workspace_access,
                    b.allow_writes AS binding_allow_writes
             FROM connections c
             LEFT JOIN workspace_connection_bindings b
               ON b.connection_id = c.id AND b.account_user_id = ?2
             WHERE c.workspace_id = ?1 AND c.deleted_at IS NULL
               AND (?3 = 'personal'
                    OR (c.remote_id IS NOT NULL AND b.connection_id IS NOT NULL)
                    OR c.account_user_id = ?2)
             ORDER BY c.name",
        )
        .bind(workspace.id.to_string())
        .bind(account_user_id)
        .bind(workspace_kind_str(workspace.kind))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_connection_with_binding).collect()
    }

    pub async fn get_connection(&self, id: Uuid) -> AppResult<ConnectionProfile> {
        let workspace = self.active_workspace().await?;
        let account_user_id = self.active_workspace_account_id().await?;
        if workspace.kind == WorkspaceKind::Team && account_user_id.is_none() {
            return Err(AppError::Config(
                "a team workspace has no active authenticated account".into(),
            ));
        }
        let row = sqlx::query(
            "SELECT c.*,
                    b.username AS binding_username,
                    b.extra_params AS binding_extra_params,
                    b.secret_ref AS binding_secret_ref,
                    b.bound_endpoint AS binding_bound_endpoint,
                    b.workspace_access AS binding_workspace_access,
                    b.allow_writes AS binding_allow_writes
             FROM connections c
             LEFT JOIN workspace_connection_bindings b
               ON b.connection_id = c.id AND b.account_user_id = ?3
             WHERE c.id = ?1 AND c.workspace_id = ?2 AND c.deleted_at IS NULL
               AND (?4 = 'personal'
                    OR (c.remote_id IS NOT NULL AND b.connection_id IS NOT NULL)
                    OR c.account_user_id = ?3)",
        )
        .bind(id.to_string())
        .bind(workspace.id.to_string())
        .bind(account_user_id)
        .bind(workspace_kind_str(workspace.kind))
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("connection {id}")))?;
        row_to_connection_with_binding(&row)
    }

    /// Resolve a readable connection and every local authority/revision value in one
    /// SQLite snapshot. Long-running services keep this pin and use conditional writes
    /// so a result completed after a workspace, account, template, or credential
    /// change is discarded instead of being published into the new scope.
    pub(crate) async fn pin_connection_for_read(&self, id: Uuid) -> AppResult<PinnedConnection> {
        self.pin_connection_with_access(id, true).await
    }

    /// Resolve connection metadata for local inspection. A Viewer may inspect
    /// definitions without receiving target-database execution authority.
    pub(crate) async fn pin_connection_for_view(&self, id: Uuid) -> AppResult<PinnedConnection> {
        self.pin_connection_with_access(id, false).await
    }

    async fn pin_connection_with_access(
        &self,
        id: Uuid,
        require_read: bool,
    ) -> AppResult<PinnedConnection> {
        let row = sqlx::query(
            "SELECT c.*,
                    b.username AS binding_username,
                    b.extra_params AS binding_extra_params,
                    b.secret_ref AS binding_secret_ref,
                    b.bound_endpoint AS binding_bound_endpoint,
                    b.workspace_access AS binding_workspace_access,
                    b.allow_writes AS binding_allow_writes,
                    active.workspace_id AS pinned_workspace_id,
                    active.workspace_kind AS pinned_workspace_kind,
                    active.selected_account_id AS pinned_selected_account_id,
                    active.account_scope AS pinned_account_scope,
                    active.scope_generation AS pinned_scope_generation,
                    c.revision AS pinned_connection_revision,
                    CASE WHEN c.remote_id IS NOT NULL
                         THEN COALESCE(b.revision, 0) ELSE 0 END
                         AS pinned_binding_revision,
                    CASE WHEN c.remote_id IS NOT NULL
                         THEN COALESCE(b.updated_at, '') ELSE '' END
                         AS pinned_binding_updated_at,
                    c.remote_id AS pinned_remote_id
             FROM (
                 SELECT w.id AS workspace_id,
                        w.kind AS workspace_kind,
                        account.value AS selected_account_id,
                        CASE WHEN w.kind = 'personal'
                             THEN 'personal' ELSE account.value END AS account_scope,
                        generation.value AS scope_generation
                 FROM app_settings workspace
                 JOIN workspaces w
                   ON workspace.key = 'active_workspace_id'
                  AND workspace.value = w.id
                  AND w.lifecycle_state = 'active'
                 LEFT JOIN app_settings account
                   ON account.key = 'active_workspace_account_id'
                 JOIN app_settings generation
                   ON generation.key = 'active_scope_generation'
             ) active
             JOIN connections c
               ON c.workspace_id = active.workspace_id
              AND c.deleted_at IS NULL
             LEFT JOIN workspace_connection_bindings b
               ON b.connection_id = c.id
              AND b.account_user_id = active.selected_account_id
             WHERE c.id = ?1
               AND (active.workspace_kind = 'personal'
                    OR active.selected_account_id IS NOT NULL)
               AND (active.workspace_kind = 'personal'
                    OR EXISTS(
                        SELECT 1 FROM workspace_members m
                        WHERE m.workspace_id = active.workspace_id
                          AND m.user_id = active.selected_account_id
                          AND m.status = 'active'
                    ))
               AND (active.workspace_kind = 'personal'
                    OR (c.remote_id IS NOT NULL AND b.connection_id IS NOT NULL)
                    OR c.account_user_id = active.selected_account_id)",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("connection {id}")))?;

        let profile = row_to_connection_with_binding(&row)?;
        if require_read && !profile.workspace_access.can_read() {
            return Err(AppError::Blocked {
                reason: "workspace role cannot execute this connection".into(),
            });
        }
        let scope = row_to_active_resource_scope(&row)?;
        let connection_revision: i64 = row.try_get("pinned_connection_revision")?;
        let binding_revision: i64 = row.try_get("pinned_binding_revision")?;
        let binding_updated_at: String = row.try_get("pinned_binding_updated_at")?;
        let requires_remote_rbac = row
            .try_get::<Option<String>, _>("pinned_remote_id")?
            .is_some();
        let valid_binding_revision = if requires_remote_rbac {
            binding_revision >= 1 && !binding_updated_at.is_empty()
        } else {
            binding_revision == 0 && binding_updated_at.is_empty()
        };
        if connection_revision < 1 || !valid_binding_revision {
            return Err(AppError::Config(
                "connection material has an invalid revision".into(),
            ));
        }
        let catalog_cache_policy = if profile.credential_mode == WorkspaceCredentialMode::Managed {
            CatalogCachePolicy::EphemeralOnly
        } else {
            CatalogCachePolicy::Persistent
        };
        Ok(PinnedConnection {
            scope,
            connection_id: id,
            connection_revision,
            binding_revision,
            binding_updated_at,
            profile,
            requires_remote_rbac,
            catalog_cache_policy,
        })
    }

    /// Check whether a retained connection pin still names the active scope and current
    /// local material. Shared-resource callers still need a fresh control-plane RBAC
    /// authorization; this method intentionally verifies only the local half.
    pub(crate) async fn is_pin_current(&self, pin: &PinnedConnection) -> AppResult<bool> {
        Self::is_pin_current_with_access(&self.pool, pin, false).await
    }

    pub(in crate::store) async fn is_pin_current_with_access<'executor, E>(
        executor: E,
        pin: &PinnedConnection,
        allow_view: bool,
    ) -> AppResult<bool>
    where
        E: Executor<'executor, Database = Sqlite>,
    {
        let current: bool = sqlx::query_scalar(
            "SELECT EXISTS(
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
                           IN ('read', 'write', 'manage')
                        OR (?10 AND COALESCE(b.workspace_access, 'view') = 'view'))
             )",
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
        .bind(allow_view)
        .fetch_one(executor)
        .await?;
        Ok(current)
    }
}
