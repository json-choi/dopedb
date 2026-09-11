//! Privacy-bounded product analytics transport.
//!
//! The renderer may submit only the closed outcome vocabulary defined in this
//! module. The desktop never accepts free-form analytics properties, raw
//! product identifiers, SQL, prompts, paths, or error messages.

mod adapters;
mod domain;
mod ports;
pub(crate) mod transport;

use crate::error::AppResult;
use crate::store::Store;

use adapters::SqliteProductAnalyticsConsent;
use domain::{ProductAnalyticsConsent, ProductAnalyticsConsentState};
use ports::ProductAnalyticsConsentPort;

#[derive(Clone)]
pub(crate) struct ProductAnalyticsFeature {
    consent: SqliteProductAnalyticsConsent,
}

impl ProductAnalyticsFeature {
    pub(crate) async fn state(&self) -> AppResult<ProductAnalyticsConsentState> {
        self.consent.state().await
    }

    pub(crate) async fn set_consent(
        &self,
        consent: ProductAnalyticsConsent,
    ) -> AppResult<ProductAnalyticsConsentState> {
        self.consent.set_consent(consent).await
    }
}

pub(crate) fn compose(store: Store) -> ProductAnalyticsFeature {
    ProductAnalyticsFeature {
        consent: SqliteProductAnalyticsConsent::new(store),
    }
}

#[cfg(test)]
pub(crate) use domain::assert_product_analytics_contract;

#[cfg(test)]
pub(crate) use adapters::assert_consent_policy_contract;
