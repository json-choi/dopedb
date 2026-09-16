import { Icon } from "../../components/Icon";
import ToolbarMenu, {
  ToolbarMenuItem,
} from "../../components/ToolbarMenu";
import {
  WorkbenchButton,
  WorkbenchDivider,
  WorkbenchToolbar,
} from "../../design-system/components/Workbench";
import type { CatalogTable, QueryResult } from "../../ipc/types";
import { downloadCsv, downloadJson, stamp } from "../../lib/export";
import { useI18n } from "../../lib/i18n";
import Pager from "./Pager";
import ManualTransactionControls from "../../features/queries/ManualTransactionControls";
import type { ManualTransactionController } from "../../features/queries/useManualTransaction";

type Props = {
  table: CatalogTable;
  result: QueryResult | null;
  canEdit: boolean;
  noEditTitle: string;
  selected: number | null;
  /** The selected row holds a cell the backend could not read. */
  selectedRowUnreadable: boolean;
  /** Cells of the current page the backend could not read. */
  unreadableCells: number;
  stagedCount: number;
  activeFilters: number;
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
  rows: number;
  busy: boolean;
  jobsOpen: boolean;
  catalogAvailable: boolean;
  structureOpen: boolean;
  manualTransaction: ManualTransactionController;
  writesEnabled: boolean;
  supportsMutationTools: boolean;
  supportsBulkJobs: boolean;
  onOpenEdit: (mode: "insert" | "edit" | "duplicate") => void;
  onDelete: () => void;
  onReviewStaged: () => void;
  onDiscardStaged: () => void;
  onClearFilters: () => void;
  onPage: (page: number) => void;
  onRefresh: () => void;
  onShowDdl: () => void;
  onToggleJobs: () => void;
  onToggleStructure: () => void;
  onCopyRow: (json: boolean) => void;
};

export default function TableToolbar(props: Props) {
  const { t } = useI18n();
  const {
    table,
    result,
    canEdit,
    noEditTitle,
    selected,
    selectedRowUnreadable,
    unreadableCells,
    stagedCount,
    activeFilters,
    page,
    pageSize,
    total,
    hasMore,
    rows,
    busy,
    jobsOpen,
    catalogAvailable,
    structureOpen,
    supportsMutationTools,
    supportsBulkJobs,
  } = props;
  // A page carrying a cell the backend could not read cannot be exported or copied:
  // the file would show those cells as empty values the column never returned.
  const unreadable = unreadableCells > 0;
  const unreadableTitle = t("results.unreadableBlockedTitle", {
    count: unreadableCells,
  });
  const exportCsv = () => {
    if (!result || unreadable) return;
    downloadCsv(
      `${table.name}-page${page + 1}-${stamp()}`,
      result.columns,
      result.rows,
    );
  };
  const exportJson = () => {
    if (!result || unreadable) return;
    downloadJson(
      `${table.name}-page${page + 1}-${stamp()}`,
      result.columns,
      result.rows,
    );
  };
  const lastPage =
    total != null ? Math.max(0, Math.ceil(total / pageSize) - 1) : null;
  const hasPrev = page > 0;
  const hasNext = total != null ? page < (lastPage ?? 0) : hasMore;

  return (
    <WorkbenchToolbar label={t("tables.querySurface")}>
      <div className="scrollbar-sleek tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-1 tw:overflow-x-auto tw:overflow-y-hidden tw:overscroll-x-contain">
        <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-1">
          <WorkbenchButton
            iconOnly
            disabled={busy}
            title={t("common.refresh")}
            aria-label={t("common.refresh")}
            onClick={props.onRefresh}
          >
            {busy ? "…" : <Icon name="refresh" />}
          </WorkbenchButton>
          {supportsMutationTools ? (
            <>
              <WorkbenchButton
                iconOnly
                disabled={!canEdit}
                title={canEdit ? t("tables.insert") : noEditTitle}
                aria-label={t("tables.insert")}
                onClick={() => props.onOpenEdit("insert")}
              >
                <Icon name="plus" />
              </WorkbenchButton>
              <WorkbenchButton
                iconOnly
                disabled={!canEdit || selected == null}
                title={canEdit ? t("tables.edit") : noEditTitle}
                aria-label={t("tables.edit")}
                onClick={() => props.onOpenEdit("edit")}
              >
                <Icon name="pencil" />
              </WorkbenchButton>
              <WorkbenchButton
                iconOnly
                disabled={!canEdit || selected == null}
                title={canEdit ? t("tables.delete") : noEditTitle}
                aria-label={t("tables.delete")}
                onClick={props.onDelete}
              >
                <Icon name="minus" />
              </WorkbenchButton>
            </>
          ) : null}
          {stagedCount > 0 ? (
            <>
              <WorkbenchButton
                variant="selected"
                onClick={props.onReviewStaged}
                title={t("tables.reviewStaged")}
              >
                <Icon name="check" />
                {t("tables.stagedCount", { count: stagedCount })}
              </WorkbenchButton>
              <WorkbenchButton
                iconOnly
                onClick={props.onDiscardStaged}
                title={t("tables.discardStaged")}
                aria-label={t("tables.discardStaged")}
              >
                <Icon name="close" />
              </WorkbenchButton>
            </>
          ) : null}
        </div>

        <WorkbenchDivider />

        <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-1">
          {supportsMutationTools ? (
            <>
              <ManualTransactionControls
                controller={props.manualTransaction}
                writesEnabled={props.writesEnabled}
                disabled={busy}
              />
              <WorkbenchButton
                onClick={props.onShowDdl}
                title={t("connections.showDdl")}
              >
                DDL
              </WorkbenchButton>
            </>
          ) : null}
          <WorkbenchButton
            active={activeFilters > 0}
            iconOnly
            tone={activeFilters > 0 ? "primary" : "neutral"}
            disabled={activeFilters === 0}
            onClick={props.onClearFilters}
            title={t("tables.clear")}
            aria-label={t("tables.clear")}
          >
            <Icon name="filter" />
          </WorkbenchButton>
        </div>
      </div>

      <Pager
        page={page}
        pageSize={pageSize}
        total={total}
        hasMore={hasMore}
        rows={rows}
        busy={busy}
        showRefresh={false}
        collapseNavigation
        onPage={props.onPage}
        onRefresh={props.onRefresh}
      >
        {supportsBulkJobs ? (
          <WorkbenchButton
            collapse="compact"
            iconOnly
            disabled={!catalogAvailable}
            aria-expanded={jobsOpen}
            title={
              catalogAvailable ? t("jobs.open") : t("tables.catalogRequired")
            }
            aria-label={t("jobs.open")}
            onClick={props.onToggleJobs}
          >
            <Icon name="download" />
          </WorkbenchButton>
        ) : null}
        <WorkbenchButton
          collapse="compact"
          iconOnly
          aria-expanded={structureOpen}
          title={t("tables.structureTitle")}
          aria-label={t("tables.structureTitle")}
          onClick={props.onToggleStructure}
        >
          <Icon name="columns" />
        </WorkbenchButton>
        <span className="tw:@max-[480px]:hidden">
          <ToolbarMenu
            label={t("tables.exportPageTitle")}
            trigger={
              <>
                CSV
                <Icon name="chevronDown" />
              </>
            }
          >
            <ToolbarMenuItem
              icon="download"
              disabled={!rows}
              onClick={exportCsv}
            >
              {t("tables.exportCsv")}
            </ToolbarMenuItem>
            <ToolbarMenuItem
              icon="download"
              disabled={!rows}
              onClick={exportJson}
            >
              {t("tables.exportJson")}
            </ToolbarMenuItem>
          </ToolbarMenu>
        </span>
        <ToolbarMenu label={t("tables.more")} icon="moreVertical">
          <ToolbarMenuItem
            icon="chevronsLeft"
            disabled={busy || !hasPrev}
            onClick={() => props.onPage(0)}
          >
            {t("common.first")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="arrowLeft"
            disabled={busy || !hasPrev}
            onClick={() => props.onPage(page - 1)}
          >
            {t("common.prev")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="arrowRight"
            disabled={busy || !hasNext}
            onClick={() => props.onPage(page + 1)}
          >
            {t("common.next")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="chevronsRight"
            disabled={busy || lastPage == null || !hasNext}
            onClick={() => lastPage != null && props.onPage(lastPage)}
          >
            {t("tables.last")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="refresh"
            disabled={busy}
            onClick={props.onRefresh}
          >
            {t("common.refresh")}
          </ToolbarMenuItem>
          {supportsBulkJobs ? (
            <ToolbarMenuItem
              icon="download"
              disabled={!catalogAvailable}
              onClick={props.onToggleJobs}
            >
              {t("jobs.open")}
            </ToolbarMenuItem>
          ) : null}
          <ToolbarMenuItem icon="columns" onClick={props.onToggleStructure}>
            {t("tables.structureTitle")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="copy"
            disabled={!canEdit || selected == null}
            title={canEdit ? undefined : noEditTitle}
            onClick={() => props.onOpenEdit("duplicate")}
          >
            {t("tables.duplicate")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="copy"
            disabled={selected == null || selectedRowUnreadable}
            title={selectedRowUnreadable ? noEditTitle : undefined}
            onClick={() => props.onCopyRow(false)}
          >
            {t("tables.copyTsv")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="copy"
            disabled={selected == null || selectedRowUnreadable}
            title={selectedRowUnreadable ? noEditTitle : undefined}
            onClick={() => props.onCopyRow(true)}
          >
            {t("tables.copyJson")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="download"
            disabled={!rows || unreadable}
            title={unreadable ? unreadableTitle : t("tables.exportPageTitle")}
            onClick={exportCsv}
          >
            {t("tables.exportCsv")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="download"
            disabled={!rows || unreadable}
            title={unreadable ? unreadableTitle : t("tables.exportPageTitle")}
            onClick={exportJson}
          >
            {t("tables.exportJson")}
          </ToolbarMenuItem>
        </ToolbarMenu>
      </Pager>
    </WorkbenchToolbar>
  );
}
