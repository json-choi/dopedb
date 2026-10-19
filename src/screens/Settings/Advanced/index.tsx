// Advanced settings: the agent debugging preference and the local diagnostic bundle.
import { SettingsGroup, SettingsPage, SettingsToggleRow } from "../../../design-system/components/Settings";
import {
  saveAgentDebugDetails,
  useAgentDebugDetails,
} from "../../../features/agents/displayPreferences";
import { useI18n } from "../../../lib/i18n";
import DiagnosticBundle from "./DiagnosticBundle";

export default function AdvancedSettings() {
  const { t } = useI18n();
  const agentDebugDetails = useAgentDebugDetails();
  return (
    <SettingsPage>
      <SettingsGroup title={t("settings.debugging")}>
        <SettingsToggleRow
          label={t("settings.agentDebugDetails")}
          description={t("settings.agentDebugDetailsBody")}
          checked={agentDebugDetails}
          onChange={saveAgentDebugDetails}
        />
      </SettingsGroup>
      <DiagnosticBundle />
    </SettingsPage>
  );
}
