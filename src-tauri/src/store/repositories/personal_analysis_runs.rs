//! Encrypted, device-only manual Article run metadata. Definitions and result
//! rows have separate repositories; no hosted capability is created here.

use super::super::*;
use super::analysis_articles::{decrypt, encrypt};
use crate::features::analysis_articles::AnalysisRunRecord;
use zeroize::Zeroizing;

fn aad(article_id: Uuid, run_id: Uuid) -> Vec<u8> {
    format!(
        "dopedb.personal-analysis-run.v1\0{}\0{article_id}\0{run_id}",
        schema::PERSONAL_WORKSPACE_ID
    )
    .into_bytes()
}

impl Store {
    pub(crate) async fn save_personal_analysis_run(
        &self,
        run: &AnalysisRunRecord,
        creating: bool,
        key: &Zeroizing<[u8; 32]>,
    ) -> AppResult<()> {
        self.require_personal_articles().await?;
        let bytes = serde_json::to_vec(run)?;
        if bytes.len() > 65_520 {
            return Err(AppError::Config(
                "Analysis run metadata is too large".into(),
            ));
        }
        let (nonce, ciphertext) = encrypt(key, &aad(run.article_id, run.id), &bytes)?;
        let mut transaction = self.pool.begin().await?;
        super::personal_analysis_articles::ensure_personal_transaction(&mut transaction).await?;
        let count = if creating {
            sqlx::query("INSERT INTO personal_analysis_article_runs(id, article_id, created_at, nonce, ciphertext) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO NOTHING")
                .bind(run.id.to_string()).bind(run.article_id.to_string()).bind(run.created_at.to_rfc3339()).bind(nonce).bind(ciphertext).execute(&mut *transaction).await?.rows_affected()
        } else {
            sqlx::query("UPDATE personal_analysis_article_runs SET nonce = ?1, ciphertext = ?2 WHERE id = ?3 AND article_id = ?4")
                .bind(nonce).bind(ciphertext).bind(run.id.to_string()).bind(run.article_id.to_string()).execute(&mut *transaction).await?.rows_affected()
        };
        if count != 1 {
            return Err(AppError::Blocked {
                reason: "Analysis run identity was already used or removed".into(),
            });
        }
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn personal_analysis_run(
        &self,
        article_id: Uuid,
        run_id: Uuid,
        key: &Zeroizing<[u8; 32]>,
    ) -> AppResult<AnalysisRunRecord> {
        self.require_personal_articles().await?;
        let row = sqlx::query("SELECT id, nonce, ciphertext FROM personal_analysis_article_runs WHERE id = ?1 AND article_id = ?2")
            .bind(run_id.to_string()).bind(article_id.to_string()).fetch_optional(&self.pool).await?
            .ok_or_else(|| AppError::NotFound("Analysis run".into()))?;
        decode(article_id, &row, key)
    }

    pub(crate) async fn personal_analysis_runs(
        &self,
        article_id: Uuid,
        before: Option<DateTime<Utc>>,
        key: &Zeroizing<[u8; 32]>,
    ) -> AppResult<(Vec<AnalysisRunRecord>, Option<String>)> {
        self.personal_article(article_id, key).await?;
        let rows = sqlx::query("SELECT id, nonce, ciphertext FROM personal_analysis_article_runs WHERE article_id = ?1 AND (?2 IS NULL OR created_at < ?2) ORDER BY created_at DESC, id LIMIT 51")
            .bind(article_id.to_string()).bind(before.map(|time| time.to_rfc3339())).fetch_all(&self.pool).await?;
        let mut runs = rows
            .iter()
            .map(|row| decode(article_id, row, key))
            .collect::<AppResult<Vec<_>>>()?;
        let has_more = runs.len() > 50;
        runs.truncate(50);
        let next = if has_more {
            runs.last().map(|run| run.created_at.to_rfc3339())
        } else {
            None
        };
        Ok((runs, next))
    }
}

fn decode(
    article_id: Uuid,
    row: &sqlx::sqlite::SqliteRow,
    key: &Zeroizing<[u8; 32]>,
) -> AppResult<AnalysisRunRecord> {
    let id = parse_uuid(row.try_get("id")?)?;
    let nonce: Vec<u8> = row.try_get("nonce")?;
    let ciphertext: Vec<u8> = row.try_get("ciphertext")?;
    let run: AnalysisRunRecord =
        serde_json::from_slice(&decrypt(key, &aad(article_id, id), &nonce, &ciphertext)?)?;
    if run.id != id || run.article_id != article_id {
        return Err(AppError::Config("Analysis run authority is invalid".into()));
    }
    Ok(run)
}
