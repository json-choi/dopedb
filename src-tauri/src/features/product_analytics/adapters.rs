use crate::error::{AppError, AppResult};
use crate::store::Store;

use super::domain::{ProductAnalyticsConsent, ProductAnalyticsConsentState};
use super::ports::ProductAnalyticsConsentPort;

const CONSENT_KEY: &str = "product_analytics_consent_v1";
const GENERATION_KEY: &str = "product_analytics_consent_generation_v1";
const CHOICE_KEY: &str = "product_analytics_consent_choice_v1";
const WEEK_MS: i64 = 7 * 24 * 60 * 60 * 1_000;

#[derive(serde::Serialize, serde::Deserialize)]
struct ConsentChoice {
    version: String,
    chosen_at_ms: i64,
}

#[derive(Clone)]
pub(super) struct SqliteProductAnalyticsConsent {
    store: Store,
}

impl SqliteProductAnalyticsConsent {
    pub(super) fn new(store: Store) -> Self {
        Self { store }
    }
}

impl ProductAnalyticsConsentPort for SqliteProductAnalyticsConsent {
    async fn state(&self) -> AppResult<ProductAnalyticsConsentState> {
        let mut transaction = self.store.pool().begin().await?;
        let state = load_state(&mut transaction, chrono::Utc::now().timestamp_millis()).await?;
        transaction.commit().await?;
        Ok(state)
    }

    async fn set_consent(
        &self,
        consent: ProductAnalyticsConsent,
    ) -> AppResult<ProductAnalyticsConsentState> {
        let mut transaction = self.store.pool().begin().await?;
        let now = chrono::Utc::now().timestamp_millis();
        let current = load_state(&mut transaction, now).await?;
        let state = ProductAnalyticsConsentState {
            consent,
            generation: if current.consent == consent {
                current.generation
            } else {
                next_generation(current.generation)?
            },
        };
        save_state(&mut transaction, state).await?;
        let choice = serde_json::to_string(&ConsentChoice {
            version: env!("CARGO_PKG_VERSION").into(),
            chosen_at_ms: now,
        })?;
        sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(CHOICE_KEY)
        .bind(choice)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(state)
    }
}

async fn load_state(
    connection: &mut sqlx::SqliteConnection,
    now_ms: i64,
) -> AppResult<ProductAnalyticsConsentState> {
    let (consent, generation, choice): (Option<String>, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT
               MAX(CASE WHEN key = ?1 THEN value END),
               MAX(CASE WHEN key = ?2 THEN value END),
               MAX(CASE WHEN key = ?3 THEN value END)
             FROM app_settings WHERE key IN (?1, ?2, ?3)",
        )
        .bind(CONSENT_KEY)
        .bind(GENERATION_KEY)
        .bind(CHOICE_KEY)
        .fetch_one(&mut *connection)
        .await?;
    let state = stored_state(
        consent.as_deref(),
        generation.as_deref(),
        choice.as_deref(),
        now_ms,
        env!("CARGO_PKG_VERSION"),
    )?;
    if consent.as_deref().unwrap_or("pending") != state.consent.as_str() {
        // Persist expiry once so a restart or clock rollback cannot revive an
        // expired grant. The generation also invalidates queued/in-flight batches.
        save_state(connection, state).await?;
    }
    Ok(state)
}

async fn save_state(
    connection: &mut sqlx::SqliteConnection,
    state: ProductAnalyticsConsentState,
) -> AppResult<()> {
    for (key, value) in [
        (CONSENT_KEY, state.consent.as_str().to_string()),
        (GENERATION_KEY, state.generation.to_string()),
    ] {
        sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&mut *connection)
        .await?;
    }
    Ok(())
}

fn next_generation(generation: u32) -> AppResult<u32> {
    generation
        .checked_add(1)
        .ok_or_else(|| AppError::Config("product analytics consent generation overflow".into()))
}

fn stored_state(
    consent: Option<&str>,
    generation: Option<&str>,
    choice: Option<&str>,
    now_ms: i64,
    app_version: &str,
) -> AppResult<ProductAnalyticsConsentState> {
    let consent = match consent {
        None | Some("pending") => ProductAnalyticsConsent::Pending,
        Some("granted") => ProductAnalyticsConsent::Granted,
        Some("denied") => ProductAnalyticsConsent::Denied,
        Some(_) => {
            return Err(AppError::Config(
                "stored product analytics consent is invalid".into(),
            ))
        }
    };
    let generation = generation
        .unwrap_or("0")
        .parse::<u32>()
        .map_err(|_| AppError::Config("stored product analytics generation is invalid".into()))?;
    let current = choice
        .and_then(|value| serde_json::from_str::<ConsentChoice>(value).ok())
        .is_some_and(|choice| {
            choice.version == app_version
                && now_ms
                    .checked_sub(choice.chosen_at_ms)
                    .is_some_and(|age| (0..WEEK_MS).contains(&age))
        });
    if consent != ProductAnalyticsConsent::Pending && !current {
        return Ok(ProductAnalyticsConsentState {
            consent: ProductAnalyticsConsent::Pending,
            generation: next_generation(generation)?,
        });
    }
    Ok(ProductAnalyticsConsentState {
        consent,
        generation,
    })
}

#[cfg(test)]
pub(crate) fn assert_consent_policy_contract() {
    let chosen_at = 1_800_000_000_000_i64;
    let choice = serde_json::to_string(&ConsentChoice {
        version: "1.2.3".into(),
        chosen_at_ms: chosen_at,
    })
    .unwrap();
    for decision in ["granted", "denied"] {
        let state = |time, version, metadata| {
            stored_state(Some(decision), Some("4"), metadata, time, version).unwrap()
        };
        assert_eq!(
            state(chosen_at, "1.2.3", Some(choice.as_str()))
                .consent
                .as_str(),
            decision
        );
        assert_eq!(
            state(chosen_at + WEEK_MS - 1, "1.2.3", Some(choice.as_str()))
                .consent
                .as_str(),
            decision
        );
        for (time, version, metadata) in [
            (chosen_at + WEEK_MS, "1.2.3", Some(choice.as_str())),
            (chosen_at, "1.2.4", Some(choice.as_str())),
            (chosen_at - 1, "1.2.3", Some(choice.as_str())),
            (chosen_at, "1.2.3", None),
            (chosen_at, "1.2.3", Some("invalid")),
        ] {
            let expired = state(time, version, metadata);
            assert_eq!(expired.consent, ProductAnalyticsConsent::Pending);
            assert_eq!(expired.generation, 5);
        }
    }
    let pending = stored_state(
        Some("pending"),
        Some("5"),
        Some(&choice),
        chosen_at + WEEK_MS,
        "1.2.3",
    )
    .unwrap();
    assert_eq!(pending.generation, 5);
    assert_eq!(pending.consent, ProductAnalyticsConsent::Pending);
}
