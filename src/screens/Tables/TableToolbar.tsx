// Composes table commands, current-page export, pagination, and manual-transaction controls.

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
import { stamp } from "../../lib/export";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../../components/Toast";
import Pager from "./Pager";
import ManualTransactionControls from "../../features/queries/ManualTransactionControls";
import { truncatedCellBytes } from "../../features/queries/resultPageCache";
import { saveRendererExport } from "../../features/queryResults/resultExports";
import type { ManualTransactionController } from "../../features/queries/useManualTransaction";

type Props = {
  table: CatalogTable;
  result: QueryResult | null;
  canEdit: boolean;
  noEditTitle: string;
  selectedRowBlockedReason: string | null;
  selected: number | null;
  stagedCount: number;
  mutationLocked?: boolean;
  cellDraftActive?: boolean;
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
  const toast = useToast();
  const {
    table,
    result,
    canEdit,
    noEditTitle,
    selectedRowBlockedReason,
    selected,
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
  // The first undecodable or shortened cell stops export with translated guidance.
  const exportBlocked = () => {
    const failure = result?.decodeFailures?.[0];
    if (!failure) return false;
    const location = { row: failure.rowIndex + 1, column: failure.columnIndex + 1 };
    toast(
      truncatedCellBytes(failure) !== null
        ? t("results.exportBlockedTruncated", location)
        : t("results.exportBlockedDecode", { ...location, type: failure.databaseType }),
      "error",
    );
    return true;
  };
  const exportPage = (format: "csv" | "json") => {
    if (!result || exportBlocked()) return;
    void saveRendererExport(
      format,
      `${table.name}-page${page + 1}-${stamp()}`,
      result.columns,
      result.rows,
      t,
      toast,
    );
  };
  const exportCsv = () => exportPage("csv");
  const exportJson = () => exportPage("json");
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
                disabled={!canEdit || selected == null || !!selectedRowBlockedReason}
                title={selectedRowBlockedReason ?? (canEdit ? t("tables.edit") : noEditTitle)}
                aria-label={t("tables.edit")}
                onClick={() => props.onOpenEdit("edit")}
              >
                <Icon name="pencil" />
              </WorkbenchButton>
              <WorkbenchButton
                iconOnly
                disabled={!canEdit || selected == null || !!selectedRowBlockedReason}
                title={selectedRowBlockedReason ?? (canEdit ? t("tables.delete") : noEditTitle)}
                aria-label={t("tables.delete")}
                onClick={props.onDelete}
              >
                <Icon name="minus" />
              </WorkbenchButton>
            </>
          ) : null}
          {stagedCount > 0 || props.cellDraftActive ? (
            <>
              <WorkbenchButton
                variant="selected"
                disabled={props.mutationLocked}
                onClick={props.onReviewStaged}
                title={t("tables.reviewStaged")}
              >
                <Icon name="check" />
                {t("tables.saveChanges", { count: stagedCount })}
              </WorkbenchButton>
              <WorkbenchButton
                iconOnly
                disabled={props.mutationLocked}
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
            tone={activeFilters > 0 ? "primary" : "neutral"}
            disabled={activeFilters === 0}
            onClick={props.onClearFilters}
            title={t("tables.clear")}
            aria-label={t("tables.clear")}
          >
            <Icon name="filter" />
            {activeFilters > 0 ? t("tables.databaseFilters", { count: activeFilters }) : null}
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
          {/* Previous/next stay visible in the pager at every width; only the
              first/last jumps collapse into this menu on narrow workbenches. */}
          <ToolbarMenuItem
            icon="chevronsLeft"
            disabled={busy || !hasPrev}
            onClick={() => props.onPage(0)}
          >
            {t("common.first")}
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
            disabled={!canEdit || selected == null || !!selectedRowBlockedReason}
            title={selectedRowBlockedReason ?? (canEdit ? undefined : noEditTitle)}
            onClick={() => props.onOpenEdit("duplicate")}
          >
            {t("tables.duplicate")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="copy"
            disabled={selected == null || !!selectedRowBlockedReason}
            title={selectedRowBlockedReason ?? undefined}
            onClick={() => props.onCopyRow(false)}
          >
            {t("tables.copyTsv")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="copy"
            disabled={selected == null || !!selectedRowBlockedReason}
            title={selectedRowBlockedReason ?? undefined}
            onClick={() => props.onCopyRow(true)}
          >
            {t("tables.copyJson")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="download"
            disabled={!rows}
            title={t("tables.exportPageTitle")}
            onClick={exportCsv}
          >
            {t("tables.exportCsv")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="download"
            disabled={!rows}
            title={t("tables.exportPageTitle")}
            onClick={exportJson}
          >
            {t("tables.exportJson")}
          </ToolbarMenuItem>
        </ToolbarMenu>
      </Pager>
    </WorkbenchToolbar>
  );
}
