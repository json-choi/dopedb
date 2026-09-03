//! Device-local identity for the possession-bound manual Analysis run capability.
//! The value is not a database credential and never authorizes background work.

use super::super::*;

impl Store {
    fn analysis_run_device_key(account_user_id: &str, workspace_id: Uuid) -> AppResult<String> {
        let account_user_id = Uuid::parse_str(account_user_id)
            .map_err(|_| AppError::Config("workspace account id is invalid".into()))?;
        Ok(format!(
            "analysis_runner_capability_device_id_v1:{account_user_id}:{workspace_id}"
        ))
    }

    pub(crate) async fn analysis_run_device_id(
        &self,
        account_user_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<Uuid> {
        let key = Self::analysis_run_device_key(account_user_id, workspace_id)?;
        let generated = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO app_settings (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO NOTHING",
        )
        .bind(&key)
        .bind(generated.to_string())
        .execute(&self.pool)
        .await?;
        let value: String = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = ?1")
            .bind(key)
            .fetch_one(&self.pool)
            .await?;
        Uuid::parse_str(&value)
            .map_err(|_| AppError::Config("stored Analysis run device id is invalid".into()))
    }

    pub(crate) async fn replace_analysis_run_device_id(
        &self,
        account_user_id: &str,
        workspace_id: Uuid,
    ) -> AppResult<Uuid> {
        let key = Self::analysis_run_device_key(account_user_id, workspace_id)?;
        let device_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO app_settings (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(device_id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(device_id)
    }
}
