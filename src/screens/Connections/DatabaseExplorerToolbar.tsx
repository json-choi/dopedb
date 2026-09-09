// Toolbar and scoped search controls for the Database Explorer tool window.
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { ToolWindowSearchRow } from "../../design-system/components/ToolWindow";
import { TreeSearch } from "../../design-system/components/TreeControls";
import type { ConnectionProfile } from "../../features/connections/domain";
import { useI18n } from "../../lib/i18n";
import type { CatalogTreeSearchResult } from "./CatalogTree";

interface DatabaseExplorerToolbarProps {
  connections: ConnectionProfile[];
  projectCount: number;
  projectsPending: boolean;
  projectsFetching: boolean;
  sourcesFetching: boolean;
  refreshing: boolean;
  searchOpen: boolean;
  globalFilter: string;
  searchResults: CatalogTreeSearchResult[];
  activeSearchResult: CatalogTreeSearchResult | undefined;
  activeEnvironmentId: string | null;
  activeEnvironmentView: string | null;
  analysisAvailable: boolean;
  analysisFilter: string;
  workspaceHeader?: ReactNode;
  onAddProject: () => void;
  onAddEnvironment: () => void;
  onRefresh: () => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onFilterChange: (value: string) => void;
  onMoveSearchResult: (direction: 1 | -1) => void;
  onOpenSearchResult: (result: CatalogTreeSearchResult) => void;
  onFocusSearchResult: (treeKey: string) => void;
  onAnalysisFilterChange: (value: string) => void;
}

export function DatabaseExplorerToolbar({
  connections,
  projectCount,
  projectsPending,
  projectsFetching,
  sourcesFetching,
  refreshing,
  searchOpen,
  globalFilter,
  searchResults,
  activeSearchResult,
  activeEnvironmentId,
  activeEnvironmentView,
  analysisAvailable,
  analysisFilter,
  workspaceHeader,
  onAddProject,
  onAddEnvironment,
  onRefresh,
  onOpenSearch,
  onCloseSearch,
  onFilterChange,
  onMoveSearchResult,
  onOpenSearchResult,
  onFocusSearchResult,
  onAnalysisFilterChange,
}: DatabaseExplorerToolbarProps) {
  const { t } = useI18n();
  return (
    <>
      {workspaceHeader}
      <div
        className="tw:flex tw:min-h-control-md tw:shrink-0 tw:items-center tw:gap-1 tw:border-y tw:border-border-subtle tw:bg-background tw:px-3 tw:py-1"
        role="toolbar"
        aria-label={t("connections.databaseExplorerActions")}
      >
        <Button
          iconOnly
          size="xs"
          variant="ghost"
          disabled={projectsPending}
          onClick={onAddProject}
          title={t("connections.addProject")}
          aria-label={t("connections.addProject")}
        >
          <Icon name="folderPlus" />
        </Button>
        {activeEnvironmentView !== "analyses" ? <Button
          iconOnly
          size="xs"
          variant="ghost"
          disabled={projectsPending || projectCount === 0}
          onClick={onAddEnvironment}
          title={t("connections.addEnvironment")}
          aria-label={t("connections.addEnvironment")}
        >
          <Icon name="plus" />
        </Button> : null}
        <Button
          iconOnly
          size="xs"
          variant="ghost"
          disabled={projectsFetching || sourcesFetching || refreshing}
          onClick={onRefresh}
          title={t("connections.refreshExplorer")}
          aria-label={t("connections.refreshExplorer")}
        >
          <Icon name="refresh" />
        </Button>
        {activeEnvironmentView !== "analyses" ? <Button
          iconOnly
          size="xs"
          variant="ghost"
          active={searchOpen}
          disabled={connections.length === 0}
          onClick={onOpenSearch}
          title={t("connections.searchLoadedObjects")}
          aria-label={t("connections.searchLoadedObjects")}
          aria-pressed={searchOpen}
        >
          <Icon name="search" />
        </Button> : null}
      </div>

      {activeEnvironmentView !== "analyses" && connections.length > 0 && searchOpen ? (
        <ToolWindowSearchRow>
          <div className="tw:min-w-0 tw:flex-1">
            <TreeSearch
              value={globalFilter}
              placeholder={t("connections.filterLoadedObjectsPlaceholder")}
              clearLabel={t("common.close")}
              onChange={onFilterChange}
              autoFocus
              onEscape={() => {
                if (globalFilter) onFilterChange("");
                else onCloseSearch();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  onMoveSearchResult(1);
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  onMoveSearchResult(-1);
                }
                if (event.key === "Enter" && activeSearchResult) {
                  event.preventDefault();
                  if (activeSearchResult.kind === "relation") {
                    onOpenSearchResult(activeSearchResult);
                  } else {
                    onFocusSearchResult(activeSearchResult.treeKey);
                  }
                }
              }}
            />
          </div>
          {globalFilter ? (
            <span
              className="tw:shrink-0 tw:px-1 tw:text-2xs tw:text-muted-foreground"
              aria-live="polite"
            >
              {t("connections.filterResultCount", {
                count: searchResults.length,
              })}
            </span>
          ) : null}
        </ToolWindowSearchRow>
      ) : activeEnvironmentId &&
        activeEnvironmentView === "analyses" &&
        analysisAvailable ? (
        <ToolWindowSearchRow>
          <div className="tw:min-w-0 tw:flex-1">
            <TreeSearch
              value={analysisFilter}
              placeholder={t("analysis.filterPlaceholder")}
              clearLabel={t("common.close")}
              onChange={onAnalysisFilterChange}
              onEscape={() => onAnalysisFilterChange("")}
            />
          </div>
        </ToolWindowSearchRow>
      ) : null}
    </>
  );
}
