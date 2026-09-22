//! Packaged benchmark fixture preparation.

use super::*;

#[cfg(feature = "packaged-benchmark")]
pub(crate) fn prepare_fixture_if_requested() -> AppResult<bool> {
    let Some(raw) = std::env::var_os("DOPEDB_PACKAGED_BENCHMARK_PREPARE_CONNECTIONS") else {
        return Ok(false);
    };
    let raw = raw
        .to_str()
        .ok_or_else(|| AppError::Config("benchmark connection count is invalid".into()))?;
    let count = parse_connection_count(raw)?;
    tauri::async_runtime::block_on(async move {
        let store = crate::store::Store::open().await?;
        prepare_connections(&store, count).await?;
        let fixture_kind = benchmark_fixture_kind()?;
        match fixture_kind {
            "standard" => {}
            "table-data" if count == 20 => prepare_table_data(&store).await?,
            "long-lived" if count == 20 => prepare_long_lived_data(&store).await?,
            "recovery" if count == 20 => prepare_recovery_data(&store).await?,
            "table-data" | "long-lived" | "recovery" => {
                return Err(AppError::Config(
                    "dense benchmark fixtures require 20 connections".into(),
                ));
            }
            _ => {
                return Err(AppError::Config(
                    "packaged benchmark fixture kind is invalid".into(),
                ));
            }
        }
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(store.pool())
            .await?;
        store.pool().close().await;
        Ok::<(), AppError>(())
    })?;
    println!(
        "DOPEDB_PACKAGED_BENCHMARK_FIXTURE:{}",
        serde_json::json!({
            "schemaVersion": 1,
            "connectionCount": count,
            "fixtureKind": benchmark_fixture_kind()?,
        })
    );
    Ok(true)
}

#[cfg(feature = "packaged-benchmark")]
fn benchmark_fixture_kind() -> AppResult<&'static str> {
    match std::env::var("DOPEDB_PACKAGED_BENCHMARK_FIXTURE_KIND")
        .unwrap_or_else(|_| "standard".into())
        .as_str()
    {
        "standard" => Ok("standard"),
        "table-data" => Ok("table-data"),
        "long-lived" => Ok("long-lived"),
        "recovery" => Ok("recovery"),
        _ => Err(AppError::Config(
            "packaged benchmark fixture kind is invalid".into(),
        )),
    }
}

#[cfg(feature = "packaged-benchmark")]
async fn prepare_connections(store: &crate::store::Store, count: usize) -> AppResult<()> {
    use crate::model::{
        ConnectionProfile, Engine, Provider, WorkspaceConnectionAccess, WorkspaceCredentialMode,
    };

    let root = crate::app_paths::data_root()?;
    for index in 0..count {
        let database = root.join(format!("fixture-{index:02}.sqlite"));
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&database)?;
        let profile = ConnectionProfile {
            id: Uuid::from_u128(0xbed0_0000_0000_0000_0000_0000_0000_0000 + index as u128 + 1),
            name: format!("Benchmark {:02}", index + 1),
            engine: Engine::Sqlite,
            provider: Provider::Generic,
            driver_id: None,
            host: String::new(),
            port: 0,
            database: database.to_string_lossy().into_owned(),
            username: String::new(),
            sslmode: "disable".into(),
            extra_params: HashMap::new(),
            readonly_default: true,
            allow_writes: false,
            secret_ref: None,
            env: Some(if index % 5 == 0 { "staging" } else { "dev" }.into()),
            schema_group: None,
            workspace_access: WorkspaceConnectionAccess::Local,
            credential_mode: WorkspaceCredentialMode::Local,
            provider_target: None,
            schema_access_available: false,
        };
        store.upsert_connection(&profile).await?;
    }
    Ok(())
}

#[cfg(feature = "packaged-benchmark")]
async fn prepare_table_data(_store: &crate::store::Store) -> AppResult<()> {
    const COLUMN_COUNT: usize = 36;
    let database = crate::app_paths::data_root()?.join("fixture-00.sqlite");
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(database)
        .create_if_missing(false);
    let mut connection = sqlx::SqliteConnection::connect_with(&options).await?;
    let metric_columns = (1..COLUMN_COUNT)
        .map(|index| format!("metric_{index} INTEGER NOT NULL"))
        .collect::<Vec<_>>();
    // Every identifier and expression below is generated only from this closed
    // integer range; no environment, fixture path, or user input enters SQL.
    sqlx::query(AssertSqlSafe(format!(
        "CREATE TABLE benchmark_table (id INTEGER PRIMARY KEY, {})",
        metric_columns.join(", ")
    )))
    .execute(&mut connection)
    .await?;
    let insert_columns = (1..COLUMN_COUNT)
        .map(|index| format!("metric_{index}"))
        .collect::<Vec<_>>();
    let metric_values = (1..COLUMN_COUNT)
        .map(|index| format!("(value * {}) % 10000", index + 1))
        .collect::<Vec<_>>();
    sqlx::query(AssertSqlSafe(format!(
        "WITH RECURSIVE rows(value) AS (\
             SELECT 0 UNION ALL SELECT value + 1 FROM rows WHERE value < 100\
         ) INSERT INTO benchmark_table (id, {}) SELECT value, {} FROM rows",
        insert_columns.join(", "),
        metric_values.join(", ")
    )))
    .execute(&mut connection)
    .await?;
    connection.close().await?;
    Ok(())
}

#[cfg(feature = "packaged-benchmark")]
async fn prepare_long_lived_data(store: &crate::store::Store) -> AppResult<()> {
    use sha2::{Digest, Sha256};

    const WORKSPACE_ID: &str = "00000000-0000-0000-0000-000000000001";
    const CONNECTION_ID: &str = "bed00000-0000-0000-0000-000000000001";
    const DOCUMENT_ID: &str = "bed00000-0000-0000-0000-00000000d0c0";
    let mut transaction = store.pool().begin().await?;
    sqlx::query(
        r#"WITH digits(d) AS (VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
           numbers(n) AS (
             SELECT a.d + 10*b.d + 100*c.d + 1000*d.d
             FROM digits a, digits b, digits c, digits d
           )
           INSERT INTO query_history
             (id, connection_id, account_scope, sql, kind, status, row_count,
              duration_ms, error, executed_at, origin)
           SELECT printf('benchmark-history-%05d', n),
                  'bed00000-0000-0000-0000-000000000001', 'personal',
                  printf('SELECT %d /* packaged benchmark */', n), 'read', 'ok', 1,
                  n % 100, NULL, printf('2026-01-01T00:%06dZ', n), 'manual'
           FROM numbers"#,
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"WITH digits(d) AS (VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
           numbers(n) AS (
             SELECT a.d + 10*b.d + 100*c.d + 1000*d.d + 10000*e.d
             FROM digits a, digits b, digits c, digits d, digits e
           )
           INSERT INTO audit_log
             (id, connection_id, ts, engine, agent_prompt, sql, kind, action,
              approved_by, affected_estimate, error, prev_hash, hash)
           SELECT printf('benchmark-audit-%06d', n),
                  'bed00000-0000-0000-0000-000000000001',
                  printf('2026-01-01T01:%06dZ', n), 'sqlite',
                  printf('synthetic prompt %d', n),
                  printf('SELECT %d /* packaged benchmark */', n),
                  'read', 'execute', NULL, 1, NULL,
                  CASE WHEN n = 0 THEN NULL ELSE printf('%064x', n) END,
                  printf('%064x', n + 1)
           FROM numbers"#,
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"INSERT INTO sql_documents
          (id, workspace_id, account_scope, connection_id, title, dialect,
           selected_database, selected_schema, resolve_mode, content, local_revision,
           dirty, sync_status, created_at, updated_at)
         VALUES (?1, ?2, 'personal', ?3, 'Benchmark', 'sqlite', 'benchmark',
                 NULL, 'playground', '', 50, 0, 'local', ?4, ?4)"#,
    )
    .bind(DOCUMENT_ID)
    .bind(WORKSPACE_ID)
    .bind(CONNECTION_ID)
    .bind("2026-01-01T00:00:00Z")
    .execute(&mut *transaction)
    .await?;
    let revision_content = format!("SELECT '{}';", "r".repeat(1024 * 1024 - 10));
    let revision_hash = hex::encode(Sha256::digest(revision_content.as_bytes()));
    for revision in 1_i64..=50 {
        sqlx::query(
            r#"INSERT INTO sql_document_revisions
              (document_id, local_revision, content_hash, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)"#,
        )
        .bind(DOCUMENT_ID)
        .bind(revision)
        .bind(&revision_hash)
        .bind(&revision_content)
        .bind(format!("2026-01-01T00:00:{revision:02}Z"))
        .execute(&mut *transaction)
        .await?;
    }
    for block in 0_i64..8 {
        sqlx::query(
            r#"INSERT INTO analysis_article_local_results
              (workspace_id, account_scope, article_id, article_revision, run_id,
               result_hash, nonce, ciphertext, created_at, expires_at)
             VALUES (?1, 'benchmark-account', ?2, 1, ?3, ?4, zeroblob(24),
                     zeroblob(65536), ?5, '2027-01-01T00:00:00Z')"#,
        )
        .bind(WORKSPACE_ID)
        .bind(format!("bed00000-0000-0000-0000-00000000aa{block:02}"))
        .bind(format!("bed00000-0000-0000-0000-00000000ab{block:02}"))
        .bind(format!("{:064x}", block + 1))
        .bind(format!("2026-01-01T00:01:{block:02}Z"))
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}

#[cfg(feature = "packaged-benchmark")]
async fn prepare_recovery_data(store: &crate::store::Store) -> AppResult<()> {
    use dopedb_protocol::{ObjectKind, ObjectRef};
    use serde_json::json;

    use crate::features::jobs::domain::JobConsistency;
    use crate::features::jobs::{JobFormat, JobPlan};
    use crate::kernel::identity::JobFileCapabilityId;

    const WORKSPACE_ID: &str = "00000000-0000-0000-0000-000000000001";
    const CONNECTION_ID: &str = "bed00000-0000-0000-0000-000000000001";
    const OLD_RUNTIME_ID: &str = "bed00000-0000-0000-0000-00000000f001";
    const READ_OPERATION_ID: &str = "bed00000-0000-0000-0000-000000000a01";
    const EXPORT_OPERATION_ID: &str = "bed00000-0000-0000-0000-000000000a02";
    const JOB_ID: &str = "bed00000-0000-0000-0000-000000000b01";
    const NOW: &str = "2026-01-01T00:00:00Z";

    let export_plan = JobPlan::Export {
        capability_id: JobFileCapabilityId::from(Uuid::from_u128(
            0xbed0_0000_0000_0000_0000_0000_0000_d001,
        )),
        relation: ObjectRef {
            catalog: Some("benchmark".into()),
            namespace: Some("main".into()),
            name: "fixture".into(),
            kind: ObjectKind::Table,
            native_id: None,
        },
        consistency: JobConsistency::PerBatchCurrent,
        columns: Vec::new(),
        field_names: Vec::new(),
        batch_size: 256,
    };
    let plan_value = serde_json::to_value(&export_plan)?;
    let plan_json = serde_json::to_string(&plan_value)?;
    let plan_hash = crate::operations::canonical_hash(&plan_value)?;
    let operation_payloads = [
        (
            READ_OPERATION_ID,
            "read_query",
            "benchmark-read-recovery",
            json!({}),
        ),
        (
            EXPORT_OPERATION_ID,
            "export",
            "benchmark-export-recovery",
            json!({
                "format": JobFormat::Csv,
                "inputInspection": null,
                "jobId": JOB_ID,
                "plan": plan_value,
                "planHash": plan_hash,
                "sourceSha256": null,
                "sqlAudit": null,
            }),
        ),
    ];
    let mut transaction = store.pool().begin().await?;
    for (id, operation_kind, idempotency_key, payload) in operation_payloads {
        let payload_json = crate::operations::canonical_json(&payload)?;
        let payload_hash = crate::operations::canonical_hash(&payload)?;
        sqlx::query(
            r#"INSERT INTO operations
              (id, runtime_id, workspace_id, account_scope, connection_id,
               connection_revision, terminal_session_id, actor_kind, actor_id,
               actor_provenance_json, operation_kind, payload_schema_version,
               payload_json, payload_hash, schema_fingerprint, risk_level, preview_json,
               policy_snapshot_json, policy_revision, state, single_use, idempotency_key,
               expires_at, started_at, finished_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'personal', ?4, 1, NULL, 'system', 'benchmark',
                     '{"originSurface":"benchmark"}', ?5, 1, ?6, ?7, NULL,
                     'low', '{}', '{}', 'benchmark-v1', 'executing', 1, ?8,
                     NULL, ?9, NULL, ?9, ?9)"#,
        )
        .bind(id)
        .bind(OLD_RUNTIME_ID)
        .bind(WORKSPACE_ID)
        .bind(CONNECTION_ID)
        .bind(operation_kind)
        .bind(payload_json)
        .bind(payload_hash)
        .bind(idempotency_key)
        .bind(NOW)
        .execute(&mut *transaction)
        .await?;
    }
    sqlx::query(
        r#"INSERT INTO jobs
          (id, operation_id, workspace_id, account_scope, connection_id, kind, format,
           plan_json, plan_hash, state, source_summary, target_summary, resumable,
           pause_requested, created_at, started_at, updated_at)
         VALUES (?1, ?2, ?3, 'personal', ?4, 'export', 'csv', ?5, ?6,
                 'running', 'synthetic source', 'synthetic target', 0, 0, ?7, ?7, ?7)"#,
    )
    .bind(JOB_ID)
    .bind(EXPORT_OPERATION_ID)
    .bind(WORKSPACE_ID)
    .bind(CONNECTION_ID)
    .bind(plan_json)
    .bind(&plan_hash)
    .bind(NOW)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        r#"INSERT INTO agent_acp_sessions
          (id, connection_id, workspace_id, account_scope, provider, title, lifecycle,
           acp_session_id, error, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'personal', 'codex', 'Benchmark recovery', 'running',
                 'benchmark-resume', NULL, ?4, ?4)"#,
    )
    .bind("bed00000-0000-0000-0000-000000000c01")
    .bind(CONNECTION_ID)
    .bind(WORKSPACE_ID)
    .bind(NOW)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}
