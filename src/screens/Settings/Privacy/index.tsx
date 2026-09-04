import { useState } from "react";

import { Button } from "../../../design-system/components/Button";
import { CheckboxField } from "../../../design-system/components/FormControls";
import { SettingsGroup } from "../../../design-system/components/Settings";
import {
  denyProductAnalyticsConsent,
  grantProductAnalyticsConsent,
  useProductAnalyticsSnapshot,
} from "../../../features/productAnalytics/client";
import { openProductAnalyticsPrivacyPolicy } from "../../../features/productAnalytics/privacyPolicy";
import { useI18n } from "../../../lib/i18n";

export default function PrivacySettings() {
  const { t } = useI18n();
  const analytics = useProductAnalyticsSnapshot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function updateConsent(granted: boolean) {
    setBusy(true);
    setError(false);
    const saved = granted
      ? await grantProductAnalyticsConsent()
      : await denyProductAnalyticsConsent();
    if (!saved) setError(true);
    setBusy(false);
  }

  const canChange = analytics.availability === "available" ||
    analytics.consent === "granted";

  return (
    <div className="tw:grid tw:w-full tw:max-w-[800px] tw:gap-4 tw:p-4 tw:@max-[700px]:p-0">
      <div className="tw:grid tw:gap-1">
        <h2 className="tw:m-0">{t("productAnalytics.settingsTitle")}</h2>
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("productAnalytics.settingsBody")}
        </p>
      </div>

      <SettingsGroup title={t("settings.privacy")}>
        <div className="tw:grid tw:min-w-0 tw:gap-1 tw:py-2">
          <CheckboxField
            checked={analytics.consent === "granted"}
            disabled={busy || analytics.availability === "checking" || !canChange}
            onChange={(event) => void updateConsent(event.target.checked)}
            label={t("productAnalytics.settingLabel")}
          />
          <dl className="tw:m-0 tw:ml-6 tw:grid tw:border-t tw:border-border-subtle tw:[&>div]:grid tw:[&>div]:grid-cols-[140px_minmax(0,1fr)] tw:[&>div]:gap-4 tw:[&>div]:border-b tw:[&>div]:border-border-subtle tw:[&>div]:py-3 tw:[&_dd]:m-0 tw:[&_dd]:text-sm tw:[&_dd]:leading-body tw:[&_dd]:text-muted-foreground tw:[&_dt]:text-sm tw:[&_dt]:font-semibold tw:@max-[620px]:[&>div]:grid-cols-1 tw:@max-[620px]:[&>div]:gap-1">
            <div>
              <dt>{t("productAnalytics.notCollectedTitle")}</dt>
              <dd>{t("productAnalytics.description")}</dd>
            </div>
            <div>
              <dt>{t("productAnalytics.sharedFieldsTitle")}</dt>
              <dd>{t("productAnalytics.identityDescription")}</dd>
            </div>
            <div>
              <dt>{t("productAnalytics.transferRetentionTitle")}</dt>
              <dd>{t("productAnalytics.retentionDescription")}</dd>
            </div>
            <div>
              <dt>{t("productAnalytics.revokeTitle")}</dt>
              <dd>{t("productAnalytics.revokeBody")}</dd>
            </div>
          </dl>
          <div className="tw:flex tw:justify-start tw:pl-4 tw:pt-1">
            <Button
              size="compact"
              variant="ghost"
              onClick={() => void openProductAnalyticsPrivacyPolicy()}
            >
              {t("productAnalytics.privacyPolicy")}
            </Button>
          </div>
          {error ? (
            <p
              role="alert"
              className="tw:m-0 tw:pl-6 tw:text-xs tw:leading-body tw:text-danger"
            >
              {t("productAnalytics.updateFailed")}
            </p>
          ) : null}
        </div>
      </SettingsGroup>

      {analytics.availability === "unavailable" ? (
        <SettingsGroup title={t("productAnalytics.disabledTitle")}>
          <p className="tw:m-0 tw:py-2 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {t("productAnalytics.disabledBody")}
          </p>
        </SettingsGroup>
      ) : null}
    </div>
  );
}
