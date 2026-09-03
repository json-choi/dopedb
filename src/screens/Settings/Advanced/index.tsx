import { CheckboxField } from "../../../design-system/components/FormControls";
import { SettingsGroup } from "../../../design-system/components/Settings";
import {
  saveAgentDebugDetails,
  useAgentDebugDetails,
} from "../../../features/agents/displayPreferences";
import { useI18n } from "../../../lib/i18n";

export default function AdvancedSettings() {
  const { t } = useI18n();
  const agentDebugDetails = useAgentDebugDetails();
  return (
    <div className="tw:grid tw:w-full tw:max-w-[800px] tw:gap-4 tw:p-4 tw:@max-[700px]:p-0">
      <div className="tw:grid tw:gap-1">
        <h2 className="tw:m-0">{t("settings.advanced")}</h2>
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {t("settings.advancedBody")}
        </p>
      </div>

      <SettingsGroup title={t("settings.debugging")}>
        <div className="tw:grid tw:min-w-0 tw:gap-1 tw:py-2">
          <CheckboxField
            checked={agentDebugDetails}
            onChange={(event) => saveAgentDebugDetails(event.target.checked)}
            label={t("settings.agentDebugDetails")}
          />
          <p className="tw:m-0 tw:pl-6 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {t("settings.agentDebugDetailsBody")}
          </p>
        </div>
      </SettingsGroup>
    </div>
  );
}
