//! Workspace, Knowledge, and local Analysis compatibility migrations.

use super::*;

pub(super) async fn remove_retired_bi_schema(pool: &SqlitePool) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::raw_sql(
        "DROP TABLE IF EXISTS workspace_dashboard_visibility;
         DROP TABLE IF EXISTS funnel_analysis_artifacts;
         DROP TABLE IF EXISTS signal_metric_samples;
         DROP TABLE IF EXISTS signal_runner_identity;
         DROP TABLE IF EXISTS dashboards;
         DROP TABLE IF EXISTS sync_outbox;
         DROP TABLE IF EXISTS sync_state;",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub(super) async fn migrate_analysis_runner_identity(pool: &SqlitePool) -> AppResult<()> {
    sqlx::raw_sql(
        "INSERT INTO app_settings (key, value)
           SELECT 'analysis_runner_device_id', value
           FROM app_settings
           WHERE key = 'signal_runner_device_id'
           ON CONFLICT(key) DO NOTHING;
         DELETE FROM app_settings
           WHERE key IN ('signal_runner_device_id', 'signal_runner_background_allowed');",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub(super) async fn retire_analysis_automation_storage(pool: &SqlitePool) -> AppResult<()> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS app_settings (
             key   TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );
         DROP TABLE IF EXISTS analysis_signal_metric_samples;
         DELETE FROM app_settings
           WHERE key IN ('analysis_runner_background_allowed',
                         'signal_runner_background_allowed');",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub(super) async fn ensure_analysis_article_local_results_schema(
    pool: &SqlitePool,
) -> AppResult<()> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS analysis_article_local_results (
             workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
             account_scope TEXT NOT NULL CHECK(account_scope <> ''),
             article_id TEXT NOT NULL,
             article_revision INTEGER NOT NULL CHECK(article_revision > 0),
             run_id TEXT NOT NULL,
             result_hash TEXT NOT NULL
                 CHECK(length(result_hash) = 64
                   AND result_hash NOT GLOB '*[^0-9a-f]*'),
             nonce BLOB NOT NULL CHECK(length(nonce) = 24),
             ciphertext BLOB NOT NULL
                 CHECK(length(ciphertext) > 16 AND length(ciphertext) <= 17825792),
             created_at TEXT NOT NULL,
             expires_at TEXT NOT NULL,
             PRIMARY KEY (workspace_id, account_scope, article_id, run_id)
         );
         CREATE INDEX IF NOT EXISTS idx_analysis_article_local_result_latest
           ON analysis_article_local_results(
             workspace_id, account_scope, article_id, created_at DESC
           );
         CREATE INDEX IF NOT EXISTS idx_analysis_article_local_result_expiry
           ON analysis_article_local_results(expires_at);",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub(super) async fn ensure_agent_acp_knowledge_grant(pool: &SqlitePool) -> AppResult<()> {
    add_column_if_missing(
        pool,
        "agent_acp_sessions",
        "knowledge_grant_id",
        "ALTER TABLE agent_acp_sessions ADD COLUMN knowledge_grant_id TEXT",
    )
    .await
}

pub(super) async fn ensure_agent_acp_environment_connections(pool: &SqlitePool) -> AppResult<()> {
    add_column_if_missing(
        pool,
        "agent_acp_sessions",
        "environment_connections",
        "ALTER TABLE agent_acp_sessions ADD COLUMN environment_connections TEXT NOT NULL DEFAULT '[]'",
    )
    .await
}

pub(super) async fn ensure_agent_acp_knowledge_sources(pool: &SqlitePool) -> AppResult<()> {
    add_column_if_missing(
        pool,
        "agent_acp_sessions",
        "knowledge_sources",
        "ALTER TABLE agent_acp_sessions ADD COLUMN knowledge_sources TEXT NOT NULL DEFAULT '[]'",
    )
    .await
}

pub(super) async fn ensure_agent_acp_knowledge_scope(pool: &SqlitePool) -> AppResult<()> {
    add_column_if_missing(
        pool,
        "agent_acp_sessions",
        "project_environment_id",
        "ALTER TABLE agent_acp_sessions ADD COLUMN project_environment_id TEXT",
    )
    .await?;
    add_column_if_missing(
        pool,
        "agent_acp_sessions",
        "environment_revision",
        "ALTER TABLE agent_acp_sessions ADD COLUMN environment_revision INTEGER CHECK(environment_revision IS NULL OR environment_revision > 0)",
    )
    .await?;
    add_column_if_missing(
        pool,
        "agent_acp_sessions",
        "knowledge_sources",
        "ALTER TABLE agent_acp_sessions ADD COLUMN knowledge_sources TEXT NOT NULL DEFAULT '[]'",
    )
    .await?;
    add_column_if_missing(
        pool,
        "agent_acp_sessions",
        "graph_revision_ids",
        "ALTER TABLE agent_acp_sessions ADD COLUMN graph_revision_ids TEXT NOT NULL DEFAULT '[]'",
    )
    .await?;
    Ok(())
}

pub(super) async fn ensure_knowledge_grant_revision_sets(pool: &SqlitePool) -> AppResult<()> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS knowledge_grant_graph_revisions (
             grant_id TEXT NOT NULL REFERENCES knowledge_grants(id) ON DELETE CASCADE,
             graph_revision_id TEXT NOT NULL
                 REFERENCES knowledge_graph_revisions(graph_revision_id),
             PRIMARY KEY (grant_id, graph_revision_id)
         );
         INSERT OR IGNORE INTO knowledge_grant_graph_revisions (grant_id, graph_revision_id)
         SELECT id, graph_revision_id FROM knowledge_grants;",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub(super) async fn ensure_project_environment_connections(pool: &SqlitePool) -> AppResult<()> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS knowledge_environment_connections (
             id TEXT PRIMARY KEY,
             workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
             project_environment_id TEXT NOT NULL
                 REFERENCES knowledge_project_environments(id) ON DELETE CASCADE,
             environment_revision INTEGER NOT NULL CHECK(environment_revision > 0),
             connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
             connection_revision INTEGER NOT NULL CHECK(connection_revision > 0),
             role TEXT NOT NULL CHECK(length(role) BETWEEN 1 AND 64),
             alias TEXT NOT NULL CHECK(length(alias) BETWEEN 1 AND 128),
             created_at TEXT NOT NULL,
             revoked_at TEXT
         );
         CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_environment_connection_active
           ON knowledge_environment_connections(project_environment_id, connection_id)
           WHERE revoked_at IS NULL;
         CREATE INDEX IF NOT EXISTS idx_knowledge_environment_connection_scope
           ON knowledge_environment_connections(workspace_id, project_environment_id, revoked_at);",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub(super) async fn ensure_project_knowledge_revision_set(pool: &SqlitePool) -> AppResult<()> {
    add_column_if_missing(
        pool,
        "knowledge_project_environments",
        "risk_class",
        "ALTER TABLE knowledge_project_environments ADD COLUMN risk_class TEXT NOT NULL DEFAULT 'custom'",
    )
    .await?;
    sqlx::query(
        "UPDATE knowledge_project_environments
         SET risk_class = CASE WHEN production = 1 THEN 'production' ELSE 'custom' END
         WHERE risk_class = 'custom'",
    )
    .execute(pool)
    .await?;
    let has_source_id: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM pragma_table_info('knowledge_environment_heads')
             WHERE name = 'source_id'
         )",
    )
    .fetch_one(pool)
    .await?;
    if has_source_id {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    sqlx::raw_sql(
        "DROP TRIGGER IF EXISTS knowledge_graph_revisions_reject_delete_active;
         ALTER TABLE knowledge_environment_heads RENAME TO knowledge_environment_heads_v8;
         CREATE TABLE knowledge_environment_heads (
             project_environment_id TEXT NOT NULL
                 REFERENCES knowledge_project_environments(id) ON DELETE CASCADE,
             source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
             graph_revision_id TEXT NOT NULL UNIQUE
                 REFERENCES knowledge_graph_revisions(graph_revision_id),
             environment_revision INTEGER NOT NULL CHECK(environment_revision > 0),
             activated_at TEXT NOT NULL,
             PRIMARY KEY (project_environment_id, source_id)
         );
         INSERT INTO knowledge_environment_heads
             (project_environment_id, source_id, graph_revision_id,
              environment_revision, activated_at)
         SELECT old.project_environment_id, revision.source_id,
                old.graph_revision_id, old.environment_revision, old.activated_at
         FROM knowledge_environment_heads_v8 old
         JOIN knowledge_graph_revisions revision
           ON revision.graph_revision_id = old.graph_revision_id;
         DROP TABLE knowledge_environment_heads_v8;
         CREATE TRIGGER knowledge_graph_revisions_reject_delete_active
         BEFORE DELETE ON knowledge_graph_revisions
         WHEN EXISTS (
             SELECT 1 FROM knowledge_environment_heads
             WHERE graph_revision_id = OLD.graph_revision_id
         )
         BEGIN
             SELECT RAISE(ABORT, 'active knowledge graph revision cannot be deleted');
         END;",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub(super) async fn ensure_project_knowledge_snapshot_columns(pool: &SqlitePool) -> AppResult<()> {
    add_column_if_missing(
        pool,
        "knowledge_sources",
        "source_revision_sha256",
        "ALTER TABLE knowledge_sources ADD COLUMN source_revision_sha256 TEXT",
    )
    .await?;
    add_column_if_missing(
        pool,
        "knowledge_sources",
        "snapshot_json",
        "ALTER TABLE knowledge_sources ADD COLUMN snapshot_json TEXT",
    )
    .await?;
    add_column_if_missing(
        pool,
        "knowledge_sources",
        "revoked_at",
        "ALTER TABLE knowledge_sources ADD COLUMN revoked_at TEXT",
    )
    .await?;
    Ok(())
}

pub(super) async fn ensure_project_knowledge_schema(pool: &SqlitePool) -> AppResult<()> {
    sqlx::raw_sql(migrations::KNOWLEDGE_SCHEMA)
        .execute(pool)
        .await?;
    Ok(())
}

pub(super) async fn ensure_workspace_sync_state(pool: &SqlitePool) -> AppResult<()> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS workspace_sync_state (
             workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
             account_scope TEXT NOT NULL CHECK(account_scope <> ''),
             pull_cursor   INTEGER NOT NULL CHECK(pull_cursor >= 0),
             last_pulled_at TEXT NOT NULL,
             PRIMARY KEY (workspace_id, account_scope)
         );",
    )
    .execute(pool)
    .await?;
    Ok(())
}
