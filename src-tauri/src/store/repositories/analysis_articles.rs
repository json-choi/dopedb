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

    /// Returns the newest retained result that still decrypts and matches its exact
    /// authority. One corrupt or foreign entry is skipped rather than hiding the
    /// older valid results retained for the same Article.
    pub(crate) async fn load_analysis_article_local_result(
        &self,
        article_id: Uuid,
        run_id: Option<Uuid>,
    ) -> AppResult<Option<AnalysisDefinitionRunReceipt>> {
        let scope = self.active_resource_scope().await?;
        let account_scope = scope.account_scope.storage_key().to_owned();
        let rows = sqlx::query(
            "SELECT article_revision, run_id, result_hash, nonce, ciphertext
             FROM analysis_article_local_results
             WHERE workspace_id = ?1 AND account_scope = ?2 AND article_id = ?3
               AND expires_at > ?4 AND (?5 IS NULL OR run_id = ?5)
             ORDER BY created_at DESC LIMIT ?6",
        )
        .bind(scope.workspace_id.to_string())
        .bind(&account_scope)
        .bind(article_id.to_string())
        .bind(Utc::now().to_rfc3339())
        .bind(run_id.map(|id| id.to_string()))
        .bind(MAX_RESULTS_PER_ARTICLE)
        .fetch_all(&self.pool)
        .await?;
        if rows.is_empty() {
            return Ok(None);
        }
        let key =
            tokio::task::spawn_blocking(crate::connection::keychain::analysis_result_cache_key)
                .await
                .map_err(|_| AppError::Config("Analysis result key task stopped".into()))??;
        for row in rows {
            match decode_local_result(&key, scope.workspace_id, &account_scope, article_id, &row) {
                Ok(receipt) => return Ok(Some(receipt)),
                Err(error) => tracing::warn!(
                    error_kind = error.kind(),
                    %article_id,
                    "Analysis Article local result entry skipped"
                ),
            }
        }
        Ok(None)
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

fn decode_local_result(
    key: &Zeroizing<[u8; 32]>,
    workspace_id: Uuid,
    account_scope: &str,
    article_id: Uuid,
    row: &sqlx::sqlite::SqliteRow,
) -> AppResult<AnalysisDefinitionRunReceipt> {
    let article_revision: i64 = row.try_get("article_revision")?;
    let stored_run_id = parse_uuid(row.try_get("run_id")?)?;
    let result_hash: String = row.try_get("result_hash")?;
    let nonce: Vec<u8> = row.try_get("nonce")?;
    let ciphertext: Vec<u8> = row.try_get("ciphertext")?;
    let aad = cache_aad(
        workspace_id,
        account_scope,
        article_id,
        article_revision,
        stored_run_id,
        &result_hash,
    );
    let plaintext = decrypt(key, &aad, &nonce, &ciphertext)?;
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
    Ok(receipt)
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

pub(super) fn encrypt(
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

pub(super) fn decrypt(
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

    #[tokio::test]
    async fn encrypted_cache_round_trips_only_with_exact_authority() {
        let aad = b"workspace\0account\0article\0revision\0run\0hash";
        let plaintext = br#"{"result":"privacy-minimized"}"#;
        let key = key();
        let (nonce, ciphertext) = encrypt(&key, aad, plaintext).unwrap();
        assert_ne!(ciphertext, plaintext);
        assert_eq!(decrypt(&key, aad, &nonce, &ciphertext).unwrap(), plaintext);
        assert!(decrypt(&key, b"different-account", &nonce, &ciphertext).is_err());
        super::super::personal_analysis_articles::assert_personal_article_contract().await;
        assert_local_result_is_bound_to_exact_authority(&key).await;
    }

    fn receipt(article_id: Uuid, article_revision: i64, run_id: Uuid) -> serde_json::Value {
        serde_json::json!({
            "runId": run_id,
            "articleId": article_id,
            "articleRevision": article_revision,
            "queryReceipts": [],
            "result": {"columns": [], "rows": [], "truncated": false},
            "resultHash": "result-hash",
            "startedAt": "2026-07-24T00:00:00Z",
            "finishedAt": "2026-07-24T00:00:01Z",
        })
    }

    struct StoredResult {
        article_revision: i64,
        run_id: Uuid,
        result_hash: &'static str,
        nonce: Vec<u8>,
        ciphertext: Vec<u8>,
    }

    async fn stored_row(pool: &SqlitePool, stored: &StoredResult) -> sqlx::sqlite::SqliteRow {
        sqlx::query(
            "SELECT ?1 AS article_revision, ?2 AS run_id, ?3 AS result_hash,
                    ?4 AS nonce, ?5 AS ciphertext",
        )
        .bind(stored.article_revision)
        .bind(stored.run_id.to_string())
        .bind(stored.result_hash)
        .bind(&stored.nonce)
        .bind(&stored.ciphertext)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// A cached result decodes only under the workspace, account partition,
    /// Article, revision, run, and result hash it was sealed for, and its
    /// plaintext must repeat that same authority.
    async fn assert_local_result_is_bound_to_exact_authority(key: &Zeroizing<[u8; 32]>) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let workspace_id = Uuid::new_v4();
        let article_id = Uuid::new_v4();
        let run_id = Uuid::new_v4();
        let seal = |plaintext: &serde_json::Value, revision: i64, run_id: Uuid, hash: &str| {
            let aad = cache_aad(workspace_id, "personal", article_id, revision, run_id, hash);
            encrypt(key, &aad, &serde_json::to_vec(plaintext).unwrap()).unwrap()
        };
        let (nonce, ciphertext) = seal(&receipt(article_id, 2, run_id), 2, run_id, "result-hash");
        let exact = StoredResult {
            article_revision: 2,
            run_id,
            result_hash: "result-hash",
            nonce,
            ciphertext,
        };
        let row = stored_row(&pool, &exact).await;
        let decoded = decode_local_result(key, workspace_id, "personal", article_id, &row).unwrap();
        assert_eq!(
            (decoded.article_id, decoded.article_revision, decoded.run_id),
            (article_id, 2, run_id)
        );
        assert_eq!(decoded.result_hash, "result-hash");

        let foreign_authorities = [
            ("another workspace", Uuid::new_v4(), "personal", article_id),
            (
                "another account partition",
                workspace_id,
                "team:other",
                article_id,
            ),
            ("another Article", workspace_id, "personal", Uuid::new_v4()),
        ];
        for (label, workspace, account, article) in foreign_authorities {
            assert!(
                decode_local_result(key, workspace, account, article, &row).is_err(),
                "{label} must not decrypt the entry"
            );
        }
        assert!(
            decode_local_result(
                &Zeroizing::new([9; 32]),
                workspace_id,
                "personal",
                article_id,
                &row
            )
            .is_err(),
            "another device key must not decrypt the entry"
        );

        // Rewriting the stored authority columns breaks the AAD binding.
        let rewritten = [
            StoredResult {
                article_revision: 3,
                ..clone_stored(&exact)
            },
            StoredResult {
                run_id: Uuid::new_v4(),
                ..clone_stored(&exact)
            },
            StoredResult {
                result_hash: "other-hash",
                ..clone_stored(&exact)
            },
        ];
        for stored in rewritten {
            let row = stored_row(&pool, &stored).await;
            assert!(decode_local_result(key, workspace_id, "personal", article_id, &row).is_err());
        }

        // A correctly sealed plaintext that names different authority is refused.
        let other_run = Uuid::new_v4();
        let mut wrong_hash = receipt(article_id, 2, run_id);
        wrong_hash["resultHash"] = "other-hash".into();
        let mismatched = [
            ("another Article", receipt(Uuid::new_v4(), 2, run_id)),
            ("another revision", receipt(article_id, 5, run_id)),
            ("another run", receipt(article_id, 2, other_run)),
            ("another result hash", wrong_hash),
            ("an unsupported format", serde_json::json!({"rows": []})),
        ];
        for (label, plaintext) in mismatched {
            let (nonce, ciphertext) = seal(&plaintext, 2, run_id, "result-hash");
            let row = stored_row(
                &pool,
                &StoredResult {
                    nonce,
                    ciphertext,
                    ..clone_stored(&exact)
                },
            )
            .await;
            assert!(
                decode_local_result(key, workspace_id, "personal", article_id, &row).is_err(),
                "{label} must be refused"
            );
        }

        // Every authority field is part of the versioned AAD.
        let base = cache_aad(workspace_id, "personal", article_id, 2, run_id, "h");
        assert!(base.starts_with(b"dopedb.analysis-result.v1\0"));
        let variants = [
            cache_aad(Uuid::new_v4(), "personal", article_id, 2, run_id, "h"),
            cache_aad(workspace_id, "team", article_id, 2, run_id, "h"),
            cache_aad(workspace_id, "personal", Uuid::new_v4(), 2, run_id, "h"),
            cache_aad(workspace_id, "personal", article_id, 3, run_id, "h"),
            cache_aad(workspace_id, "personal", article_id, 2, Uuid::new_v4(), "h"),
            cache_aad(workspace_id, "personal", article_id, 2, run_id, "i"),
        ];
        assert!(variants.iter().all(|variant| *variant != base));
        pool.close().await;
    }

    fn clone_stored(stored: &StoredResult) -> StoredResult {
        StoredResult {
            article_revision: stored.article_revision,
            run_id: stored.run_id,
            result_hash: stored.result_hash,
            nonce: stored.nonce.clone(),
            ciphertext: stored.ciphertext.clone(),
        }
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
