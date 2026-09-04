//! Connection creation, remote synchronization, and credential binding mutations.

use super::super::super::*;
use crate::kernel::access::WorkspaceKind;

impl Store {
    // ── connections ────────────────────────────────────────────────────────

    /// Accept a new UUID or one already owned by the active workspace. Callers that
    /// may touch the credential store use this before any secret-side effect.
    pub async fn ensure_connection_write_scope(&self, id: Uuid) -> AppResult<()> {
        let workspace = self.active_workspace().await?;
        let active_account = self.active_workspace_account_id().await?;
        let owner: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT workspace_id, account_user_id, remote_id FROM connections WHERE id = ?1",
        )
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        if let Some((workspace_id, account_user_id, remote_id)) = owner {
            let account_mismatch = workspace.kind == WorkspaceKind::Team
                && account_user_id.as_deref() != active_account.as_deref();
            if workspace_id != workspace.id.to_string() || account_mismatch || remote_id.is_some() {
                return Err(AppError::NotFound(format!("connection {id}")));
            }
        }
        Ok(())
    }

    /// Insert or update a connection profile; ensures a default safety row exists.
    pub async fn upsert_connection(&self, p: &ConnectionProfile) -> AppResult<ConnectionProfile> {
        if p.workspace_access != WorkspaceConnectionAccess::Local {
            return Err(AppError::Config(
                "shared connection templates cannot be edited as local connections".into(),
            ));
        }
        if p.credential_mode != WorkspaceCredentialMode::Local {
            return Err(AppError::Config(
                "local connections must use local credential mode".into(),
            ));
        }
        if p.provider_target.is_some() {
            return Err(AppError::Config(
                "local connections cannot set a managed provider target".into(),
            ));
        }
        let now = Utc::now();
        let extra = serde_json::to_string(&p.extra_params)?;
        let mut tx = self.pool.begin().await?;
        // Acquire SQLite's writer lock before observing the active scope. This makes
        // scope selection, ownership validation, and the revision bump one serialized
        // transaction even if another process instance touches the same database.
        sqlx::query("UPDATE app_settings SET value = value WHERE key = 'active_scope_generation'")
            .execute(&mut *tx)
            .await?;
        let active: Option<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT w.id, w.kind, account.value
             FROM app_settings workspace
             JOIN workspaces w
               ON workspace.key = 'active_workspace_id'
              AND workspace.value = w.id
              AND w.lifecycle_state = 'active'
             LEFT JOIN app_settings account
               ON account.key = 'active_workspace_account_id'
             WHERE w.kind = 'personal'
                OR (
                    account.value IS NOT NULL
                    AND EXISTS(
                        SELECT 1 FROM workspace_members member
                        WHERE member.workspace_id = w.id
                          AND member.user_id = account.value
                          AND member.status = 'active'
                    )
                )",
        )
        .fetch_optional(&mut *tx)
        .await?;
        let (workspace_id_raw, workspace_kind_raw, selected_account_id) =
            active.ok_or_else(|| AppError::Config("active workspace scope is invalid".into()))?;
        let workspace_id = parse_uuid(workspace_id_raw)?;
        let workspace_kind = parse_workspace_kind(workspace_kind_raw)?;
        let account_user_id = match workspace_kind {
            WorkspaceKind::Personal => None,
            WorkspaceKind::Team => Some(selected_account_id.ok_or_else(|| {
                AppError::Config("team-local connections require an active account".into())
            })?),
        };
        let persisted_revision: Option<i64> = sqlx::query_scalar(
            r#"INSERT INTO connections
                (id, name, engine, provider, driver_id, host, port, db_name, username, sslmode,
                 extra_params, secret_ref, readonly_default, allow_writes,
                 created_at, updated_at, env, schema_group, workspace_id, account_user_id,
                 revision, sync_status, workspace_access, credential_mode, deleted_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15,?16,?17,
                       ?18,?19,1,'local',?20,?21,NULL)
               ON CONFLICT(id) DO UPDATE SET
                 name=?2, engine=?3, provider=?4, driver_id=?5, host=?6, port=?7,
                 db_name=?8, username=?9, sslmode=?10, extra_params=?11, secret_ref=?12,
                 readonly_default=?13, allow_writes=?14, updated_at=?15,
                 env=?16, schema_group=?17, revision=connections.revision + 1,
                 sync_status='local', workspace_access=?20, credential_mode=?21,
                 deleted_at=NULL
               WHERE connections.workspace_id = ?18
                 AND connections.account_user_id IS ?19
                 AND connections.remote_id IS NULL
               RETURNING revision"#,
        )
        .bind(p.id.to_string())
        .bind(&p.name)
        .bind(engine_str(p.engine))
        .bind(provider_str(p.provider))
        .bind(&p.driver_id)
        .bind(&p.host)
        .bind(p.port as i64)
        .bind(&p.database)
        .bind(&p.username)
        .bind(&p.sslmode)
        .bind(extra)
        .bind(&p.secret_ref)
        .bind(p.readonly_default)
        .bind(p.allow_writes)
        .bind(now)
        .bind(&p.env)
        .bind(&p.schema_group)
        .bind(workspace_id.to_string())
        .bind(account_user_id)
        .bind(workspace_access_str(p.workspace_access))
        .bind(credential_mode_str(p.credential_mode))
        .fetch_optional(&mut *tx)
        .await?;
        persisted_revision.ok_or_else(|| AppError::NotFound(format!("connection {}", p.id)))?;

        // Guarantee a safety row for the connection (defaults on first insert).
        ensure_safety_row(&mut tx, p.id).await?;

        tx.commit().await?;

        Ok(p.clone())
    }

    /// Reconcile shared connection templates for one team workspace. Member-local
    /// fields live in `workspace_connection_bindings`; this table keeps only the
    /// redacted template and cached server permission.
    pub async fn sync_remote_connections(
        &self,
        workspace_id: Uuid,
        account_user_id: &str,
        connections: &[(ConnectionProfile, i64)],
    ) -> AppResult<Vec<Uuid>> {
        let membership_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM workspace_members
                 WHERE workspace_id = ?1 AND user_id = ?2 AND status = 'active'
             )",
        )
        .bind(workspace_id.to_string())
        .bind(account_user_id)
        .fetch_one(&self.pool)
        .await?;
        if !membership_exists {
            return Err(AppError::NotFound(format!(
                "workspace {workspace_id} for account {account_user_id}"
            )));
        }
        for (profile, _) in connections {
            if profile.workspace_access == WorkspaceConnectionAccess::Local
                || profile.credential_mode == WorkspaceCredentialMode::Local
            {
                return Err(AppError::Config(
                    "remote connections require team access and credential mode".into(),
                ));
            }
            let owner: Option<String> =
                sqlx::query_scalar("SELECT workspace_id FROM connections WHERE id = ?1")
                    .bind(profile.id.to_string())
                    .fetch_optional(&self.pool)
                    .await?;
            if owner.is_some_and(|owner| owner != workspace_id.to_string()) {
                return Err(AppError::Config(format!(
                    "remote connection {} conflicts with another workspace",
                    profile.id
                )));
            }
        }

        let now = Utc::now();
        let mut tx = self.pool.begin().await?;
        let existing_remote: Vec<String> = sqlx::query_scalar(
            "SELECT connection.id
             FROM connections connection
             JOIN workspace_connection_bindings binding
               ON binding.connection_id = connection.id
              AND binding.account_user_id = ?2
             WHERE connection.workspace_id = ?1
               AND connection.remote_id IS NOT NULL",
        )
        .bind(workspace_id.to_string())
        .bind(account_user_id)
        .fetch_all(&mut *tx)
        .await?;
        let incoming = connections
            .iter()
            .map(|(profile, _)| profile.id.to_string())
            .collect::<HashSet<_>>();
        let mut removed_credential_ids = HashSet::new();
        for id in existing_remote.iter().filter(|id| !incoming.contains(*id)) {
            let secret_refs: Vec<String> = sqlx::query_scalar(
                "SELECT secret_ref FROM workspace_connection_bindings
                 WHERE connection_id = ?1 AND account_user_id = ?2
                   AND secret_ref IS NOT NULL",
            )
            .bind(id)
            .bind(account_user_id)
            .fetch_all(&mut *tx)
            .await?;
            for secret_ref in secret_refs {
                match Uuid::parse_str(&secret_ref) {
                    Ok(credential_id) => {
                        removed_credential_ids.insert(credential_id);
                    }
                    Err(error) => tracing::warn!(
                        connection_id = id.as_str(),
                        %error,
                        "ignored an invalid shared credential reference during cleanup"
                    ),
                }
            }
            sqlx::query(
                "DELETE FROM workspace_connection_bindings
                 WHERE connection_id = ?1 AND account_user_id = ?2",
            )
            .bind(id)
            .bind(account_user_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE connections SET deleted_at = ?2, updated_at = ?2
                 WHERE id = ?1 AND workspace_id = ?3 AND remote_id IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM workspace_connection_bindings binding
                     WHERE binding.connection_id = connections.id
                   )",
            )
            .bind(id)
            .bind(now)
            .bind(workspace_id.to_string())
            .execute(&mut *tx)
            .await?;
        }

        for (profile, revision) in connections {
            let provider_target = profile
                .provider_target
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?;
            if profile.credential_mode == WorkspaceCredentialMode::Managed {
                let secret_refs: Vec<String> = sqlx::query_scalar(
                    "SELECT secret_ref FROM workspace_connection_bindings
                     WHERE connection_id = ?1 AND secret_ref IS NOT NULL",
                )
                .bind(profile.id.to_string())
                .fetch_all(&mut *tx)
                .await?;
                for secret_ref in secret_refs {
                    match Uuid::parse_str(&secret_ref) {
                        Ok(credential_id) => {
                            removed_credential_ids.insert(credential_id);
                        }
                        Err(error) => tracing::warn!(
                            connection_id = %profile.id,
                            %error,
                            "ignored an invalid shared credential reference during managed synchronization"
                        ),
                    }
                }
                sqlx::query(
                    "UPDATE workspace_connection_bindings
                     SET username = '', extra_params = '{}', secret_ref = NULL,
                         revision = revision + 1, updated_at = ?2
                     WHERE connection_id = ?1
                       AND (username <> '' OR extra_params <> '{}' OR secret_ref IS NOT NULL)",
                )
                .bind(profile.id.to_string())
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
            sqlx::query(
                r#"INSERT INTO connections
                    (id, name, engine, provider, driver_id, host, port, db_name, username,
                     sslmode, extra_params, secret_ref, readonly_default, allow_writes,
                     created_at, updated_at, env, schema_group, workspace_id, remote_id,
                     account_user_id, revision, sync_status, workspace_access,
                     credential_mode, provider_target, deleted_at)
                   VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15,
                           ?16,?17,?18,?1,NULL,?19,'synced',?20,?21,?22,NULL)
                   ON CONFLICT(id) DO UPDATE SET
                     name=?2, engine=?3, provider=?4, driver_id=?5, host=?6, port=?7,
                     db_name=?8, sslmode=?10, readonly_default=?13, allow_writes=?14,
                     updated_at=?15, env=?16, schema_group=?17, remote_id=?1, revision=?19,
                     sync_status='synced', workspace_access=?20, credential_mode=?21,
                     provider_target=?22, deleted_at=NULL
                   WHERE connections.workspace_id=?18"#,
            )
            .bind(profile.id.to_string())
            .bind(&profile.name)
            .bind(engine_str(profile.engine))
            .bind(provider_str(profile.provider))
            .bind(&profile.driver_id)
            .bind(&profile.host)
            .bind(profile.port as i64)
            .bind(&profile.database)
            .bind("")
            .bind(&profile.sslmode)
            .bind("{}")
            .bind(Option::<String>::None)
            .bind(profile.readonly_default)
            .bind(profile.allow_writes)
            .bind(now)
            .bind(&profile.env)
            .bind(&profile.schema_group)
            .bind(workspace_id.to_string())
            .bind(*revision)
            .bind(workspace_access_str(profile.workspace_access))
            .bind(credential_mode_str(profile.credential_mode))
            .bind(provider_target)
            .execute(&mut *tx)
            .await?;
            reconcile_safety_write_ceiling(
                &mut tx,
                profile.id,
                profile.credential_mode == WorkspaceCredentialMode::Managed
                    && profile.allow_writes
                    && profile.workspace_access.can_write(),
            )
            .await?;
            sqlx::query(
                "INSERT INTO workspace_connection_bindings
                    (connection_id, account_user_id, username, extra_params, secret_ref,
                     workspace_access, allow_writes, updated_at)
                 VALUES (?1, ?2, '', '{}', NULL, ?3, ?4, ?5)
                 ON CONFLICT(connection_id, account_user_id) DO UPDATE SET
                    workspace_access = excluded.workspace_access,
                    allow_writes = excluded.allow_writes,
                    revision = workspace_connection_bindings.revision + 1,
                    updated_at = excluded.updated_at
                 WHERE workspace_connection_bindings.workspace_access
                           IS NOT excluded.workspace_access
                    OR workspace_connection_bindings.allow_writes
                           IS NOT excluded.allow_writes",
            )
            .bind(profile.id.to_string())
            .bind(account_user_id)
            .bind(workspace_access_str(profile.workspace_access))
            .bind(profile.allow_writes && profile.workspace_access.can_write())
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(removed_credential_ids.into_iter().collect())
    }

    /// Remove the local cache row for a just-created remote template after the server
    /// confirms rollback. This is intentionally narrower than user-facing deletion.
    pub async fn purge_remote_connection_cache(
        &self,
        workspace_id: Uuid,
        connection_id: Uuid,
    ) -> AppResult<()> {
        sqlx::query(
            "DELETE FROM connections
             WHERE id = ?1 AND workspace_id = ?2 AND remote_id = ?1",
        )
        .bind(connection_id.to_string())
        .bind(workspace_id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Save one account's local overlay for a shared template. The secret value remains
    /// in the OS credential store; only its opaque item id enters SQLite.
    pub async fn bind_connection_credentials(
        &self,
        id: Uuid,
        account_user_id: &str,
        username: &str,
        extra_params: &HashMap<String, String>,
        secret_ref: Option<&str>,
    ) -> AppResult<ConnectionProfile> {
        let row = sqlx::query(
            "SELECT c.*,
                    b.username AS binding_username,
                    b.extra_params AS binding_extra_params,
                    b.secret_ref AS binding_secret_ref,
                    b.workspace_access AS binding_workspace_access,
                    b.allow_writes AS binding_allow_writes
             FROM connections c
             JOIN workspace_members m
               ON m.workspace_id = c.workspace_id
              AND m.user_id = ?2 AND m.status = 'active'
             JOIN workspace_connection_bindings b
               ON b.connection_id = c.id AND b.account_user_id = ?2
             WHERE c.id = ?1 AND c.remote_id IS NOT NULL AND c.deleted_at IS NULL",
        )
        .bind(id.to_string())
        .bind(account_user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("shared connection {id}")))?;
        let mut profile = row_to_connection_with_binding(&row)?;
        if !profile.workspace_access.can_read() {
            return Err(AppError::Blocked {
                reason: "workspace role cannot execute this connection".into(),
            });
        }
        if profile.credential_mode != WorkspaceCredentialMode::MemberLocal {
            return Err(AppError::Blocked {
                reason: "this shared connection uses automatically managed credentials".into(),
            });
        }
        let extra_params_json = serde_json::to_string(extra_params)?;
        sqlx::query(
            "INSERT INTO workspace_connection_bindings
                (connection_id, account_user_id, username, extra_params, secret_ref, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(connection_id, account_user_id) DO UPDATE SET
                username = excluded.username,
                extra_params = excluded.extra_params,
                secret_ref = excluded.secret_ref,
                revision = workspace_connection_bindings.revision + 1,
                updated_at = excluded.updated_at
             WHERE workspace_connection_bindings.username IS NOT excluded.username
                OR workspace_connection_bindings.extra_params IS NOT excluded.extra_params
                OR workspace_connection_bindings.secret_ref IS NOT excluded.secret_ref",
        )
        .bind(id.to_string())
        .bind(account_user_id)
        .bind(username.trim())
        .bind(extra_params_json)
        .bind(secret_ref)
        .bind(Utc::now())
        .execute(&self.pool)
        .await?;
        profile.username = username.trim().to_string();
        profile.extra_params = extra_params.clone();
        profile.secret_ref = secret_ref.map(str::to_string);
        Ok(profile)
    }
}
