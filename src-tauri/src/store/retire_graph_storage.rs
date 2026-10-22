//! One-time retirement of graph-only state in the supported, app-owned baseline.
//! Connections, accounts, Projects, database bindings and execution evidence stay intact.

use super::*;

pub(super) async fn retire_graph_storage(pool: &SqlitePool) -> AppResult<()> {
    let graph_present: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_graph_revisions')",
    ).fetch_one(pool).await?;
    let source_columns = sqlx::query("PRAGMA table_info(knowledge_sources)")
        .fetch_all(pool)
        .await?;
    let old_sources = source_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "visibility");
    if !graph_present && !old_sources {
        return Ok(());
    }

    if old_sources {
        let retired_roots: Vec<String> =
            sqlx::query_scalar("SELECT id FROM knowledge_sources WHERE provider = 'local_folder'")
                .fetch_all(pool)
                .await?;
        let retired_roots = retired_roots
            .into_iter()
            .map(parse_uuid)
            .collect::<AppResult<Vec<_>>>()?;
        if !retired_roots.is_empty() {
            // Failure leaves every source row in place so cleanup can be retried.
            crate::connection::keychain::retire_knowledge_source_roots(retired_roots).await?;
        }
    }

    let mut transaction = pool.begin().await?;
    // Keep transcripts and exact source/DB pins, while erasing retired graph
    // selectors. Invalid metadata stays untouched and follows fail-closed recovery.
    sqlx::query(
        "UPDATE agent_acp_sessions SET knowledge_scopes = (
            SELECT json_group_array(CASE WHEN scope.type = 'object'
                THEN json(json_remove(scope.value, '$.knowledgeGrantId', '$.graphRevisionIds'))
                ELSE scope.value END)
            FROM json_each(agent_acp_sessions.knowledge_scopes) scope
         ) WHERE CASE WHEN json_valid(knowledge_scopes)
             THEN json_type(knowledge_scopes) = 'array' ELSE 0 END",
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::raw_sql(
        "DROP TABLE IF EXISTS knowledge_mapping_proposals;
         DROP TABLE IF EXISTS knowledge_grant_graph_revisions;
         DROP TABLE IF EXISTS knowledge_grants;
         DROP TABLE IF EXISTS knowledge_environment_heads;
         DROP TRIGGER IF EXISTS knowledge_graph_revisions_reject_update;",
    )
    .execute(&mut *transaction)
    .await?;
    if graph_present {
        sqlx::query("UPDATE knowledge_graph_revisions SET parent_graph_revision_id = NULL")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DROP TABLE knowledge_graph_revisions")
            .execute(&mut *transaction)
            .await?;
    }
    if old_sources {
        // Reuse the current baseline DDL rather than maintaining another source schema.
        // Both the SQL and replacement identifier are application constants.
        let source_ddl = schema::KNOWLEDGE_SCHEMA
            .split_once("CREATE TABLE knowledge_sources")
            .expect("source baseline")
            .1
            .split_once("CREATE TABLE knowledge_environment_connections")
            .expect("binding baseline")
            .0;
        let (table_body, index_body) = source_ddl.split_once("CREATE INDEX").expect("source index");
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "CREATE TABLE retained_knowledge_sources{table_body}"
        )))
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO retained_knowledge_sources
                (id, project_id, project_environment_id, environment_revision, provider,
                 display_name, binding_json, revoked_at, created_at, updated_at)
             SELECT id, project_id, project_environment_id, environment_revision, provider,
                 display_name, json_remove(binding_json, '$.visibility'), revoked_at, created_at, updated_at
             FROM knowledge_sources WHERE provider = 'github'",
        ).execute(&mut *transaction).await?;
        sqlx::query("DROP TABLE knowledge_sources")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("ALTER TABLE retained_knowledge_sources RENAME TO knowledge_sources")
            .execute(&mut *transaction)
            .await?;
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!("CREATE INDEX{index_body}")))
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}
