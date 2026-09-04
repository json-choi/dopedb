//! Encrypted local recovery cache for privacy-minimized Analysis Article results.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use super::super::*;
use crate::features::analysis_articles::AnalysisDefinitionRunReceipt;

const MAX_CACHE_PLAINTEXT_BYTES: usize = 16 * 1024 * 1024;
const MAX_RESULTS_PER_ARTICLE: i64 = 5;

impl Store {
    pub(crate) async fn save_analysis_article_local_result(
        &self,
        workspace_id: Uuid,
        receipt: &AnalysisDefinitionRunReceipt,
        retention_days: u16,
    ) -> AppResult<()> {
        let scope = self.active_resource_scope().await?;
        if scope.workspace_id != workspace_id {
            return Err(AppError::Blocked {
                reason: "Analysis Article result scope changed before local recovery save".into(),
            });
        }
        let account_scope = scope.account_scope.storage_key().to_owned();
        let plaintext = serde_json::to_vec(receipt)?;
        if plaintext.len() > MAX_CACHE_PLAINTEXT_BYTES {
            return Err(AppError::Blocked {
                reason: "Analysis Article result exceeds the local recovery cache limit".into(),
            });
        }
        let aad = cache_aad(
            workspace_id,
            &account_scope,
            receipt.article_id,
            receipt.article_revision,
            receipt.run_id,
            &receipt.result_hash,
        );
        let key =
            tokio::task::spawn_blocking(crate::connection::keychain::analysis_result_cache_key)
                .await
                .map_err(|_| AppError::Config("Analysis result key task stopped".into()))??;
        let (nonce, ciphertext) = encrypt(&key, &aad, &plaintext)?;
        let created_at = receipt.finished_at;
        let expires_at =
            created_at + chrono::Duration::days(i64::from(retention_days.clamp(1, 365)));
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO analysis_article_local_results (
                workspace_id, account_scope, article_id, article_revision, run_id,
                result_hash, nonce, ciphertext, created_at, expires_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(workspace_id, account_scope, article_id, run_id) DO UPDATE SET
                article_revision = excluded.article_revision,
                result_hash = excluded.result_hash,
                nonce = excluded.nonce,
                ciphertext = excluded.ciphertext,
                created_at = excluded.created_at,
                expires_at = excluded.expires_at",
        )
        .bind(workspace_id.to_string())
        .bind(&account_scope)
        .bind(receipt.article_id.to_string())
        .bind(receipt.article_revision)
        .bind(receipt.run_id.to_string())
        .bind(&receipt.result_hash)
        .bind(nonce)
        .bind(ciphertext)
        .bind(created_at.to_rfc3339())
        .bind(expires_at.to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM analysis_article_local_results WHERE expires_at <= ?1")
            .bind(Utc::now().to_rfc3339())
            .execute(&mut *transaction)
            .await?;
        sqlx::query(
            "DELETE FROM analysis_article_local_results
             WHERE workspace_id = ?1 AND account_scope = ?2 AND article_id = ?3
               AND run_id NOT IN (
                 SELECT run_id FROM analysis_article_local_results
                 WHERE workspace_id = ?1 AND account_scope = ?2 AND article_id = ?3
                 ORDER BY created_at DESC LIMIT ?4
               )",
        )
        .bind(workspace_id.to_string())
        .bind(&account_scope)
        .bind(receipt.article_id.to_string())
        .bind(MAX_RESULTS_PER_ARTICLE)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn load_analysis_article_local_result(
        &self,
        article_id: Uuid,
        run_id: Option<Uuid>,
    ) -> AppResult<Option<AnalysisDefinitionRunReceipt>> {
        let scope = self.active_resource_scope().await?;
        let account_scope = scope.account_scope.storage_key().to_owned();
        let row = sqlx::query(
            "SELECT article_revision, run_id, result_hash, nonce, ciphertext
             FROM analysis_article_local_results
             WHERE workspace_id = ?1 AND account_scope = ?2 AND article_id = ?3
               AND expires_at > ?4 AND (?5 IS NULL OR run_id = ?5)
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(scope.workspace_id.to_string())
        .bind(&account_scope)
        .bind(article_id.to_string())
        .bind(Utc::now().to_rfc3339())
        .bind(run_id.map(|id| id.to_string()))
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let article_revision: i64 = row.try_get("article_revision")?;
        let stored_run_id = parse_uuid(row.try_get("run_id")?)?;
        let result_hash: String = row.try_get("result_hash")?;
        let nonce: Vec<u8> = row.try_get("nonce")?;
        let ciphertext: Vec<u8> = row.try_get("ciphertext")?;
        let aad = cache_aad(
            scope.workspace_id,
            &account_scope,
            article_id,
            article_revision,
            stored_run_id,
            &result_hash,
        );
        let key =
            tokio::task::spawn_blocking(crate::connection::keychain::analysis_result_cache_key)
                .await
                .map_err(|_| AppError::Config("Analysis result key task stopped".into()))??;
        let plaintext = decrypt(&key, &aad, &nonce, &ciphertext)?;
        let receipt = crate::features::analysis_articles::deserialize_local_result(&plaintext)?;
        if receipt.article_id != article_id
            || receipt.article_revision != article_revision
            || receipt.run_id != stored_run_id
            || receipt.result_hash != result_hash
        {
            return Err(AppError::Config(
                "Analysis Article local result authority is invalid".into(),
            ));
        }
        Ok(Some(receipt))
    }

    pub(crate) async fn delete_analysis_article_local_results(
        &self,
        article_id: Uuid,
    ) -> AppResult<()> {
        let scope = self.active_resource_scope().await?;
        sqlx::query(
            "DELETE FROM analysis_article_local_results
             WHERE workspace_id = ?1 AND account_scope = ?2 AND article_id = ?3",
        )
        .bind(scope.workspace_id.to_string())
        .bind(scope.account_scope.storage_key())
        .bind(article_id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

fn cache_aad(
    workspace_id: Uuid,
    account_scope: &str,
    article_id: Uuid,
    article_revision: i64,
    run_id: Uuid,
    result_hash: &str,
) -> Vec<u8> {
    format!(
        "dopedb.analysis-result.v1\0{workspace_id}\0{account_scope}\0{article_id}\0{article_revision}\0{run_id}\0{result_hash}"
    )
    .into_bytes()
}

fn encrypt(
    key: &Zeroizing<[u8; 32]>,
    aad: &[u8],
    plaintext: &[u8],
) -> AppResult<(Vec<u8>, Vec<u8>)> {
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|_| AppError::Config("Analysis result cache key is invalid".into()))?;
    let mut nonce = vec![0_u8; 24];
    getrandom::fill(&mut nonce)
        .map_err(|_| AppError::Config("operating system random source is unavailable".into()))?;
    let nonce_array = XNonce::try_from(nonce.as_slice())
        .map_err(|_| AppError::Config("Analysis result nonce is invalid".into()))?;
    let ciphertext = cipher
        .encrypt(
            &nonce_array,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| AppError::Config("Analysis result encryption failed".into()))?;
    Ok((nonce, ciphertext))
}

fn decrypt(
    key: &Zeroizing<[u8; 32]>,
    aad: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
) -> AppResult<Vec<u8>> {
    if nonce.len() != 24 || ciphertext.len() <= 16 || ciphertext.len() > 17_825_792 {
        return Err(AppError::Config(
            "Analysis Article local result envelope is invalid".into(),
        ));
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|_| AppError::Config("Analysis result cache key is invalid".into()))?;
    let nonce = XNonce::try_from(nonce).map_err(|_| {
        AppError::Config("Analysis Article local result envelope is invalid".into())
    })?;
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| AppError::Config("Analysis result cache integrity check failed".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn random_bytes<const N: usize>() -> [u8; N] {
        let mut bytes = [0_u8; N];
        getrandom::fill(&mut bytes).unwrap();
        bytes
    }

    fn key() -> Zeroizing<[u8; 32]> {
        Zeroizing::new(random_bytes())
    }

    #[test]
    fn encrypted_cache_round_trips_only_with_exact_authority() {
        let aad = b"workspace\0account\0article\0revision\0run\0hash";
        let plaintext = br#"{"result":"privacy-minimized"}"#;
        let key = key();
        let (nonce, ciphertext) = encrypt(&key, aad, plaintext).unwrap();
        assert_ne!(ciphertext, plaintext);
        assert_eq!(decrypt(&key, aad, &nonce, &ciphertext).unwrap(), plaintext);
        assert!(decrypt(&key, b"different-account", &nonce, &ciphertext).is_err());
    }

    #[test]
    fn encrypted_cache_rejects_tampering() {
        let aad = b"exact-authority";
        let key = key();
        let (nonce, mut ciphertext) = encrypt(&key, aad, b"bounded result").unwrap();
        ciphertext[0] ^= 0x01;
        assert!(decrypt(&key, aad, &nonce, &ciphertext).is_err());
    }

    #[test]
    fn encrypted_cache_rejects_invalid_envelopes() {
        let key = key();
        let short_nonce = random_bytes::<23>();
        let valid_nonce = random_bytes::<24>();
        let invalid_ciphertext = random_bytes::<16>();
        assert!(decrypt(&key, b"authority", &short_nonce, &invalid_ciphertext).is_err());
        assert!(decrypt(&key, b"authority", &valid_nonce, &invalid_ciphertext).is_err());
    }
}
