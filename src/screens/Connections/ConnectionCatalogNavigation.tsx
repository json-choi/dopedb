// Presents the Connection editor's catalog navigation and source commands.
// Query and mutation ownership stays in the feature controllers.
import ConfirmButton from "../../components/ConfirmButton";
import EngineMark from "../../components/EngineMark";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { DiagnosticCount } from "../../design-system/components/Diagnostics";
import { IconRailTabs } from "../../design-system/components/IconRailTabs";
import { SegmentedControl } from "../../design-system/components/SegmentedControl";
import { TreeSearch } from "../../design-system/components/TreeControls";
import {
  ToolWindowAction,
  ToolWindowSearchRow,
} from "../../design-system/components/ToolWindow";
import { isDemoSqliteConnection } from "../../features/connections/presets";
import type {
  ConnectionEditorController,
  ConnectionEditorProps,
} from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

type Controller = ConnectionEditorController;

export function ConnectionCatalogNavigation({
  catalog,
  profile,
  dialogs,
  commands,
  onEditConnection,
}: {
  catalog: Controller["catalog"];
  profile: Controller["profile"];
  dialogs: Controller["dialogs"];
  commands: Controller["commands"];
  onEditConnection: ConnectionEditorProps["onEditConnection"];
}) {
  const { t } = useI18n();
  const { navigation, sources, addMenu, drivers, clouds } = catalog;
  const { form, identity, flags, url } = profile;
  const { workspace, problems } = dialogs;

  return (
    <>
      <div className="tw:hidden tw:shrink-0 tw:justify-center tw:border-b tw:border-border-subtle tw:bg-card tw:p-2 tw:@max-[760px]:flex">
        <SegmentedControl
          value={navigation.view}
          options={[
            {
              value: "dataSources",
              label: t("connections.dataSources"),
            },
            {
              value: "clouds",
              label: t("connections.clouds"),
            },
            {
              value: "drivers",
              label: t("connections.drivers"),
            },
          ]}
          label={t("connections.dataSourceCatalogNavigation")}
          onChange={navigation.setView}
        />
      </div>
      <aside className="tw:flex tw:w-[292px] tw:shrink-0 tw:overflow-visible tw:border-r tw:border-border-subtle tw:bg-card tw:@max-[760px]:hidden">
        <IconRailTabs
          tabs={[
            {
              id: "dataSources",
              icon: <Icon name="database" />,
              label: t("connections.dataSources"),
            },
            {
              id: "clouds",
              icon: <Icon name="key" />,
              label: t("connections.clouds"),
            },
            {
              id: "drivers",
              icon: <Icon name="gear" />,
              label: t("connections.drivers"),
            },
          ]}
          active={navigation.view}
          onChange={navigation.setView}
          label={t("connections.dataSourceCatalogNavigation")}
        />
        <div className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-visible">
          <div className="tw:flex tw:h-control-lg tw:min-h-control-lg tw:items-center tw:border-b tw:border-border-subtle tw:px-3 tw:text-sm tw:font-semibold tw:text-foreground">
            {navigation.view === "dataSources"
              ? t("connections.dataSources")
              : navigation.view === "clouds"
                ? t("connections.clouds")
                : t("connections.drivers")}
          </div>
          <div className="tw:flex tw:h-control-lg tw:min-h-control-lg tw:items-center tw:border-b tw:border-border-subtle tw:px-3">
            {navigation.view === "dataSources" ? (
              <div className="tw:flex tw:items-center tw:gap-1">
                <div
                  ref={addMenu.anchorRef}
                  className="tw:relative tw:flex"
                >
                  <Button
                    iconOnly
                    size="xs"
                    variant="ghost"
                    onClick={(event) => {
                      addMenu.buttonRef.current = event.currentTarget;
                      addMenu.setSearch("");
                      addMenu.setOpen((open) => !open);
                    }}
                    title={t("common.add")}
                    aria-label={t("common.add")}
                    aria-haspopup="dialog"
                    aria-expanded={addMenu.open}
                    aria-controls="connection-add-menu"
                  >
                    <Icon name="plus" />
                  </Button>

                </div>
                {!identity.isNew && form.workspaceAccess === "local" ? (
                  <>
                    <Button
                      ref={workspace.buttonRef}
                      iconOnly
                      size="xs"
                      variant="ghost"
                      disabled={commands.busy}
                      onClick={() => workspace.setMode("copy")}
                      title={t("workspace.copyToWorkspace")}
                      aria-label={t("workspace.copyToWorkspace")}
                    >
                      <Icon name="upload" />
                    </Button>
                    <Button
                      iconOnly
                      size="xs"
                      variant="ghost"
                      disabled={commands.busy}
                      onClick={commands.duplicate}
                      title={t("connections.duplicate")}
                      aria-label={t("connections.duplicate")}
                    >
                      <Icon name="copy" />
                    </Button>
                    <ConfirmButton
                      disabled={commands.busy}
                      iconOnly
                      label={t("common.delete")}
                      size="xs"
                      variant="ghost"
                      confirmLabel={t(
                        isDemoSqliteConnection(form)
                          ? "connections.reallyDeleteDemo"
                          : "common.reallyDelete",
                      )}
                      onConfirm={() => void commands.remove()}
                    >
                      <Icon name="trash" />
                    </ConfirmButton>
                  </>
                ) : null}
                {!identity.isNew &&
                flags.isSharedTemplate &&
                form.engine !== "bigquery" &&
                form.credentialMode === "memberLocal" &&
                form.workspaceAccess !== "view" ? (
                  <Button
                    ref={workspace.buttonRef}
                    iconOnly
                    size="xs"
                    variant="ghost"
                    disabled={commands.busy}
                    onClick={() => workspace.setMode("credentials")}
                    title={t("workspace.bindCredentialsShort")}
                    aria-label={t("workspace.bindCredentialsShort")}
                  >
                    <Icon name="key" />
                  </Button>
                ) : null}
                {!identity.isNew && form.workspaceAccess === "manage" ? (
                  <ConfirmButton
                    disabled={commands.busy}
                    iconOnly
                    label={t("common.delete")}
                    size="xs"
                    variant="ghost"
                    confirmLabel={t("common.reallyDelete")}
                    onConfirm={() => void commands.remove()}
                  >
                    <Icon name="trash" />
                  </ConfirmButton>
                ) : null}
                {identity.isNew ? (
                  <Button
                    iconOnly
                    size="xs"
                    variant="ghost"
                    disabled={commands.busy}
                    onClick={() => void url.importFromClipboard(true)}
                    title={t("connections.importClipboard")}
                    aria-label={t("connections.importClipboard")}
                  >
                    <Icon name="copy" />
                  </Button>
                ) : null}
                <Button
                  active={navigation.searchOpen}
                  iconOnly
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    navigation.setSearchOpen((open) => !open)
                  }
                  title={t("connections.searchDataSources")}
                  aria-label={t("connections.searchDataSources")}
                  aria-pressed={navigation.searchOpen}
                >
                  <Icon name="search" />
                </Button>
              </div>
            ) : navigation.view === "drivers" ? (
              <div className="tw:flex tw:items-center tw:gap-1">
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  disabled={drivers.fetching}
                  onClick={() => void drivers.refresh()}
                  title={t("common.refresh")}
                  aria-label={t("common.refresh")}
                >
                  <Icon name="refresh" />
                </Button>
                <Button
                  active={navigation.searchOpen}
                  iconOnly
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    navigation.setSearchOpen((open) => !open)
                  }
                  title={t("connections.searchDrivers")}
                  aria-label={t("connections.searchDrivers")}
                  aria-pressed={navigation.searchOpen}
                >
                  <Icon name="search" />
                </Button>
              </div>
            ) : null}
          </div>
          {navigation.view !== "clouds" && navigation.searchOpen ? (
            <ToolWindowSearchRow>
              <TreeSearch
                value={
                  navigation.view === "dataSources"
                    ? sources.search
                    : drivers.search
                }
                autoFocus
                placeholder={t(
                  navigation.view === "dataSources"
                    ? "connections.searchDataSources"
                    : "connections.searchDrivers",
                )}
                clearLabel={t("common.close")}
                onChange={
                  navigation.view === "dataSources"
                    ? sources.setSearch
                    : drivers.setSearch
                }
                onEscape={() => {
                  if (
                    navigation.view === "dataSources" &&
                    sources.search
                  ) {
                    sources.setSearch("");
                  } else if (
                    navigation.view === "drivers" &&
                    drivers.search
                  ) {
                    drivers.setSearch("");
                  } else {
                    navigation.setSearchOpen(false);
                  }
                }}
              />
            </ToolWindowSearchRow>
          ) : null}
          <nav className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:py-2">
            {navigation.view === "dataSources" &&
            sources.visibleConnections.length > 0 ? (
              <div className="tw:grid tw:gap-[2px]">
                {sources.visibleConnections.map((connection) => (
                  <ToolWindowAction
                    key={connection.id}
                    flush
                    leading={
                      <EngineMark engine={connection.engine} size="tree" />
                    }
                    selected={
                      !identity.isNew && connection.id === form.id
                    }
                    onClick={() => onEditConnection(connection)}
                  >
                    {connection.name || t("app.unnamed")}
                  </ToolWindowAction>
                ))}
              </div>
            ) : null}
            {navigation.view === "dataSources" &&
            sources.connections.length > 0 &&
            sources.visibleConnections.length === 0 ? (
              <p className="tw:px-2 tw:py-4 tw:text-center tw:text-sm tw:text-muted-foreground">
                {t("connections.noDataSourceResults")}
              </p>
            ) : null}
            {navigation.view === "drivers" ? (
              drivers.pending ? (
                <p className="tw:px-2 tw:py-4 tw:text-center tw:text-sm tw:text-muted-foreground">
                  {t("connections.driverCatalogLoading")}
                </p>
              ) : drivers.failed ? (
                <p
                  className="tw:px-2 tw:py-4 tw:text-center tw:text-sm tw:text-danger"
                  role="alert"
                >
                  {t("connections.problemDriverCatalogUnavailable")}
                </p>
              ) : drivers.visible.length > 0 ? (
                <div className="tw:grid tw:gap-[2px]">
                  {drivers.visible.map((driver) => (
                    <ToolWindowAction
                      key={driver.id}
                      flush
                      leading={
                        <EngineMark engine={driver.engine} size="tree" />
                      }
                      trailing={
                        driver.installState === "installed" ? (
                          <Icon name="check" />
                        ) : null
                      }
                      selected={drivers.selected?.id === driver.id}
                      onClick={() => drivers.select(driver.id)}
                    >
                      {driver.name}
                    </ToolWindowAction>
                  ))}
                </div>
              ) : (
                <p className="tw:px-2 tw:py-4 tw:text-center tw:text-sm tw:text-muted-foreground">
                  {t("connections.noDriverResults")}
                </p>
              )
            ) : null}
            {navigation.view === "clouds" ? (
              <div className="tw:grid tw:gap-[2px]">
                {clouds.providers.map((provider) => (
                  <ToolWindowAction
                    key={provider.provider}
                    flush
                    leading={<Icon name="key" />}
                    selected={clouds.selected === provider.provider}
                    onClick={() => clouds.select(provider.provider)}
                  >
                    {provider.label}
                  </ToolWindowAction>
                ))}
              </div>
            ) : null}
          </nav>
          {navigation.view === "dataSources" ? (
            <div className="tw:shrink-0 tw:border-t tw:border-border-subtle tw:py-2">
              <ToolWindowAction
                flush
                leading={
                  <span
                    data-danger={
                      problems.items.some(
                        (item) => item.tone === "danger",
                      ) || undefined
                    }
                    className="tw:text-muted-foreground tw:data-[danger=true]:text-danger"
                  >
                    <Icon name="alert" />
                  </span>
                }
                trailing={
                  <DiagnosticCount
                    count={problems.items.length}
                    hasErrors={problems.items.some(
                      (item) => item.tone === "danger",
                    )}
                  />
                }
                selected={problems.open}
                onClick={() => problems.setOpen((open) => !open)}
              >
                {t("connections.problems")}
              </ToolWindowAction>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
