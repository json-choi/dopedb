// Settings entry for the selected connection's profile and actual Project
// environment. Editing and Project commands retain their existing state owners.
import { Button } from "../../design-system/components/Button";
import { SettingsGroup } from "../../design-system/components/Settings";
import { SettingsList, SettingsRow } from "../../design-system/components/SettingsList";
import { InlineNotice, LoadingLabel } from "../../design-system/components/Status";
import type { ConnectionProfile } from "../../features/connections/domain";
import { useConnectionEnvironmentContext } from "../../features/connections/useConnectionEnvironmentContext";
import { useI18n } from "../../lib/i18n";

export default function ConnectionSettings({ connection, onEdit, onOpenProject }: {
  connection: ConnectionProfile;
  onEdit: (connection: ConnectionProfile) => void;
  onOpenProject: (environmentId: string) => void;
}) {
  const { t } = useI18n();
  const context = useConnectionEnvironmentContext(connection.id);
  return <div className="tw:grid tw:gap-4 tw:p-4">
    <SettingsGroup title={t("settings.connectionEnvironment")}><SettingsList>
      <SettingsRow identity={connection.name} details={[connection.host, connection.database].filter(Boolean).join(" / ")} actions={<Button size="compact" onClick={() => onEdit(connection)}>{t("settings.editConnectionEnvironment")}</Button>} />
      <SettingsRow identity={t("connections.environment")} details={context.pending ? <LoadingLabel>{t("app.loading")}</LoadingLabel> : (context.marker ?? (context.bound ? t("common.none") : connection.env ?? t("common.none"))).toUpperCase()} />
      {context.project && context.environment ? <SettingsRow identity={context.project.name} details={context.environment.name} actions={<Button size="compact" onClick={() => onOpenProject(context.environment!.id)}>{t("settings.projectEnvironmentSettings")}</Button>} /> : null}
    </SettingsList></SettingsGroup>
    {context.bound ? <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">{t("connections.projectEnvironmentHint")}</p> : null}
    {context.error ? <InlineNotice tone="danger" icon="alert" role="alert">{t("connections.environmentDatabaseLoadFailed")}</InlineNotice> : null}
  </div>;
}
