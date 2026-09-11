use reqwest::StatusCode;
use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::hosted_control_plane;
use crate::state::AppState;

use super::domain::{ProductAnalyticsBatchV1, ProductAnalyticsConsent};

const PRODUCT_ANALYTICS_ROUTE: &str = "/api/v1/product-analytics/events";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAnalyticsStatus {
    enabled: bool,
    consent: ProductAnalyticsConsent,
    generation: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductAnalyticsSubmitReceipt {
    accepted: bool,
    retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
}

fn enabled() -> bool {
    matches!(option_env!("DOPEDB_PRODUCT_ANALYTICS_ENABLED"), Some("1"))
        && !cfg!(feature = "packaged-benchmark")
}

fn response_is_retryable(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_EARLY | StatusCode::TOO_MANY_REQUESTS
    ) || status.is_server_error()
}

#[cfg(test)]
pub(crate) fn assert_product_analytics_response_contract() {
    assert!(response_is_retryable(StatusCode::BAD_GATEWAY));
    assert!(response_is_retryable(StatusCode::SERVICE_UNAVAILABLE));
    assert!(response_is_retryable(StatusCode::REQUEST_TIMEOUT));
    assert!(response_is_retryable(StatusCode::TOO_EARLY));
    assert!(!response_is_retryable(StatusCode::UNPROCESSABLE_ENTITY));
}

#[tauri::command]
pub async fn product_analytics_status(
    state: State<'_, AppState>,
) -> AppResult<ProductAnalyticsStatus> {
    let analytics = state.services.product_analytics.state().await?;
    Ok(ProductAnalyticsStatus {
        enabled: enabled(),
        consent: analytics.consent,
        generation: analytics.generation,
    })
}

#[tauri::command]
pub async fn set_product_analytics_consent(
    state: State<'_, AppState>,
    consent: ProductAnalyticsConsent,
) -> AppResult<ProductAnalyticsStatus> {
    let analytics = state
        .services
        .product_analytics
        .set_consent(consent)
        .await?;
    Ok(ProductAnalyticsStatus {
        enabled: enabled(),
        consent: analytics.consent,
        generation: analytics.generation,
    })
}

#[tauri::command]
pub async fn submit_product_analytics_batch(
    state: State<'_, AppState>,
    batch: ProductAnalyticsBatchV1,
) -> AppResult<ProductAnalyticsSubmitReceipt> {
    if !enabled() {
        return Ok(ProductAnalyticsSubmitReceipt {
            accepted: false,
            retryable: false,
            retry_after_ms: None,
        });
    }
    let consent = state.services.product_analytics.state().await?;
    if !batch.authorized_by(consent) {
        return Err(AppError::Blocked {
            reason: "product analytics consent generation is not current".into(),
        });
    }
    batch
        .validate(chrono::Utc::now())
        .map_err(|reason| AppError::Blocked {
            reason: reason.to_string(),
        })?;

    let endpoint = format!(
        "{}{}",
        hosted_control_plane::origin()?,
        PRODUCT_ANALYTICS_ROUTE
    );
    let response = hosted_control_plane::client()?
        .post(endpoint)
        .header("x-dopedb-product-analytics-contract", "2")
        .json(&batch)
        .send()
        .await
        .map_err(|error| {
            hosted_control_plane::request_error("submitting product analytics", error)
        })?;

    let status = response.status();
    if status != StatusCode::ACCEPTED {
        let retry_after_ms = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|seconds| *seconds > 0)
            .and_then(|seconds| seconds.checked_mul(1_000))
            .map(|milliseconds| milliseconds.min(15 * 60 * 1_000));
        // Every 5xx remains retryable because an intermediary can synthesize
        // it without the Cloud route's closed receipt. The first-party route
        // uses 422 for a deliberate permanent vendor rejection.
        let retryable = response_is_retryable(status);
        return Ok(ProductAnalyticsSubmitReceipt {
            accepted: false,
            retryable,
            retry_after_ms: if retryable { retry_after_ms } else { None },
        });
    }
    Ok(ProductAnalyticsSubmitReceipt {
        accepted: true,
        retryable: false,
        retry_after_ms: None,
    })
}
