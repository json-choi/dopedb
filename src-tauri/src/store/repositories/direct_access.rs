//! Local reads and writes for direct shared databases.
//!
//! The control plane owns principals; the local store only needs three things: which
//! cached provisioned templates exist per signed-in account (the worker's candidate
//! list), one template's endpoint without depending on the active workspace, and the
//! member binding's principal name, written only while the principal is ready.

use super::super::*;

impl Store {
    /// Cached provisioned templates joined to the accounts that hold a binding for
    /// them, as `(workspace_id, account_user_id, template)`. Templates carry the
    /// shared endpoint only: no username, secret reference, or member parameters.
    pub(crate) async fn provisioned_templates(
        &self,
    ) -> AppResult<Vec<(Uuid, String, ConnectionProfile)>> {
        let rows = sqlx::query(
            "SELECT c.*, b.account_user_id AS binding_account
             FROM connections c
             JOIN workspace_connection_bindings b ON b.connection_id = c.id
             JOIN workspace_members m
               ON m.workspace_id = c.workspace_id
              AND m.user_id = b.account_user_id AND m.status = 'active'
             WHERE c.credential_mode = 'provisioned'
               AND c.remote_id IS NOT NULL AND c.deleted_at IS NULL
             ORDER BY c.id, b.account_user_id",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                Ok((
                    parse_uuid(row.try_get("workspace_id")?)?,
                    row.try_get("binding_account")?,
                    row_to_connection(row)?,
                ))
            })
            .collect()
    }

    /// One cached provisioned template for an exact workspace and account.
    pub(crate) async fn provisioned_template(
        &self,
        workspace_id: Uuid,
        account_user_id: &str,
        connection_id: Uuid,
    ) -> AppResult<ConnectionProfile> {
        let row = sqlx::query(
            "SELECT c.*
             FROM connections c
             JOIN workspace_connection_bindings b
               ON b.connection_id = c.id AND b.account_user_id = ?3
             WHERE c.id = ?1 AND c.workspace_id = ?2 AND c.remote_id IS NOT NULL
               AND c.credential_mode = 'provisioned' AND c.deleted_at IS NULL",
        )
        .bind(connection_id.to_string())
        .bind(workspace_id.to_string())
        .bind(account_user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("shared connection {connection_id}")))?;
        row_to_connection(&row)
    }

    /// Record the principal name the control plane reports for this member, or clear
    /// it (`None`) when the principal is not ready. Only a ready name opens the
    /// connection; the binding revision changes so pinned sessions retire.
    pub(crate) async fn apply_provisioned_principal(
        &self,
        connection_id: Uuid,
        account_user_id: &str,
        principal_name: Option<&str>,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE workspace_connection_bindings
             SET username = ?3, revision = revision + 1, updated_at = ?4
             WHERE connection_id = ?1 AND account_user_id = ?2 AND username IS NOT ?3
               AND EXISTS (SELECT 1 FROM connections c
                           WHERE c.id = ?1 AND c.credential_mode = 'provisioned')",
        )
        .bind(connection_id.to_string())
        .bind(account_user_id)
        .bind(principal_name.unwrap_or(""))
        .bind(Utc::now())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Bind this member's generated password item (and device-local SSH parameters)
    /// to a provisioned shared database without touching the principal name, and
    /// return the previous password item so the caller can delete it.
    pub(crate) async fn bind_provisioned_secret(
        &self,
        connection_id: Uuid,
        account_user_id: &str,
        extra_params: &HashMap<String, String>,
        secret_ref: &str,
    ) -> AppResult<Option<String>> {
        let previous: Option<Option<String>> = sqlx::query_scalar(
            "SELECT b.secret_ref FROM workspace_connection_bindings b
             JOIN connections c ON c.id = b.connection_id
             JOIN workspace_members m
               ON m.workspace_id = c.workspace_id AND m.user_id = b.account_user_id
              AND m.status = 'active'
             WHERE b.connection_id = ?1 AND b.account_user_id = ?2
               AND c.credential_mode = 'provisioned' AND c.deleted_at IS NULL",
        )
        .bind(connection_id.to_string())
        .bind(account_user_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(previous) = previous else {
            return Err(AppError::NotFound(format!(
                "shared connection {connection_id}"
            )));
        };
        let bind_sql = format!(
            "UPDATE workspace_connection_bindings
             SET extra_params = ?3, secret_ref = ?4, revision = revision + 1, updated_at = ?5,
                 bound_endpoint = (SELECT {TEMPLATE_ENDPOINT_JSON} FROM connections WHERE id = ?1)
             WHERE connection_id = ?1 AND account_user_id = ?2"
        );
        sqlx::query(sqlx::AssertSqlSafe(bind_sql))
            .bind(connection_id.to_string())
            .bind(account_user_id)
            .bind(serde_json::to_string(extra_params)?)
            .bind(secret_ref)
            .bind(Utc::now())
            .execute(&self.pool)
            .await?;
        Ok(previous)
    }
}
