// Global consent card with a short explanation and always-visible choices.
import { useState } from "react";

import { Button } from "../../design-system/components/Button";
import { useI18n } from "../../lib/i18n";
import {
  denyProductAnalyticsConsent,
  grantProductAnalyticsConsent,
  useProductAnalyticsSnapshot,
} from "./client";

export function ProductAnalyticsConsentPrompt() {
  const { t } = useI18n();
  const analytics = useProductAnalyticsSnapshot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (
    analytics.availability !== "available" ||
    analytics.consent !== "pending"
  ) {
    return null;
  }

  async function choose(granted: boolean) {
    setBusy(true);
    setError(false);
    const saved = granted
      ? await grantProductAnalyticsConsent()
      : await denyProductAnalyticsConsent();
    if (!saved) setError(true);
    setBusy(false);
  }

  return (
    <section
      aria-labelledby="product-analytics-consent-title"
      className="tw:fixed tw:right-4 tw:bottom-12 tw:z-40 tw:grid tw:grid-rows-[auto_minmax(0,1fr)_auto] tw:max-h-[calc(100dvh-80px)] tw:w-[min(360px,calc(100vw-32px))] tw:gap-3 tw:overflow-hidden tw:rounded-lg tw:border tw:border-border-subtle tw:bg-popover tw:p-4 tw:shadow-popover"
    >
      <h2 id="product-analytics-consent-title" className="tw:m-0 tw:text-base">
        {t("productAnalytics.onboardingTitle")}
      </h2>
      <div className="tw:grid tw:min-h-0 tw:gap-3 tw:overflow-y-auto tw:overscroll-contain">
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("productAnalytics.onboardingBody")}
        </p>
        {error ? (
          <p role="alert" className="tw:m-0 tw:text-xs tw:text-danger">
            {t("productAnalytics.updateFailed")}
          </p>
        ) : null}
      </div>
      <div className="tw:grid tw:grid-cols-2 tw:gap-2">
        <Button size="compact" disabled={busy} onClick={() => void choose(false)}>
          {t("productAnalytics.decline")}
        </Button>
        <Button size="compact" disabled={busy} onClick={() => void choose(true)}>
          {t("productAnalytics.accept")}
        </Button>
      </div>
    </section>
  );
}
