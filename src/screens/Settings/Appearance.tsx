// Appearance is device-local and applies immediately to every work surface.
import { Field, SelectInput } from "../../design-system/components/FormControls";
import { setThemePreference, useTheme, type ThemePreference } from "../../design-system/theme";
import { useI18n } from "../../lib/i18n";

export default function Appearance() {
  const { t } = useI18n();
  const { preference } = useTheme();
  return <div className="tw:grid tw:max-w-[560px] tw:gap-5 tw:p-4">
    <div className="tw:grid tw:gap-2">
      <h2 className="tw:m-0 tw:text-heading tw:font-semibold">{t("settings.appearance")}</h2>
      <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">{t("settings.themeBody")}</p>
    </div>
    <Field label={t("settings.theme")}>
      <SelectInput value={preference} onChange={(event) => setThemePreference(event.target.value as ThemePreference)}>
        <option value="system">{t("settings.themeSystem")}</option>
        <option value="light">{t("settings.themeLight")}</option>
        <option value="dark">{t("settings.themeDark")}</option>
      </SelectInput>
    </Field>
  </div>;
}
