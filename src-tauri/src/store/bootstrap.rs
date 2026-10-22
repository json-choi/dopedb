//! Fresh-install bootstrap for the local app database.
//!
//! DopeDB is still pre-MVP, so local stores from earlier schema experiments are
//! deliberately unsupported. Keeping one current baseline avoids carrying data
//! conversion code into the product. Additive metadata (a fail-closed capability
//! cache, the audit tail anchor seeded once from the existing chains, the endpoint
//! each saved member-local binding is pinned to, the deferred credential-delete
//! list, the database and schema each history run targeted, and the introspection
//! producer that wrote the cached catalogs) preserves the supported baseline; a
//! mismatched
//! app-owned store is reset by [`Store::open`](super::Store::open) instead of being
//! decoded or upgraded.

use super::*;

/// First MVP baseline. Earlier development schemas are reset instead of upgraded.
pub(super) const LOCAL_SCHEMA_BASELINE: i64 = 1;
pub(super) const LOCAL_SCHEMA_APPLICATION_ID: i64 = 0x444f_5045;

/// `app_settings` key recording which introspection producer wrote `catalog_cache`.
const CATALOG_PRODUCER_SETTING: &str = "catalog_producer_revision";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LocalStoreBootstrap {
    Ready { created: bool },
    ResetRequired { version: i64, application_id: i64 },
}

pub(super) async fn bootstrap_local_store(pool: &SqlitePool) -> AppResult<LocalStoreBootstrap> {
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    let application_id: i64 = sqlx::query_scalar("PRAGMA application_id")
        .fetch_one(pool)
        .await?;
    if version == LOCAL_SCHEMA_BASELINE && application_id == LOCAL_SCHEMA_APPLICATION_ID {
        super::retire_graph_storage::retire_graph_storage(pool).await?;
        // Add only a fail-closed hosted capability cache to the supported baseline.
        // This does not convert authority or reset existing local data.
        let columns = sqlx::query("PRAGMA table_info(connections)")
            .fetch_all(pool)
            .await?;
        if !columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "schema_access_available")
        {
            sqlx::query("ALTER TABLE connections ADD COLUMN schema_access_available INTEGER NOT NULL DEFAULT 0 CHECK(schema_access_available IN (0, 1))")
                .execute(pool).await?;
        }
        add_audit_chain_anchors(pool).await?;
        add_binding_endpoint_pins(pool).await?;
        add_deferred_credential_deletes(pool).await?;
        add_history_targets(pool).await?;
        normalize_environment_kinds(pool).await?;
        retire_older_catalog_producer(pool).await?;
        sqlx::raw_sql(schema::PERSONAL_ARTICLES_SCHEMA)
            .execute(pool)
            .await?;
        return Ok(LocalStoreBootstrap::Ready { created: false });
    }
    if version != 0 || application_id != 0 {
        return Ok(LocalStoreBootstrap::ResetRequired {
            version,
            application_id,
        });
    }

    let mut transaction = pool.begin().await?;
    sqlx::raw_sql(schema::SCHEMA)
        .execute(&mut *transaction)
        .await?;
    sqlx::raw_sql(schema::KNOWLEDGE_SCHEMA)
        .execute(&mut *transaction)
        .await?;
    sqlx::raw_sql(schema::PERSONAL_ARTICLES_SCHEMA)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("PRAGMA application_id = 1146048581")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("PRAGMA user_version = 1")
        .execute(&mut *transaction)
        .await?;
    record_catalog_producer(&mut transaction).await?;
    transaction.commit().await?;
    Ok(LocalStoreBootstrap::Ready { created: true })
}

/// A cached catalog is served only by the introspection producer that wrote it. When
/// the build's producer revision differs from the one recorded, every cached catalog
/// is retired once and the current revision recorded; an unchanged store is only read.
async fn retire_older_catalog_producer(pool: &SqlitePool) -> AppResult<()> {
    let current = crate::introspect::CATALOG_PRODUCER_REVISION.to_string();
    let recorded: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = ?1")
            .bind(CATALOG_PRODUCER_SETTING)
            .fetch_optional(pool)
            .await?;
    if recorded.as_deref() == Some(current.as_str()) {
        return Ok(());
    }
    let mut transaction = pool.begin().await?;
    sqlx::query("DELETE FROM catalog_cache")
        .execute(&mut *transaction)
        .await?;
    record_catalog_producer(&mut transaction).await?;
    transaction.commit().await?;
    Ok(())
}

async fn record_catalog_producer(transaction: &mut Transaction<'_, Sqlite>) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(CATALOG_PRODUCER_SETTING)
    .bind(crate::introspect::CATALOG_PRODUCER_REVISION.to_string())
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

/// Adds the audit tail-anchor table to a baseline store that lacks it, seeded from
/// each chain as it exists at that moment. Later appends advance it in their own
/// transaction, and an anchor row that disappears is reported by verification rather
/// than re-seeded. Dropping the whole table is an `app.db` rewrite, which stays
/// outside tamper-evidence like rewriting the rows and anchor together.
pub(super) async fn add_audit_chain_anchors(pool: &SqlitePool) -> AppResult<()> {
    let present: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_chain_anchors'",
    )
    .fetch_optional(pool)
    .await?;
    if present.is_some() {
        return Ok(());
    }
    let mut transaction = pool.begin().await?;
    sqlx::raw_sql(schema::AUDIT_CHAIN_ANCHOR_SCHEMA)
        .execute(&mut *transaction)
        .await?;
    sqlx::query(
        "INSERT INTO audit_chain_anchors (connection_id, entry_count, tail_hash, updated_at)
         SELECT chain.connection_id, count(*),
                (SELECT tail.hash FROM audit_log tail
                 WHERE tail.connection_id = chain.connection_id
                 ORDER BY tail.rowid DESC LIMIT 1),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         FROM audit_log chain
         GROUP BY chain.connection_id",
    )
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

/// Adds the deferred credential-delete list to a baseline store exactly once. It
/// starts empty: earlier failed deletions were kept only in memory.
async fn add_deferred_credential_deletes(pool: &SqlitePool) -> AppResult<()> {
    let present: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deferred_credential_deletes'",
    )
    .fetch_optional(pool)
    .await?;
    if present.is_none() {
        sqlx::raw_sql(schema::DEFERRED_CREDENTIAL_DELETE_SCHEMA)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Adds the run-target columns to a baseline store's history exactly once. Rows
/// recorded before them keep no target and reopen in the connection's default.
async fn add_history_targets(pool: &SqlitePool) -> AppResult<()> {
    let columns = sqlx::query("PRAGMA table_info(query_history)")
        .fetch_all(pool)
        .await?;
    let missing = schema::HISTORY_TARGET_COLUMNS
        .into_iter()
        .filter(|column| {
            let name = column.split_whitespace().next().unwrap_or_default();
            !columns
                .iter()
                .any(|row| row.get::<String, _>("name") == name)
        })
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return Ok(());
    }
    let mut transaction = pool.begin().await?;
    for column in missing {
        // Assembled only from a compile-time constant.
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER TABLE query_history ADD COLUMN {column}"
        )))
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}

/// Adds the binding endpoint pin to a baseline store exactly once. Each member-local
/// binding that already holds a credential is pinned to the template it is used
/// with today; from then on a template that moves or weakens its transport needs
/// the member to bind again before the credential is read.
async fn add_binding_endpoint_pins(pool: &SqlitePool) -> AppResult<()> {
    let columns = sqlx::query("PRAGMA table_info(workspace_connection_bindings)")
        .fetch_all(pool)
        .await?;
    if columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "bound_endpoint")
    {
        return Ok(());
    }
    let mut transaction = pool.begin().await?;
    // Both statements are assembled only from compile-time constants.
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "ALTER TABLE workspace_connection_bindings ADD COLUMN {}",
        schema::BINDING_BOUND_ENDPOINT_COLUMN
    )))
    .execute(&mut *transaction)
    .await?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE workspace_connection_bindings
         SET bound_endpoint = (
             SELECT {} FROM connections
             WHERE connections.id = workspace_connection_bindings.connection_id
         )
         WHERE secret_ref IS NOT NULL",
        projections::TEMPLATE_ENDPOINT_JSON
    )))
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

/// Rewrites Project environments to the fixed kind list exactly once and
/// normalises connection labels to the same vocabulary.
///
/// A row's kind is `production` when it was flagged production or classed so,
/// `custom` becomes `development`, and every other class carries over. When a
/// Project holds several rows of one kind, the lowest id keeps that kind (the
/// control plane folds by the same rule, so a cache and its server agree) and
/// the others fold into it: their sources, bindings, and Personal Articles are re-pointed at the
/// survivor (stamped with its revision) and the emptied rows are removed, so no
/// binding is lost and ids that were never duplicated stay stable. The table is
/// rebuilt with foreign keys off, as SQLite requires, and
/// checked before commit.
async fn normalize_environment_kinds(pool: &SqlitePool) -> AppResult<()> {
    // A store already in the fixed vocabulary is only read, so a read-only database opens.
    let retired_labels: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM connections
         WHERE env IS NOT NULL AND env NOT IN ('production', 'staging', 'test', 'development'))",
    )
    .fetch_one(pool)
    .await?;
    if retired_labels {
        sqlx::query(
            "UPDATE connections
             SET env = CASE lower(trim(env))
                     WHEN 'prod' THEN 'production' WHEN 'dev' THEN 'development'
                     WHEN 'staging' THEN 'staging' WHEN 'test' THEN 'test'
                     ELSE NULL END
             WHERE env IS NOT NULL
               AND env NOT IN ('production', 'staging', 'test', 'development')",
        )
        .execute(pool)
        .await?;
    }
    let columns = sqlx::query("PRAGMA table_info(knowledge_project_environments)")
        .fetch_all(pool)
        .await?;
    if !columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "risk_class")
    {
        return Ok(());
    }
    let mut connection = pool.acquire().await?;
    let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&mut *connection)
        .await?;
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *connection)
        .await?;
    let rebuilt = rebuild_environments_by_kind(&mut connection).await;
    if foreign_keys != 0 {
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&mut *connection)
            .await?;
    }
    rebuilt
}

async fn rebuild_environments_by_kind(connection: &mut sqlx::SqliteConnection) -> AppResult<()> {
    const KIND: &str = "CASE WHEN {t}.production = 1 THEN 'production'
                             WHEN {t}.risk_class = 'custom' THEN 'development'
                             ELSE {t}.risk_class END";
    let kind_of = |table: &str| KIND.replace("{t}", table);
    let mut tx = sqlx::Connection::begin(&mut *connection).await?;
    // Assembled only from compile-time constants.
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "CREATE TEMP TABLE environment_merge AS
         SELECT old.id AS old_id,
                (SELECT owner.id FROM knowledge_project_environments owner
                 WHERE owner.project_id = old.project_id
                   AND ({owner_kind}) = ({old_kind})
                 ORDER BY owner.id LIMIT 1) AS owner_id
         FROM knowledge_project_environments old",
        owner_kind = kind_of("owner"),
        old_kind = kind_of("old"),
    )))
    .execute(&mut *tx)
    .await?;
    let owner_revision = "(SELECT revision FROM knowledge_project_environments
                           WHERE id = (SELECT owner_id FROM environment_merge WHERE old_id = {t}.project_environment_id))";
    let folded = "(SELECT old_id FROM environment_merge WHERE old_id <> owner_id)";
    for table in ["knowledge_sources", "knowledge_environment_connections"] {
        // Table names come from this constant list.
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {table}
             SET environment_revision = {revision},
                 project_environment_id =
                     (SELECT owner_id FROM environment_merge
                      WHERE old_id = {table}.project_environment_id)
             WHERE project_environment_id IN {folded}",
            revision = owner_revision.replace("{t}", table),
        )))
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE personal_analysis_articles
         SET environment_id =
             (SELECT owner_id FROM environment_merge
              WHERE old_id = personal_analysis_articles.environment_id)
         WHERE environment_id IN {folded}"
    )))
    .execute(&mut *tx)
    .await?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DELETE FROM knowledge_project_environments WHERE id IN {folded}"
    )))
    .execute(&mut *tx)
    .await?;
    sqlx::raw_sql(
        "CREATE TABLE knowledge_project_environments_next (
             id         TEXT PRIMARY KEY,
             project_id TEXT NOT NULL REFERENCES knowledge_projects(id) ON DELETE CASCADE,
             kind       TEXT NOT NULL CHECK(kind IN ('production', 'staging', 'test', 'development')),
             revision   INTEGER NOT NULL CHECK(revision > 0),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             UNIQUE(project_id, kind)
         );",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO knowledge_project_environments_next
             (id, project_id, kind, revision, created_at, updated_at)
         SELECT id, project_id, {kind}, revision, created_at, updated_at
         FROM knowledge_project_environments",
        kind = kind_of("knowledge_project_environments"),
    )))
    .execute(&mut *tx)
    .await?;
    sqlx::raw_sql(
        "DROP TABLE knowledge_project_environments;
         ALTER TABLE knowledge_project_environments_next
             RENAME TO knowledge_project_environments;
         DROP TABLE environment_merge;",
    )
    .execute(&mut *tx)
    .await?;
    let broken = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *tx)
        .await?;
    if !broken.is_empty() {
        return Err(AppError::Config(
            "the Project environment migration left a dangling reference".into(),
        ));
    }
    tx.commit().await?;
    Ok(())
}
