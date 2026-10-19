// Language preference section: the UI language (or follow the system) for this device.
import { Field, SelectInput } from "../../design-system/components/FormControls";
import { SettingsPage } from "../../design-system/components/Settings";
import { useI18n } from "../../lib/i18n";

export default function LanguageSettings() {
  const { langPreference, setLang, t } = useI18n();
  return (
    <SettingsPage>
      <Field label={t("language.label")}>
        <SelectInput
          value={langPreference}
          onChange={(e) => setLang(e.target.value as typeof langPreference)}
        >
          <option value="system">{t("language.system")}</option>
          <option value="ko">{t("language.korean")}</option>
          <option value="en">{t("language.english")}</option>
        </SelectInput>
      </Field>
    </SettingsPage>
  );
}
