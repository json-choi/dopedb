// Presents the compact catalog selector used below the editor breakpoint. It
// keeps the same source commands and Problems entry as the desktop strip.
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { DiagnosticCount } from "../../design-system/components/Diagnostics";
import { SelectInput } from "../../design-system/components/FormControls";
import type {
  ConnectionEditorController,
  ConnectionEditorProps,
} from "../../features/connections/useConnectionEditorController";
import type { ProviderKind } from "../../features/providers/domain";
import { useI18n } from "../../lib/i18n";
import { ConnectionSourceCommands } from "./ConnectionCatalogNavigation";

export function ConnectionCatalogCompactSelector({
  catalog,
  profile,
  dialogs,
  commands,
  onEditConnection,
  onNewConnection,
}: {
  catalog: ConnectionEditorController["catalog"];
  profile: ConnectionEditorController["profile"];
  dialogs: ConnectionEditorController["dialogs"];
  commands: ConnectionEditorController["commands"];
  onEditConnection: ConnectionEditorProps["onEditConnection"];
  onNewConnection: ConnectionEditorProps["onNewConnection"];
}) {
  const { t } = useI18n();
  const { navigation, sources, drivers, clouds } = catalog;
  const { problems } = dialogs;
  const hasProblemErrors = problems.items.some(
    (item) => item.tone === "danger",
  );

  return (
    <div className="tw:hidden tw:shrink-0 tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:bg-card tw:p-2 tw:@max-[760px]:flex">
      {navigation.view === "dataSources" ? (
        <>
          <SelectInput
            value={profile.identity.isNew ? "__new__" : profile.form.id}
            onChange={(event) => {
              const connection = sources.connections.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (connection) onEditConnection(connection);
            }}
            aria-label={t("connections.dataSources")}
          >
            {profile.identity.isNew ? (
              <option value="__new__">{t("connections.new")}</option>
            ) : null}
            {sources.connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name || t("app.unnamed")}
              </option>
            ))}
          </SelectInput>
          <Button
            iconOnly
            size="compact"
            variant="ghost"
            onClick={() => onNewConnection()}
            title={t("connections.new")}
            aria-label={t("connections.new")}
          >
            <Icon name="plus" />
          </Button>
          <ConnectionSourceCommands
            profile={profile}
            dialogs={dialogs}
            commands={commands}
          />
          <Button
            size="xs"
            variant="ghost"
            aria-pressed={problems.open}
            onClick={() => problems.setOpen((open) => !open)}
          >
            <Icon name="alert" />
            {t("connections.problems")}
            <DiagnosticCount
              count={problems.items.length}
              hasErrors={hasProblemErrors}
            />
          </Button>
        </>
      ) : navigation.view === "clouds" ? (
        <SelectInput
          value={clouds.selected}
          onChange={(event) =>
            clouds.select(event.target.value as ProviderKind)
          }
          aria-label={t("connections.clouds")}
        >
          {clouds.providers.map((provider) => (
            <option key={provider.provider} value={provider.provider}>
              {provider.label}
            </option>
          ))}
        </SelectInput>
      ) : (
        <SelectInput
          value={drivers.selected?.id ?? ""}
          disabled={drivers.visible.length === 0}
          onChange={(event) => drivers.select(event.target.value)}
          aria-label={t("connections.drivers")}
        >
          {drivers.visible.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name}
            </option>
          ))}
        </SelectInput>
      )}
    </div>
  );
}
