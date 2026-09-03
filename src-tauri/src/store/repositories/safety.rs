//! Per-connection safety policy persistence.

use super::super::*;

type SafetyConnectionRow = (i64, String, String, bool, Option<String>, String, String);

pub(in crate::store) async fn ensure_safety_row(
    tx: &mut Transaction<'_, Sqlite>,
    connection_id: Uuid,
) -> AppResult<()> {
    sqlx::query("INSERT OR IGNORE INTO connection_safety (connection_id) VALUES (?1)")
        .bind(connection_id.to_string())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub(in crate::store) async fn reconcile_safety_write_ceiling(
    tx: &mut Transaction<'_, Sqlite>,
    connection_id: Uuid,
    write_ceiling: bool,
) -> AppResult<()> {
    ensure_safety_row(tx, connection_id).await?;
    // Workspace authority is an upper bound. A refresh may revoke a local
    // device opt-in, but it must never silently turn that opt-in back on.
    if !write_ceiling {
        sqlx::query(
            "UPDATE connection_safety
             SET allow_writes = 0, allow_schema_changes = 0
             WHERE connection_id = ?1",
        )
        .bind(connection_id.to_string())
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

impl Store {
    // ── safety settings ────────────────────────────────────────────────────

    /// Returns stored safety settings, or the type default if none exist yet.
    pub async fn get_safety(&self, connection_id: Uuid) -> AppResult<SafetySettings> {
        self.get_connection(connection_id).await?;
        let row = sqlx::query(
            "SELECT require_approval, allow_writes, allow_schema_changes,
                    wrap_writes_in_tx, explain_preview,
                    auto_run_reads, max_rows, exec_preview_row_limit
             FROM connection_safety WHERE connection_id = ?1",
        )
        .bind(connection_id.to_string())
        .fetch_optional(&self.pool)
        .await?;

        Ok(match row {
            None => SafetySettings::default(),
            Some(r) => SafetySettings {
                require_approval: r.try_get("require_approval")?,
                allow_writes: r.try_get("allow_writes")?,
                allow_schema_changes: r.try_get("allow_schema_changes")?,
                wrap_writes_in_tx: r.try_get("wrap_writes_in_tx")?,
                explain_preview: r.try_get("explain_preview")?,
                auto_run_reads: r.try_get("auto_run_reads")?,
                max_rows: r.try_get::<i64, _>("max_rows")? as u64,
                exec_preview_row_limit: r.try_get("exec_preview_row_limit")?,
            },
        })
    }

    /// Persist the device-owned safety policy. For a local connection, its
    /// durable write ceiling changes in the same transaction; shared
    /// connection ceilings remain server-owned and are never widened here.
    pub async fn set_safety(
        &self,
        connection_id: Uuid,
        expected_connection_revision: i64,
        update_local_write_ceiling: bool,
        s: &SafetySettings,
    ) -> AppResult<bool> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE app_settings SET value = value WHERE key = 'active_scope_generation'")
            .execute(&mut *tx)
            .await?;
        let connection: Option<SafetyConnectionRow> = sqlx::query_as(
            "SELECT revision, workspace_access, credential_mode, allow_writes, remote_id,
                    provider, engine
             FROM connections
             WHERE id = ?1 AND deleted_at IS NULL",
        )
        .bind(connection_id.to_string())
        .fetch_optional(&mut *tx)
        .await?;
        let Some((
            revision,
            workspace_access,
            credential_mode,
            previous_ceiling,
            remote_id,
            provider,
            engine,
        )) = connection
        else {
            return Err(AppError::NotFound(format!("connection {connection_id}")));
        };
        if revision != expected_connection_revision {
            return Err(AppError::Blocked {
                reason: "the connection changed before its safety policy could be saved".into(),
            });
        }
        let is_local =
            workspace_access == "local" && credential_mode == "local" && remote_id.is_none();
        if is_local != update_local_write_ceiling {
            return Err(AppError::Blocked {
                reason: "the connection authority changed before its safety policy could be saved"
                    .into(),
            });
        }
        let schema_authorized = s.allow_writes
            && if is_local {
                matches!(engine.as_str(), "postgres" | "mysql" | "sqlite")
            } else {
                credential_mode == "managed"
                    && workspace_access == "manage"
                    && previous_ceiling
                    && matches!(provider.as_str(), "neon" | "gcp_cloud_sql")
                    && engine == "postgres"
            };
        if s.allow_schema_changes && !schema_authorized {
            return Err(AppError::Blocked {
                reason: "schema changes exceed the connection's current safety authority".into(),
            });
        }
        let previous_safety = sqlx::query_as::<_, (bool, bool)>(
            "SELECT allow_writes, allow_schema_changes
             FROM connection_safety WHERE connection_id = ?1",
        )
        .bind(connection_id.to_string())
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or((false, false));
        let ceiling_changed = is_local && previous_ceiling != s.allow_writes;
        if ceiling_changed {
            let updated = sqlx::query(
                "UPDATE connections
                 SET allow_writes = ?2, revision = revision + 1, updated_at = ?3
                 WHERE id = ?1 AND revision = ?4
                   AND workspace_access = 'local' AND credential_mode = 'local'
                   AND remote_id IS NULL AND deleted_at IS NULL",
            )
            .bind(connection_id.to_string())
            .bind(s.allow_writes)
            .bind(Utc::now())
            .bind(expected_connection_revision)
            .execute(&mut *tx)
            .await?;
            if updated.rows_affected() != 1 {
                return Err(AppError::Blocked {
                    reason: "the connection changed before its write policy could be saved".into(),
                });
            }
        }
        sqlx::query(
            r#"INSERT INTO connection_safety
                (connection_id, require_approval, allow_writes, allow_schema_changes,
                 wrap_writes_in_tx, explain_preview, auto_run_reads, max_rows,
                 exec_preview_row_limit)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
               ON CONFLICT(connection_id) DO UPDATE SET
                 require_approval=?2, allow_writes=?3, allow_schema_changes=?4,
                 wrap_writes_in_tx=?5, explain_preview=?6, auto_run_reads=?7,
                 max_rows=?8, exec_preview_row_limit=?9"#,
        )
        .bind(connection_id.to_string())
        .bind(s.require_approval)
        .bind(s.allow_writes)
        .bind(s.allow_schema_changes)
        .bind(s.wrap_writes_in_tx)
        .bind(s.explain_preview)
        .bind(s.auto_run_reads)
        .bind(s.max_rows as i64)
        .bind(s.exec_preview_row_limit)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(previous_safety != (s.allow_writes, s.allow_schema_changes) || ceiling_changed)
    }
}
