//! Fresh-install bootstrap for the local app database.
//!
//! DopeDB is still pre-MVP, so local stores from earlier schema experiments are
//! deliberately unsupported. Keeping one current baseline avoids carrying data
//! conversion code into the product. Metadata-only, fail-closed cache additions
//! preserve the supported baseline; a mismatched app-owned store is reset by
//! [`Store::open`](super::Store::open) instead of being decoded or upgraded.

use super::*;

/// First MVP baseline. Earlier development schemas are reset instead of upgraded.
pub(super) const LOCAL_SCHEMA_BASELINE: i64 = 1;
pub(super) const LOCAL_SCHEMA_APPLICATION_ID: i64 = 0x444f_5045;

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
    sqlx::query("PRAGMA application_id = 1146048581")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("PRAGMA user_version = 1")
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(LocalStoreBootstrap::Ready { created: true })
}
