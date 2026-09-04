//! Fresh-install bootstrap for the local app database.
//!
//! DopeDB is still pre-MVP, so local stores from earlier schema experiments are
//! deliberately unsupported. Keeping one current baseline avoids carrying data
//! conversion code into the product and makes a mismatched store fail visibly.

use super::*;

/// First MVP baseline. Earlier development schemas are rejected instead of upgraded.
pub(super) const LOCAL_SCHEMA_BASELINE: i64 = 1;
pub(super) const LOCAL_SCHEMA_APPLICATION_ID: i64 = 0x444f_5045;

pub(super) async fn bootstrap_local_store(pool: &SqlitePool) -> AppResult<bool> {
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    let application_id: i64 = sqlx::query_scalar("PRAGMA application_id")
        .fetch_one(pool)
        .await?;
    if version == LOCAL_SCHEMA_BASELINE && application_id == LOCAL_SCHEMA_APPLICATION_ID {
        return Ok(false);
    }
    if version != 0 || application_id != 0 {
        return Err(AppError::Config(format!(
            "local database schema {version} is not the MVP baseline; remove the development app database and restart"
        )));
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
    Ok(true)
}
