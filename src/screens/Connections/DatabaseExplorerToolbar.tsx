// Toolbar and scoped search controls for the Database Explorer tool window.
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import ToolbarMenu, { ToolbarMenuItem } from "../../components/ToolbarMenu";
import { Button } from "../../design-system/components/Button";
import {
  ToolWindowHideButton,
  ToolWindowSearchRow,
} from "../../design-system/components/ToolWindow";
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
  selectedTableKey: string | null;
  showRowCounts: boolean;
  hasExpandedItems: boolean;
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
  onRevealEditorObject: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleRowCounts: () => void;
  onAnalysisFilterChange: (value: string) => void;
  onClose: () => void;
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
  selectedTableKey,
  showRowCounts,
  hasExpandedItems,
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
  onRevealEditorObject,
  onExpandAll,
  onCollapseAll,
  onToggleRowCounts,
  onAnalysisFilterChange,
  onClose,
}: DatabaseExplorerToolbarProps) {
  const { t } = useI18n();
  return (
    <>
      <div
        className="tw:group tw:flex tw:min-h-control-md tw:shrink-0 tw:items-center tw:gap-[2px] tw:border-b tw:border-border-subtle tw:bg-background tw:px-1"
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
        <Button
          iconOnly
          size="xs"
          variant="ghost"
          disabled={projectsPending || projectCount === 0}
          onClick={onAddEnvironment}
          title={t("connections.addEnvironment")}
          aria-label={t("connections.addEnvironment")}
        >
          <Icon name="plus" />
        </Button>
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
        <Button
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
        </Button>
        <ToolbarMenu icon="view" label={t("connections.viewOptions")}>
          <ToolbarMenuItem
            icon="target"
            disabled={!selectedTableKey}
            onClick={onRevealEditorObject}
          >
            {t("connections.scrollFromEditor")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="chevronsRight"
            disabled={connections.length === 0 && projectCount === 0}
            onClick={onExpandAll}
          >
            {t("connections.expandAll")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="chevronsLeft"
            disabled={!hasExpandedItems}
            onClick={onCollapseAll}
          >
            {t("connections.collapseAll")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="search"
            disabled={connections.length === 0}
            onClick={onOpenSearch}
          >
            {t("connections.filterTables")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon={showRowCounts ? "check" : "list"}
            onClick={onToggleRowCounts}
          >
            {t("connections.showRowCounts")}
          </ToolbarMenuItem>
        </ToolbarMenu>
        <span className="tw:pointer-events-none tw:ml-auto tw:opacity-0 tw:transition-opacity tw:group-hover:pointer-events-auto tw:group-hover:opacity-100 tw:group-focus-within:pointer-events-auto tw:group-focus-within:opacity-100">
          <ToolWindowHideButton label={t("common.close")} onClick={onClose} />
        </span>
      </div>

      {workspaceHeader}

      {connections.length > 0 && searchOpen ? (
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
