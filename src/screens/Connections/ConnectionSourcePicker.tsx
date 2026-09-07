// One source picker serves both wide and compact connection editors.
import type { RefObject } from "react";
import EngineMark from "../../components/EngineMark";
import { Icon } from "../../components/Icon";
import { CommandMenu, CommandMenuGroup, CommandMenuItem } from "../../design-system/components/CommandMenu";
import type { ConnectionEditorController, ConnectionEditorProps } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ConnectionSourcePicker({ catalog, nameInputRef, creatingDemo, onCreateDemoDatabase }: {
  catalog: ConnectionEditorController["catalog"];
  nameInputRef: RefObject<HTMLInputElement | null>;
  creatingDemo: boolean;
  onCreateDemoDatabase: ConnectionEditorProps["onCreateDemoDatabase"];
}) {
  const { t } = useI18n();
  const { sources, addMenu } = catalog;
  const focusName = () => window.requestAnimationFrame(() => nameInputRef.current?.focus({ preventScroll: true }));
  const selectSource: typeof sources.selectAddSource = (source) => {
    sources.selectAddSource(source);
    focusName();
  };
  return (
    <CommandMenu
      id="connection-add-menu"
      placement="center"
      label={t("connections.addDataSourceMenu")}
      searchLabel={t(
        "connections.addDataSourceSearchLabel",
      )}
      searchPlaceholder={t(
        "connections.addDataSourceSearchPlaceholder",
      )}
      searchValue={addMenu.search}
      onSearchChange={addMenu.setSearch}
      returnFocusRef={addMenu.buttonRef}
      onDismiss={(reason) => {
        addMenu.setOpen(false);
        addMenu.setSearch("");
        if (reason === "escape" && !addMenu.buttonRef.current) focusName();
      }}
    >
      {sources.filteredDatabaseSources.length > 0 ? (
        <CommandMenuGroup
          title={t("connections.database")}
        >
          {sources.filteredDatabaseSources.map((source) => (
            <CommandMenuItem
              key={`${source.engine}-${source.provider}`}
              leading={<EngineMark engine={source.engine} />}
              trailing={<Icon name="chevronRight" />}
              description={sources.sourceDriverDescription(
                source,
              )}
              onClick={() => selectSource(source)}
            >
              {source.label}
            </CommandMenuItem>
          ))}
        </CommandMenuGroup>
      ) : null}
      {sources.filteredFileSources.length > 0 ||
      addMenu.demoMatches ? (
        <CommandMenuGroup
          title={t("connections.fileAndSample")}
        >
          {sources.filteredFileSources.map((source) => (
            <CommandMenuItem
              key={`${source.engine}-${source.provider}`}
              leading={<EngineMark engine={source.engine} />}
              trailing={<Icon name="chevronRight" />}
              description={sources.sourceDriverDescription(
                source,
              )}
              onClick={() => selectSource(source)}
            >
              {source.label}
            </CommandMenuItem>
          ))}
          {addMenu.demoMatches ? (
            <CommandMenuItem
              leading={<EngineMark engine="sqlite" />}
              trailing={<Icon name="download" />}
              description={t("connections.demoDescription")}
              disabled={creatingDemo}
              onClick={() => {
                addMenu.setOpen(false);
                addMenu.setSearch("");
                onCreateDemoDatabase();
              }}
            >
              {creatingDemo
                ? t("connections.demoCreating")
                : t("connections.demoSqlite")}
            </CommandMenuItem>
          ) : null}
        </CommandMenuGroup>
      ) : null}
      {addMenu.filteredCloudProviders.length > 0 ? (
        <CommandMenuGroup
          title={t(
            "connections.dataSourceFromCloudProvider",
          )}
        >
          {addMenu.filteredCloudProviders.map((provider) => (
            <CommandMenuItem
              key={provider.provider}
              leading={<Icon name="key" />}
              trailing={<Icon name="chevronRight" />}
              description={t(
                "connections.cloudCredentialDescription",
              )}
              onClick={() => {
                addMenu.setOpen(false);
                addMenu.setSearch("");
                addMenu.openProviderCredentials(
                  provider.provider,
                  addMenu.buttonRef.current,
                );
              }}
            >
              {provider.label}
            </CommandMenuItem>
          ))}
        </CommandMenuGroup>
      ) : null}
      {!addMenu.hasResults ? (
        <p className="tw:px-2 tw:py-5 tw:text-center tw:text-sm tw:text-muted-foreground">
          {t("connections.noDataSourceResults")}
        </p>
      ) : null}
    </CommandMenu>
  );
}
