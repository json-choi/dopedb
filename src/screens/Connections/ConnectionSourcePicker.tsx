// Shares source groups and commands between the new-connection catalog and
// the existing editor's explicit add popup; the feature controller owns choices.
import type { RefObject } from "react";
import EngineMark from "../../components/EngineMark";
import { Icon } from "../../components/Icon";
import { TreeSearch } from "../../design-system/components/TreeControls";
import { ToolWindowSearchRow } from "../../design-system/components/ToolWindow";
import { CommandMenu, CommandMenuGroup, CommandMenuItem } from "../../design-system/components/CommandMenu";
import type { ConnectionEditorController, ConnectionEditorProps } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ConnectionSourcePicker({ catalog, nameInputRef, creatingDemo, onCreateDemoDatabase, embedded = false, selected }: {
  catalog: ConnectionEditorController["catalog"];
  embedded?: boolean;
  selected?: { engine: string; provider: string };
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
  const items = (
    <>
      {sources.filteredWarehouseSources.length > 0 ? (
        <CommandMenuGroup title={t("connections.cloudWarehouse")}>
          {sources.filteredWarehouseSources.map((source) => (
            <CommandMenuItem key={source.engine} aria-pressed={selected?.engine === source.engine && selected?.provider === source.provider} leading={<EngineMark engine={source.engine} provider={source.provider} />} trailing={<Icon name="chevronRight" />} description={t("connections.bigQueryConnectionDescription")} onClick={() => selectSource(source)}>
              {source.label}
            </CommandMenuItem>
          ))}
        </CommandMenuGroup>
      ) : null}
      {sources.filteredDatabaseSources.length > 0 ? (
        <CommandMenuGroup
          title={t("connections.database")}
        >
          {sources.filteredDatabaseSources.map((source) => (
            <CommandMenuItem
              key={`${source.engine}-${source.provider}`}
              aria-pressed={selected?.engine === source.engine && selected?.provider === source.provider}
              leading={<EngineMark engine={source.engine} provider={source.provider} />}
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
              aria-pressed={selected?.engine === source.engine && selected?.provider === source.provider}
              leading={<EngineMark engine={source.engine} provider={source.provider} />}
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
                ? t("onboarding.demoStarting")
                : t("onboarding.demoStart")}
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
    </>
  );
  return embedded ? (
    <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col">
      <ToolWindowSearchRow>
        <TreeSearch autoFocus={!selected} value={addMenu.search} placeholder={t("connections.addDataSourceSearchPlaceholder")} clearLabel={t("common.clearSearch")} onChange={addMenu.setSearch} onEscape={() => addMenu.setSearch("")} />
      </ToolWindowSearchRow>
      <nav aria-label={t("connections.addDataSourceMenu")} className="tw:grid tw:min-h-0 tw:content-start tw:gap-3 tw:overflow-y-auto tw:p-2">{items}</nav>
    </div>
  ) : (
    <CommandMenu id="connection-add-menu" placement="center" label={t("connections.addDataSourceMenu")} searchLabel={t("connections.addDataSourceSearchLabel")} searchPlaceholder={t("connections.addDataSourceSearchPlaceholder")} searchValue={addMenu.search} onSearchChange={addMenu.setSearch} returnFocusRef={addMenu.buttonRef} onDismiss={(reason) => { addMenu.setOpen(false); addMenu.setSearch(""); if (reason === "escape" && !addMenu.buttonRef.current) focusName(); }}>
      {items}
    </CommandMenu>
  );
}
