//! Canonical catalog cache persistence.

use super::super::*;
use crate::kernel::access::{CatalogCachePolicy, PinnedConnection};

impl Store {
    /// Return a valid Catalog V2 snapshot only when both its stored provenance and the
    /// active local scope still match the retained pin. Managed credentials are never
    /// persisted until the control plane exposes a non-secret principal revision.
    pub(crate) async fn get_catalog_if_current(
        &self,
        pin: &PinnedConnection,
    ) -> AppResult<Option<CatalogSnapshot>> {
        if pin.catalog_cache_policy == CatalogCachePolicy::EphemeralOnly {
            return Ok(None);
        }
        let row = sqlx::query(
            "SELECT cache.catalog_schema_version,
                    cache.fingerprint,
                    cache.captured_at,
                    cache.catalog_json
             FROM catalog_cache cache
             JOIN app_settings workspace
               ON workspace.key = 'active_workspace_id'
              AND workspace.value = cache.workspace_id
             JOIN workspaces w
               ON w.id = workspace.value
              AND w.lifecycle_state = 'active'
             LEFT JOIN app_settings account
               ON account.key = 'active_workspace_account_id'
             JOIN app_settings generation
               ON generation.key = 'active_scope_generation'
             JOIN connections c
               ON c.id = cache.connection_id
              AND c.workspace_id = cache.workspace_id
              AND c.deleted_at IS NULL
             LEFT JOIN workspace_connection_bindings b
               ON b.connection_id = c.id
              AND b.account_user_id = account.value
             WHERE cache.workspace_id = ?1
               AND cache.account_scope = ?2
               AND cache.connection_id = ?3
               AND cache.connection_revision = ?4
               AND cache.binding_revision = ?5
               AND cache.binding_updated_at = ?6
               AND cache.catalog_schema_version = ?7
               AND w.kind = ?8
               AND account.value IS ?9
               AND generation.value = ?10
               AND c.revision = ?4
               AND CASE WHEN c.remote_id IS NOT NULL
                        THEN COALESCE(b.revision, 0) ELSE 0 END = ?5
               AND CASE WHEN c.remote_id IS NOT NULL
                        THEN COALESCE(b.updated_at, '') ELSE '' END = ?6
               AND CASE WHEN w.kind = 'personal'
                        THEN 'personal' ELSE account.value END = ?2
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
                       IN ('read', 'write', 'manage'))",
        )
        .bind(pin.scope.workspace_id.to_string())
        .bind(pin.scope.account_scope.storage_key())
        .bind(pin.connection_id.to_string())
        .bind(pin.connection_revision)
        .bind(pin.binding_revision)
        .bind(&pin.binding_updated_at)
        .bind(i64::from(CATALOG_SCHEMA_VERSION))
        .bind(workspace_kind_str(pin.scope.workspace_kind))
        .bind(pin.scope.selected_account_id.as_deref())
        .bind(pin.scope.generation.to_string())
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let Ok(schema_version) = row.try_get::<i64, _>("catalog_schema_version") else {
            return Ok(None);
        };
        let Ok(fingerprint) = row.try_get::<String, _>("fingerprint") else {
            return Ok(None);
        };
        let Ok(captured_at_raw) = row.try_get::<String, _>("captured_at") else {
            return Ok(None);
        };
        let Ok(captured_at) =
            DateTime::parse_from_rfc3339(&captured_at_raw).map(|value| value.with_timezone(&Utc))
        else {
            return Ok(None);
        };
        let Ok(catalog_json) = row.try_get::<String, _>("catalog_json") else {
            return Ok(None);
        };
        let snapshot = match serde_json::from_str::<CatalogSnapshot>(&catalog_json) {
            Ok(snapshot) => snapshot,
            Err(_) => return Ok(None),
        };
        if schema_version != i64::from(CATALOG_SCHEMA_VERSION)
            || snapshot.schema_version() != CATALOG_SCHEMA_VERSION
            || snapshot.fingerprint() != fingerprint
            || snapshot.captured_at() != captured_at
            || !catalog_matches_pin(&snapshot, pin)
        {
            return Ok(None);
        }
        Ok(Some(snapshot))
    }

    /// Store a Catalog V2 snapshot only if the pin is still current at the exact
    /// statement that performs the write. `Stale` is an expected race outcome.
    pub(crate) async fn put_catalog_if_current(
        &self,
        pin: &PinnedConnection,
        snapshot: &CatalogSnapshot,
    ) -> AppResult<CacheWriteOutcome> {
        if pin.catalog_cache_policy == CatalogCachePolicy::EphemeralOnly {
            return Ok(CacheWriteOutcome::NotPersisted);
        }
        snapshot
            .validate()
            .map_err(|_| AppError::Config("invalid Catalog V2 snapshot".into()))?;
        if !catalog_matches_pin(snapshot, pin) {
            return Err(AppError::Config(
                "Catalog V2 snapshot does not match its connection pin".into(),
            ));
        }
        let catalog_json = serde_json::to_string(snapshot)?;
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "INSERT INTO catalog_cache
                (workspace_id, account_scope, connection_id, connection_revision,
                 binding_revision, binding_updated_at, catalog_schema_version,
                 fingerprint, captured_at, catalog_json)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
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
                   ON c.id = ?3
                  AND c.workspace_id = w.id
                  AND c.deleted_at IS NULL
                 LEFT JOIN workspace_connection_bindings b
                   ON b.connection_id = c.id
                  AND b.account_user_id = account.value
                 WHERE w.id = ?1
                   AND w.kind = ?11
                   AND account.value IS ?12
                   AND generation.value = ?13
                   AND c.revision = ?4
                   AND CASE WHEN c.remote_id IS NOT NULL
                            THEN COALESCE(b.revision, 0) ELSE 0 END = ?5
                   AND CASE WHEN c.remote_id IS NOT NULL
                            THEN COALESCE(b.updated_at, '') ELSE '' END = ?6
                   AND CASE WHEN w.kind = 'personal'
                            THEN 'personal' ELSE account.value END = ?2
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
             )
             ON CONFLICT(workspace_id, account_scope, connection_id) DO UPDATE SET
                 connection_revision = excluded.connection_revision,
                 binding_revision = excluded.binding_revision,
                 binding_updated_at = excluded.binding_updated_at,
                 catalog_schema_version = excluded.catalog_schema_version,
                 fingerprint = excluded.fingerprint,
                 captured_at = excluded.captured_at,
                 catalog_json = excluded.catalog_json",
        )
        .bind(pin.scope.workspace_id.to_string())
        .bind(pin.scope.account_scope.storage_key())
        .bind(pin.connection_id.to_string())
        .bind(pin.connection_revision)
        .bind(pin.binding_revision)
        .bind(&pin.binding_updated_at)
        .bind(i64::from(snapshot.schema_version()))
        .bind(snapshot.fingerprint())
        .bind(snapshot.captured_at())
        .bind(catalog_json)
        .bind(workspace_kind_str(pin.scope.workspace_kind))
        .bind(pin.scope.selected_account_id.as_deref())
        .bind(pin.scope.generation.to_string())
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            tx.rollback().await?;
            return Ok(CacheWriteOutcome::Stale);
        }
        tx.commit().await?;
        Ok(CacheWriteOutcome::Stored)
    }

    /// Drop the cached catalog so the next introspection reads live — after a
    /// connection edit, or an explicit schema refresh.
    pub async fn clear_schema_cache(&self, connection_id: Uuid) -> AppResult<()> {
        let pin = self.pin_connection_for_read(connection_id).await?;
        let account_scope = pin.scope.account_scope.storage_key();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "DELETE FROM catalog_cache
             WHERE workspace_id = ?1 AND account_scope = ?2 AND connection_id = ?3",
        )
        .bind(pin.scope.workspace_id.to_string())
        .bind(account_scope)
        .bind(connection_id.to_string())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

fn catalog_matches_pin(snapshot: &CatalogSnapshot, pin: &PinnedConnection) -> bool {
    snapshot.connection_id() == pin.connection_id
        && snapshot.engine() == protocol_engine(pin.profile.engine)
        && snapshot.database() == pin.profile.database
}

fn protocol_engine(engine: Engine) -> DatabaseEngine {
    match engine {
        Engine::Postgres => DatabaseEngine::Postgres,
        Engine::Mysql => DatabaseEngine::Mysql,
        Engine::Sqlite => DatabaseEngine::Sqlite,
        Engine::Mongodb => DatabaseEngine::Mongodb,
        Engine::Bigquery => DatabaseEngine::Bigquery,
    }
}
