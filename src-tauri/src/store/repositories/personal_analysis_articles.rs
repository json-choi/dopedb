//! Device-only Article definitions and revisions. Every operation requires the
//! active personal workspace; encrypted payloads bind their exact id and revision.

use super::super::*;
use super::analysis_articles::{decrypt, encrypt};
use crate::features::analysis_articles::{
    AnalysisArticleMutation, AnalysisArticleRevision, AnalysisArticleSummary,
};
use crate::kernel::access::WorkspaceKind;
use dopedb_protocol::{
    AnalysisArticleRecord, AnalysisArticleVersionPayload, SharedAnalysisArticleCreate,
};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const EXACT_PIN_SQL: &str = "SELECT EXISTS(SELECT 1 FROM knowledge_environment_connections binding
 JOIN knowledge_project_environments environment ON environment.id = binding.project_environment_id
 JOIN knowledge_projects project ON project.id = environment.project_id
 JOIN connections connection ON connection.id = binding.connection_id
 WHERE binding.project_environment_id = ?1 AND binding.environment_revision = ?2
 AND environment.revision = ?2 AND binding.connection_id = ?3
 AND binding.connection_revision = ?4 AND connection.revision = ?4
 AND binding.revoked_at IS NULL AND connection.deleted_at IS NULL
 AND binding.workspace_id = ?5 AND project.workspace_id = ?5 AND connection.workspace_id = ?5)";

pub(crate) async fn personal_article_key() -> AppResult<Zeroizing<[u8; 32]>> {
    tokio::task::spawn_blocking(crate::connection::keychain::analysis_result_cache_key)
        .await
        .map_err(|_| AppError::Config("Analysis Article key task stopped".into()))?
}

fn aad(article_id: Uuid, revision: i64) -> Vec<u8> {
    format!(
        "dopedb.personal-article.v1\0{}\0{article_id}\0{revision}",
        schema::PERSONAL_WORKSPACE_ID
    )
    .into_bytes()
}

impl Store {
    pub(crate) async fn require_personal_articles(&self) -> AppResult<()> {
        let scope = self.active_resource_scope().await?;
        if scope.workspace_kind != WorkspaceKind::Personal
            || scope.workspace_id.to_string() != schema::PERSONAL_WORKSPACE_ID
        {
            return Err(AppError::Blocked {
                reason: "Personal Analysis Article workspace changed".into(),
            });
        }
        Ok(())
    }

    /// Checks the exact, current Project binding even when no cloud account exists.
    pub(crate) async fn check_personal_article_pin(
        &self,
        environment_id: Uuid,
        environment_revision: i64,
        connection_id: Uuid,
        connection_revision: i64,
    ) -> AppResult<()> {
        self.require_personal_articles().await?;
        let valid: bool = sqlx::query_scalar(EXACT_PIN_SQL)
            .bind(environment_id.to_string())
            .bind(environment_revision)
            .bind(connection_id.to_string())
            .bind(connection_revision)
            .bind(schema::PERSONAL_WORKSPACE_ID)
            .fetch_one(&self.pool)
            .await?;
        if !valid {
            return Err(AppError::SharedConnectionChanged);
        }
        Ok(())
    }

    pub(crate) async fn personal_article(
        &self,
        article_id: Uuid,
        key: &Zeroizing<[u8; 32]>,
    ) -> AppResult<AnalysisArticleRecord> {
        self.require_personal_articles().await?;
        let row = sqlx::query(
            "SELECT revisions.revision, revisions.nonce, revisions.ciphertext FROM personal_analysis_articles article
             JOIN personal_analysis_article_revisions revisions ON revisions.article_id = article.id AND revisions.revision = article.revision
             WHERE article.id = ?1 AND article.deleted = 0"
        ).bind(article_id.to_string()).fetch_optional(&self.pool).await?
            .ok_or_else(|| AppError::NotFound("Analysis Article".into()))?;
        decode(article_id, &row, key)
    }

    pub(crate) async fn personal_article_summaries(
        &self,
        environment_id: Option<Uuid>,
        key: &Zeroizing<[u8; 32]>,
    ) -> AppResult<Vec<AnalysisArticleSummary>> {
        self.require_personal_articles().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM personal_analysis_articles WHERE deleted = 0 AND (?1 IS NULL OR environment_id = ?1) ORDER BY updated_at DESC, id LIMIT 501"
        ).bind(environment_id.map(|id| id.to_string())).fetch_all(&self.pool).await?;
        if ids.len() > 500 {
            return Err(AppError::Config(
                "Analysis Article collection is too large".into(),
            ));
        }
        let mut summaries = Vec::with_capacity(ids.len());
        for id in ids {
            summaries.push(self.personal_article(parse_uuid(id)?, key).await?.into());
        }
        Ok(summaries)
    }

    pub(crate) async fn save_personal_article(
        &self,
        input: &SharedAnalysisArticleCreate,
        expected_revision: Option<i64>,
        key: &Zeroizing<[u8; 32]>,
    ) -> AppResult<AnalysisArticleMutation> {
        self.check_personal_article_pin(
            input.project_environment_id,
            input.environment_revision,
            input.connection_id,
            input.connection_revision,
        )
        .await?;
        let profile = self.get_connection(input.connection_id).await?;
        let classification = crate::safety::classify(&input.definition.query.sql, profile.engine)?;
        if classification.kind != QueryKind::Read
            || classification.statement_count != 1
            || profile.engine == Engine::Mongodb
            || profile.provider == Provider::CloudflareD1
        {
            return Err(AppError::Blocked {
                reason: "Analysis Articles require one database-enforced read-only query".into(),
            });
        }
        let previous = if expected_revision.is_some() {
            Some(self.personal_article(input.id, key).await?)
        } else {
            None
        };
        if previous
            .as_ref()
            .is_some_and(|article| Some(article.revision) != expected_revision)
        {
            return Ok(AnalysisArticleMutation::RevisionConflict);
        }
        let now = Utc::now();
        let mut definition = input.definition.clone();
        definition.html =
            crate::features::analysis_articles::sanitize_article_html(&definition.html)?;
        let article = AnalysisArticleRecord {
            id: input.id,
            project_environment_id: input.project_environment_id,
            environment_revision: input.environment_revision,
            connection_id: input.connection_id,
            connection_revision: input.connection_revision,
            definition,
            owner_member_id: previous.as_ref().map_or_else(
                || "local-owner".into(),
                |article| article.owner_member_id.clone(),
            ),
            updated_by_member_id: "local-owner".into(),
            revision: expected_revision
                .unwrap_or(0)
                .checked_add(1)
                .ok_or_else(|| {
                    AppError::Config("Analysis Article revision limit reached".into())
                })?,
            latest_successful_run_id: previous
                .as_ref()
                .and_then(|article| article.latest_successful_run_id),
            created_at: previous.as_ref().map_or(now, |article| article.created_at),
            updated_at: now,
        };
        let payload = serde_json::to_vec(&article)?;
        if payload.len() > 1_048_560 {
            return Err(AppError::Config(
                "Analysis Article definition is too large".into(),
            ));
        }
        let (nonce, ciphertext) = encrypt(key, &aad(article.id, article.revision), &payload)?;
        let mut transaction = self.pool.begin().await?;
        ensure_personal_transaction(&mut transaction).await?;
        let current: bool = sqlx::query_scalar(EXACT_PIN_SQL)
            .bind(input.project_environment_id.to_string())
            .bind(input.environment_revision)
            .bind(input.connection_id.to_string())
            .bind(input.connection_revision)
            .bind(schema::PERSONAL_WORKSPACE_ID)
            .fetch_one(&mut *transaction)
            .await?;
        if !current {
            return Err(AppError::SharedConnectionChanged);
        }
        let affected = if let Some(expected) = expected_revision {
            sqlx::query("UPDATE personal_analysis_articles SET environment_id = ?1, revision = ?2, updated_at = ?3 WHERE id = ?4 AND revision = ?5 AND deleted = 0")
                .bind(article.project_environment_id.to_string()).bind(article.revision).bind(now.to_rfc3339()).bind(article.id.to_string()).bind(expected).execute(&mut *transaction).await?.rows_affected()
        } else {
            sqlx::query("INSERT INTO personal_analysis_articles(id, environment_id, revision, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO NOTHING")
                .bind(article.id.to_string()).bind(article.project_environment_id.to_string()).bind(article.revision).bind(now.to_rfc3339()).execute(&mut *transaction).await?.rows_affected()
        };
        if affected != 1 {
            return Ok(AnalysisArticleMutation::RevisionConflict);
        }
        sqlx::query("INSERT INTO personal_analysis_article_revisions(article_id, revision, nonce, ciphertext) VALUES (?1, ?2, ?3, ?4)")
            .bind(article.id.to_string()).bind(article.revision).bind(nonce).bind(ciphertext).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(AnalysisArticleMutation::Applied(Box::new(article)))
    }

    pub(crate) async fn personal_article_revisions(
        &self,
        article_id: Uuid,
        key: &Zeroizing<[u8; 32]>,
    ) -> AppResult<Vec<AnalysisArticleRevision>> {
        self.personal_article(article_id, key).await?;
        let rows = sqlx::query("SELECT revision, nonce, ciphertext FROM personal_analysis_article_revisions WHERE article_id = ?1 ORDER BY revision DESC LIMIT 100")
            .bind(article_id.to_string()).fetch_all(&self.pool).await?;
        rows.iter()
            .map(|row| {
                let article = decode(article_id, row, key)?;
                let payload = AnalysisArticleVersionPayload {
                    id: article.id,
                    project_environment_id: article.project_environment_id,
                    environment_revision: article.environment_revision,
                    connection_id: article.connection_id,
                    connection_revision: article.connection_revision,
                    definition: article.definition,
                    owner_member_id: article.owner_member_id,
                    deleted: false,
                };
                Ok(AnalysisArticleRevision {
                    revision: article.revision,
                    base_revision: (article.revision > 1).then_some(article.revision - 1),
                    operation: if article.revision == 1 {
                        "proposed"
                    } else {
                        "updated"
                    }
                    .into(),
                    payload_hash: hex::encode(Sha256::digest(serde_json::to_vec(&payload)?)),
                    payload,
                    created_by_member_id: article.updated_by_member_id,
                    created_at: article.updated_at,
                })
            })
            .collect()
    }

    pub(crate) async fn delete_personal_article(
        &self,
        article_id: Uuid,
        expected_revision: i64,
        key: &Zeroizing<[u8; 32]>,
    ) -> AppResult<i64> {
        self.require_personal_articles().await?;
        if expected_revision < 1 {
            return Err(AppError::Config(
                "Analysis Article revision is invalid".into(),
            ));
        }
        let mut article = self.personal_article(article_id, key).await?;
        if article.revision != expected_revision {
            return Err(AppError::OutcomeUnknown(
                "Analysis Article revision changed; deletion was not applied".into(),
            ));
        }
        article.revision = expected_revision
            .checked_add(1)
            .ok_or_else(|| AppError::Config("Analysis Article revision limit reached".into()))?;
        article.updated_at = Utc::now();
        let (nonce, ciphertext) = encrypt(
            key,
            &aad(article_id, article.revision),
            &serde_json::to_vec(&article)?,
        )?;
        let mut transaction = self.pool.begin().await?;
        ensure_personal_transaction(&mut transaction).await?;
        let updated = sqlx::query("UPDATE personal_analysis_articles SET deleted = 1, updated_at = ?1, revision = ?4 WHERE id = ?2 AND revision = ?3 AND deleted = 0")
            .bind(article.updated_at.to_rfc3339()).bind(article_id.to_string()).bind(expected_revision).bind(article.revision).execute(&mut *transaction).await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::OutcomeUnknown(
                "Analysis Article revision changed; deletion was not applied".into(),
            ));
        }
        sqlx::query("INSERT INTO personal_analysis_article_revisions(article_id, revision, nonce, ciphertext) VALUES (?1, ?2, ?3, ?4)")
            .bind(article_id.to_string()).bind(article.revision).bind(nonce).bind(ciphertext).execute(&mut *transaction).await?;
        transaction.commit().await?;
        self.delete_analysis_article_local_results(article_id)
            .await?;
        Ok(article.revision)
    }
}

pub(super) async fn ensure_personal_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
) -> AppResult<()> {
    let active: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'active_workspace_id'")
            .fetch_optional(&mut **transaction)
            .await?;
    if active.as_deref() != Some(schema::PERSONAL_WORKSPACE_ID) {
        return Err(AppError::Blocked {
            reason: "Personal Analysis Article workspace changed".into(),
        });
    }
    Ok(())
}

fn decode(
    article_id: Uuid,
    row: &sqlx::sqlite::SqliteRow,
    key: &Zeroizing<[u8; 32]>,
) -> AppResult<AnalysisArticleRecord> {
    let revision: i64 = row.try_get("revision")?;
    let nonce: Vec<u8> = row.try_get("nonce")?;
    let ciphertext: Vec<u8> = row.try_get("ciphertext")?;
    let bytes = decrypt(key, &aad(article_id, revision), &nonce, &ciphertext)?;
    let article: AnalysisArticleRecord = serde_json::from_slice(&bytes)?;
    if article.id != article_id || article.revision != revision {
        return Err(AppError::Config(
            "Personal Analysis Article authority is invalid".into(),
        ));
    }
    Ok(article)
}

#[cfg(test)]
pub(super) async fn assert_personal_article_contract() {
    use crate::features::analysis_articles::{
        adapters::DesktopAnalysisReadExecution, AnalysisArticleRunner, AnalysisDefinitionRunRequest,
    };
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open_at(&directory.path().join("app.db"))
        .await
        .unwrap();
    let connection_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let environment_id = Uuid::new_v4();
    let source_path = directory.path().join("source.sqlite");
    let source = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&source_path)
                .create_if_missing(true),
        )
        .await
        .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE customers(id INTEGER PRIMARY KEY); INSERT INTO customers VALUES(1),(2);",
    )
    .execute(&source)
    .await
    .unwrap();
    source.close().await;
    let now = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO connections(id,name,engine,host,port,db_name,username,sslmode,created_at,updated_at) VALUES(?1,'Article QA','sqlite','',0,?2,'','disable',?3,?3)")
        .bind(connection_id.to_string()).bind(source_path.to_str().unwrap()).bind(&now).execute(store.pool()).await.unwrap();
    sqlx::query("INSERT INTO knowledge_projects(id,workspace_id,name,revision,created_at,updated_at) VALUES(?1,?2,'Article QA',1,?3,?3)")
        .bind(project_id.to_string()).bind(schema::PERSONAL_WORKSPACE_ID).bind(&now).execute(store.pool()).await.unwrap();
    sqlx::query("INSERT INTO knowledge_project_environments(id,project_id,name,production,risk_class,revision,created_at,updated_at) VALUES(?1,?2,'main',0,'development',1,?3,?3)")
        .bind(environment_id.to_string()).bind(project_id.to_string()).bind(&now).execute(store.pool()).await.unwrap();
    sqlx::query("INSERT INTO knowledge_environment_connections(id,workspace_id,project_environment_id,environment_revision,connection_id,connection_revision,role,alias,created_at) VALUES(?1,?2,?3,1,?4,1,'read','main',?5)")
        .bind(Uuid::new_v4().to_string()).bind(schema::PERSONAL_WORKSPACE_ID).bind(environment_id.to_string()).bind(connection_id.to_string()).bind(&now).execute(store.pool()).await.unwrap();
    let key = Zeroizing::new([7; 32]);
    let mut input: SharedAnalysisArticleCreate = serde_json::from_value(serde_json::json!({
        "id": Uuid::new_v4(), "projectEnvironmentId": environment_id, "environmentRevision": 1,
        "connectionId": connection_id, "connectionRevision": 1,
        "definition": {"version":3,"source":"dopedb.acp.codex","title":"Customer count","html":"<h2>Customers</h2><script>unsafe()</script><p onclick=\"unsafe()\">Two</p><svg viewBox=\"0 0 100 100\"><rect width=\"50\" height=\"20\" fill=\"currentColor\"/><path d=\"M0 0L50 50\" stroke=\"url(https://example.com/paint)\"/><foreignObject><iframe src=\"https://example.com\"></iframe></foreignObject></svg>",
        "query":{"id":"customers","title":"Count","sql":"SELECT COUNT(*) AS total FROM customers","maxRows":100,"maxBytes":4096,
        "columns":[{"name":"total","type":"number","nullable":false,"role":"measure","sensitivity":"public","masking":"none"}]}}
    })).unwrap();
    let AnalysisArticleMutation::Applied(created) = store
        .save_personal_article(&input, None, &key)
        .await
        .unwrap()
    else {
        panic!("creation must succeed");
    };
    assert!(!created.definition.html.contains("script"));
    assert!(!created.definition.html.contains("onclick"));
    assert!(!created.definition.html.contains("iframe"));
    assert!(!created.definition.html.contains("url("));
    assert!(created.definition.html.contains("<svg"));
    assert!(created.definition.html.contains("currentColor"));
    let encrypted: Vec<u8> = sqlx::query_scalar(
        "SELECT ciphertext FROM personal_analysis_article_revisions WHERE article_id = ?1",
    )
    .bind(input.id.to_string())
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert!(!encrypted.windows(9).any(|bytes| bytes == b"Customers"));
    assert_eq!(
        store.personal_article(input.id, &key).await.unwrap(),
        *created
    );
    assert_eq!(
        store
            .personal_article_summaries(Some(environment_id), &key)
            .await
            .unwrap()
            .len(),
        1
    );
    input.definition.title = "Updated count".into();
    assert!(matches!(
        store
            .save_personal_article(&input, Some(1), &key)
            .await
            .unwrap(),
        AnalysisArticleMutation::Applied(_)
    ));
    assert!(matches!(
        store
            .save_personal_article(&input, Some(1), &key)
            .await
            .unwrap(),
        AnalysisArticleMutation::RevisionConflict
    ));
    assert_eq!(
        store
            .personal_article_revisions(input.id, &key)
            .await
            .unwrap()
            .len(),
        2
    );
    let (operation, _) = crate::operations::OperationRuntime::new(&store);
    let providers = crate::features::providers::prepare(store.clone(), operation);
    let manager = crate::connection::ConnectionManager::with_authorities(
        store.clone(),
        Arc::new(crate::features::workspaces::adapters::HostedWorkspaceControlPlane),
        providers.local_connection_port(),
    );
    let execution = DesktopAnalysisReadExecution::new(
        store.clone(),
        manager.clone(),
        crate::features::knowledge::compose(store.clone()),
    );
    let runner = AnalysisArticleRunner::new(execution);
    let request = || AnalysisDefinitionRunRequest {
        workspace_id: Some(Uuid::parse_str(schema::PERSONAL_WORKSPACE_ID).unwrap()),
        project_environment_id: Some(environment_id),
        environment_revision: Some(1),
        article_id: input.id,
        article_revision: 2,
        definition: input.definition.clone(),
        connection_id,
        connection_revision: 1,
        run_id: Uuid::new_v4(),
        persist_local_result: false,
    };
    let receipt = runner.run_definition(request()).await.unwrap();
    assert_eq!(receipt.result.rows, vec![vec![serde_json::json!(2)]]);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM query_history")
        .fetch_one(store.pool())
        .await
        .unwrap();
    sqlx::query("UPDATE connections SET revision = 2 WHERE id = ?1")
        .bind(connection_id.to_string())
        .execute(store.pool())
        .await
        .unwrap();
    assert!(matches!(
        runner.run_definition(request()).await,
        Err(AppError::SharedConnectionChanged)
    ));
    let unchanged: i64 = sqlx::query_scalar("SELECT count(*) FROM query_history")
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(count, unchanged);
    assert!(store
        .save_personal_article(&input, Some(2), &key)
        .await
        .is_err());
    assert!(store
        .delete_personal_article(input.id, 1, &key)
        .await
        .is_err());
    assert_eq!(
        store
            .delete_personal_article(input.id, 2, &key)
            .await
            .unwrap(),
        3
    );
    assert!(store.personal_article(input.id, &key).await.is_err());
    assert!(store
        .personal_article_summaries(None, &key)
        .await
        .unwrap()
        .is_empty());
    sqlx::query("UPDATE app_settings SET value = ?1 WHERE key = 'active_workspace_id'")
        .bind(Uuid::new_v4().to_string())
        .execute(store.pool())
        .await
        .unwrap();
    assert!(store.personal_article(input.id, &key).await.is_err());
    manager.shutdown_all().await;
    store.pool.close().await;
}
