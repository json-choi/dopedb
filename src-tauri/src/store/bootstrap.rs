//! Store bootstrap and compatibility migrations.

use super::*;
use sqlx::Acquire;

#[path = "bootstrap_legacy.rs"]
mod legacy;
#[path = "bootstrap_operations.rs"]
mod operations;
#[path = "bootstrap_workspace.rs"]
mod workspace;

use legacy::*;
use operations::*;
use workspace::*;

#[cfg(test)]
pub(super) use legacy::{add_sql_document_database_scope, migrate_agent_acp_providers};

/// Version 1 introduced ordered local migrations. Version 2 adds bounded Activity
/// paging indexes. Version 5 replaces the workspace-only hosted pull checkpoint
/// with an account-scoped cursor table.
/// Version 7 adds immutable Project Knowledge revisions and an atomically selected
/// last-good head. Version 8 stores only a bounded source manifest so incremental
/// extraction can compare content hashes; roots, credentials, and source bodies
/// still have no representable column. Version 9 makes the last-good head
/// source-specific so an Environment can own multiple active graph revisions.
/// Version 10 binds multiple exact connection revisions to that Environment.
/// Version 11 pins an Environment KnowledgeGrant to its complete graph revision set.
/// Version 12 persists the exact Knowledge scope of resumable ACP sessions.
/// Version 13 adds the session's immutable Environment connection allowlist.
/// Version 14 persists the exact member KnowledgeGrant used by a resumable session.
/// Versions 15–16 hosted retired Funnel/Signal prototypes. Version 17 removes
/// every executable local BI projection. Version 18 adds the device-local sample
/// store used by the Analysis Article runner; definitions remain control-plane
/// authoritative and result recovery remains encrypted. Version 19 replaces the
/// final retired Dashboard operation vocabulary while preserving its immutable
/// approval and event provenance. Version 20 rejects malformed connection JSON
/// and ports at the SQLite write boundary instead of relying only on projections.
/// Version 21 adds the bounded raw-source descriptors captured by resumable ACP
/// sessions. It is intentionally separate from version 12 so databases that had
/// already crossed that migration before the field existed are repaired.
/// Version 22 repairs upgraded databases whose version-18 path omitted the
/// encrypted Analysis Article local-result cache table.
/// Version 23 enforces one active Project assignment per workspace connection;
/// legacy duplicate rows remain operable until the user removes them explicitly.
/// Version 24 persists the immutable multi-Environment Project resource set and
/// its optional single database write target for resumable ACP sessions. Version
/// 25 adds the device-local DDL opt-in without widening any existing connection.
/// Version 26 removes retired Analysis automation samples and background flags.
pub(super) const LOCAL_SCHEMA_VERSION: i64 = 26;

pub(super) async fn migrate_local_store(pool: &SqlitePool) -> AppResult<bool> {
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    if version > LOCAL_SCHEMA_VERSION {
        return Err(AppError::Config(format!(
            "local database schema version {version} is newer than this app supports ({LOCAL_SCHEMA_VERSION})"
        )));
    }
    if version == LOCAL_SCHEMA_VERSION {
        return Ok(false);
    }

    let mut migrated = false;
    if version < 1 {
        // Version zero covers both a fresh database and every pre-versioned DopeDB
        // database. The compatibility checks are explicit schema reads, so expected
        // duplicate-column errors are never part of the successful startup path.
        sqlx::raw_sql(migrations::SCHEMA).execute(pool).await?;
        add_legacy_columns(pool).await?;
        add_sql_document_database_scope(pool).await?;
        add_workspace_columns(pool).await?;
        migrate_workspace_foundation(pool).await?;
        migrate_audit_no_cascade(pool).await?;
        add_local_scope_columns(pool).await?;
        add_connection_binding_scope_columns(pool).await?;
        migrate_agent_acp_providers(pool).await?;
        migrate_schema_cache_scopes(pool).await?;
        ensure_schema_cache_v2(pool).await?;
        ensure_local_scope_indexes(pool).await?;
        set_local_schema_version(pool, 1).await?;
        migrated = true;
    }
    if version < 2 {
        ensure_activity_paging_indexes(pool).await?;
        set_local_schema_version(pool, 2).await?;
        migrated = true;
    }
    if version < 3 {
        set_local_schema_version(pool, 3).await?;
        migrated = true;
    }
    if version < 4 {
        set_local_schema_version(pool, 4).await?;
        migrated = true;
    }
    if version < 5 {
        ensure_workspace_sync_state(pool).await?;
        set_local_schema_version(pool, 5).await?;
        migrated = true;
    }
    if version < 6 {
        set_local_schema_version(pool, 6).await?;
        migrated = true;
    }
    if version < 7 {
        ensure_project_knowledge_schema(pool).await?;
        set_local_schema_version(pool, 7).await?;
        migrated = true;
    }
    if version < 8 {
        ensure_project_knowledge_snapshot_columns(pool).await?;
        set_local_schema_version(pool, 8).await?;
        migrated = true;
    }
    if version < 9 {
        ensure_project_knowledge_revision_set(pool).await?;
        set_local_schema_version(pool, 9).await?;
        migrated = true;
    }
    if version < 10 {
        ensure_project_environment_connections(pool).await?;
        set_local_schema_version(pool, 10).await?;
        migrated = true;
    }
    if version < 11 {
        ensure_knowledge_grant_revision_sets(pool).await?;
        set_local_schema_version(pool, 11).await?;
        migrated = true;
    }
    if version < 12 {
        ensure_agent_acp_knowledge_scope(pool).await?;
        set_local_schema_version(pool, 12).await?;
        migrated = true;
    }
    if version < 13 {
        ensure_agent_acp_environment_connections(pool).await?;
        set_local_schema_version(pool, 13).await?;
        migrated = true;
    }
    if version < 14 {
        ensure_agent_acp_knowledge_grant(pool).await?;
        set_local_schema_version(pool, 14).await?;
        migrated = true;
    }
    if version < 15 {
        set_local_schema_version(pool, 15).await?;
        migrated = true;
    }
    if version < 16 {
        set_local_schema_version(pool, 16).await?;
        migrated = true;
    }
    if version < 17 {
        remove_retired_bi_schema(pool).await?;
        set_local_schema_version(pool, 17).await?;
        migrated = true;
    }
    if version < 18 {
        migrate_analysis_runner_identity(pool).await?;
        set_local_schema_version(pool, 18).await?;
        migrated = true;
    }
    if version < 19 {
        migrate_retired_operation_kind(pool).await?;
        set_local_schema_version(pool, 19).await?;
        migrated = true;
    }
    if version < 20 {
        ensure_connection_integrity_guards(pool).await?;
        set_local_schema_version(pool, 20).await?;
        migrated = true;
    }
    if version < 21 {
        ensure_agent_acp_knowledge_sources(pool).await?;
        set_local_schema_version(pool, 21).await?;
        migrated = true;
    }
    if version < 22 {
        ensure_analysis_article_local_results_schema(pool).await?;
        set_local_schema_version(pool, 22).await?;
        migrated = true;
    }
    let workspace_binding_ready = if version < 23 {
        ensure_workspace_unique_environment_connections(pool).await?
    } else {
        true
    };
    if version < 23 && workspace_binding_ready {
        set_local_schema_version(pool, 23).await?;
        migrated = true;
    }
    if version < 24 {
        ensure_agent_acp_resource_set(pool).await?;
        migrated = true;
        if workspace_binding_ready {
            set_local_schema_version(pool, 24).await?;
        }
    }
    if version < 25 {
        ensure_safety_schema_access(pool).await?;
        migrated = true;
        if version >= 24 || workspace_binding_ready {
            set_local_schema_version(pool, 25).await?;
        }
    }
    if version < 26 {
        retire_analysis_automation_storage(pool).await?;
        migrated = true;
        if version >= 25 || workspace_binding_ready {
            set_local_schema_version(pool, 26).await?;
        }
    }
    Ok(migrated)
}

async fn ensure_safety_schema_access(pool: &SqlitePool) -> AppResult<()> {
    // Some supported pre-versioned stores were created before the Safety table
    // became part of the bootstrap schema. Recreate the complete fail-closed
    // table before adding the v25 column so an upgraded store never advances
    // while leaving the settings authority absent.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS connection_safety (
             connection_id          TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
             require_approval       INTEGER NOT NULL DEFAULT 1,
             allow_writes           INTEGER NOT NULL DEFAULT 0,
             allow_schema_changes   INTEGER NOT NULL DEFAULT 0,
             wrap_writes_in_tx      INTEGER NOT NULL DEFAULT 1,
             explain_preview        INTEGER NOT NULL DEFAULT 1,
             auto_run_reads         INTEGER NOT NULL DEFAULT 1,
             max_rows               INTEGER NOT NULL DEFAULT 1000,
             exec_preview_row_limit INTEGER NOT NULL DEFAULT 50000
         )",
    )
    .execute(pool)
    .await?;
    add_column_if_missing(
        pool,
        "connection_safety",
        "allow_schema_changes",
        "ALTER TABLE connection_safety ADD COLUMN allow_schema_changes INTEGER NOT NULL DEFAULT 0",
    )
    .await
}

async fn ensure_agent_acp_resource_set(pool: &SqlitePool) -> AppResult<()> {
    add_column_if_missing(
        pool,
        "agent_acp_sessions",
        "knowledge_scopes",
        "ALTER TABLE agent_acp_sessions ADD COLUMN knowledge_scopes TEXT NOT NULL DEFAULT '[]'",
    )
    .await?;
    add_column_if_missing(
        pool,
        "agent_acp_sessions",
        "write_connection_id",
        "ALTER TABLE agent_acp_sessions ADD COLUMN write_connection_id TEXT",
    )
    .await
}

async fn ensure_workspace_unique_environment_connections(pool: &SqlitePool) -> AppResult<bool> {
    let table_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM sqlite_master
         WHERE type = 'table' AND name = 'knowledge_environment_connections'",
    )
    .fetch_one(pool)
    .await?;
    if table_exists == 0 {
        // Compatibility fixtures and retired partial stores can legitimately omit
        // the Knowledge domain. They cannot create a binding, so there is no
        // authority surface to index.
        return Ok(true);
    }
    let duplicate_groups: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM (
           SELECT workspace_id, connection_id
           FROM knowledge_environment_connections
           WHERE revoked_at IS NULL
           GROUP BY workspace_id, connection_id
           HAVING COUNT(*) > 1
         )",
    )
    .fetch_one(pool)
    .await?;
    if duplicate_groups > 0 {
        // Do not guess which exact Environment grant the user intended. The
        // normal UI stays available so each duplicate can be removed explicitly;
        // the application guard prevents any new duplicate in the meantime.
        return Ok(false);
    }
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_environment_connection_workspace_active
         ON knowledge_environment_connections(workspace_id, connection_id)
         WHERE revoked_at IS NULL",
    )
    .execute(pool)
    .await?;
    Ok(true)
}

/// Current-schema connection rows are security-relevant authority inputs. Keep
/// legacy conversion in migrations and reject malformed values at every later
/// SQLite write, even if a future caller bypasses the repository projection.
async fn ensure_connection_integrity_guards(pool: &SqlitePool) -> AppResult<()> {
    let invalid_connections: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM connections
         WHERE typeof(port) <> 'integer'
            OR port < 0
            OR port > 65535
            OR CASE
                 WHEN json_valid(extra_params) THEN json_type(extra_params) <> 'object'
                 ELSE 1
               END
            OR CASE
                 WHEN provider_target IS NULL THEN 0
                 WHEN json_valid(provider_target) THEN json_type(provider_target) <> 'object'
                 ELSE 1
               END",
    )
    .fetch_one(pool)
    .await?;
    let invalid_bindings: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM workspace_connection_bindings
         WHERE CASE
                 WHEN json_valid(extra_params) THEN json_type(extra_params) <> 'object'
                 ELSE 1
               END",
    )
    .fetch_one(pool)
    .await?;
    if invalid_connections != 0 || invalid_bindings != 0 {
        return Err(AppError::Config(format!(
            "local connection store contains {invalid_connections} invalid connection row(s) and {invalid_bindings} invalid credential binding row(s)"
        )));
    }

    sqlx::raw_sql(
        r#"
        CREATE TRIGGER IF NOT EXISTS connections_integrity_insert
        BEFORE INSERT ON connections
        WHEN typeof(NEW.port) <> 'integer'
          OR NEW.port < 0
          OR NEW.port > 65535
          OR CASE
               WHEN json_valid(NEW.extra_params) THEN json_type(NEW.extra_params) <> 'object'
               ELSE 1
             END
          OR CASE
               WHEN NEW.provider_target IS NULL THEN 0
               WHEN json_valid(NEW.provider_target) THEN json_type(NEW.provider_target) <> 'object'
               ELSE 1
             END
        BEGIN
            SELECT RAISE(ABORT, 'connection integrity constraint failed');
        END;

        CREATE TRIGGER IF NOT EXISTS connections_integrity_update
        BEFORE UPDATE OF port, extra_params, provider_target ON connections
        WHEN typeof(NEW.port) <> 'integer'
          OR NEW.port < 0
          OR NEW.port > 65535
          OR CASE
               WHEN json_valid(NEW.extra_params) THEN json_type(NEW.extra_params) <> 'object'
               ELSE 1
             END
          OR CASE
               WHEN NEW.provider_target IS NULL THEN 0
               WHEN json_valid(NEW.provider_target) THEN json_type(NEW.provider_target) <> 'object'
               ELSE 1
             END
        BEGIN
            SELECT RAISE(ABORT, 'connection integrity constraint failed');
        END;

        CREATE TRIGGER IF NOT EXISTS workspace_connection_bindings_integrity_insert
        BEFORE INSERT ON workspace_connection_bindings
        WHEN CASE
               WHEN json_valid(NEW.extra_params) THEN json_type(NEW.extra_params) <> 'object'
               ELSE 1
             END
        BEGIN
            SELECT RAISE(ABORT, 'connection binding integrity constraint failed');
        END;

        CREATE TRIGGER IF NOT EXISTS workspace_connection_bindings_integrity_update
        BEFORE UPDATE OF extra_params ON workspace_connection_bindings
        WHEN CASE
               WHEN json_valid(NEW.extra_params) THEN json_type(NEW.extra_params) <> 'object'
               ELSE 1
             END
        BEGIN
            SELECT RAISE(ABORT, 'connection binding integrity constraint failed');
        END;
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Rebuild the immutable parent table once so a removed Dashboard command does not
/// remain part of the public Operation vocabulary. Approval and event children keep
/// their original operation ids and hashes; only the retired parent's descriptive
/// kind is normalized. Foreign-key enforcement is disabled on the one acquired
/// startup connection only for the parent-table swap and is verified before return.
async fn set_local_schema_version(pool: &SqlitePool, version: i64) -> AppResult<()> {
    sqlx::query(AssertSqlSafe(format!("PRAGMA user_version = {version}")))
        .execute(pool)
        .await?;
    Ok(())
}

async fn ensure_activity_paging_indexes(pool: &SqlitePool) -> AppResult<()> {
    sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_history_scope_recent
             ON query_history(connection_id, account_scope, executed_at DESC);
         CREATE INDEX IF NOT EXISTS idx_audit_connection_row
             ON audit_log(connection_id);",
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> AppResult<bool> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
    )
    .bind(table)
    .bind(column)
    .fetch_one(pool)
    .await?
        != 0)
}

async fn add_column_if_missing(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    statement: &'static str,
) -> AppResult<()> {
    if !column_exists(pool, table, column).await? {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}
