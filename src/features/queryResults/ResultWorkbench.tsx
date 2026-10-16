// Stateless chrome for the result workbench: the toolbar row and the row-count footer,
// which can carry a short tooltip note about how the result's values are shown.
// Filter text, paging, and the show-more decision stay with the result owner; cell text
// comes from the grid's shared `gridCellText` projection.
import { useId } from "react";
import type { SqlStreamRowSource } from "../queries/domain";
import type { CellDecodeFailure } from "../../ipc/types";
import {
  DataGridStatusPill,
  WorkbenchButton,
  ResultMeta,
  WorkbenchDivider,
  WorkbenchToolbar,
} from "../../design-system/components/Workbench";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../../components/Icon";
import { TextInput } from "../../design-system/components/FormControls";
import { StatusBadge } from "../../design-system/components/Status";
import ResultToolbar from "./ResultToolbar";

export function ResultWorkbenchToolbar({
  columns,
  rows,
  decodeFailures,
  rowSource,
  filenameBase,
  partial,
  filterOpen,
  filter,
  filterDisabled = false,
  filterDisabledReason,
  onToggleFilter,
  onFilterChange,
}: {
  columns: string[];
  rows?: unknown[][];
  decodeFailures?: CellDecodeFailure[];
  rowSource?: SqlStreamRowSource;
  filenameBase: string;
  partial?: boolean;
  filterOpen: boolean;
  filter: string;
  filterDisabled?: boolean;
  /** Why the received-rows filter is unavailable; shown on the focusable control. */
  filterDisabledReason?: string;
  onToggleFilter: () => void;
  onFilterChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const filterScopeId = useId();
  return (
    <>
      <WorkbenchToolbar label={t("services.resultToolbar")} compact>
        <span
          className="tw:inline-flex tw:size-control-sm tw:shrink-0 tw:items-center tw:justify-center tw:text-foreground"
          title={t("services.gridView")}
        >
          <Icon name="table" />
        </span>
        <WorkbenchDivider />
        <WorkbenchButton
          iconOnly
          size="xs"
          aria-pressed={filterOpen}
          aria-label={t("services.resultSearch")}
          title={
            filterDisabled && filterDisabledReason
              ? filterDisabledReason
              : t("services.resultSearch")
          }
          disabled={filterDisabled}
          disabledBehavior="focusable"
          onClick={onToggleFilter}
        >
          <Icon name="search" />
        </WorkbenchButton>
        {filterOpen ? (
          <span className="tw:w-[min(260px,34vw)] tw:min-w-24 tw:shrink">
            <TextInput
              autoFocus
              density="xs"
              type="search"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={t("services.resultSearchPlaceholder")}
              aria-label={t("services.resultSearch")}
              aria-describedby={filterScopeId}
            />
          </span>
        ) : null}
        <ResultToolbar
          columns={columns}
          rows={rows}
          decodeFailures={decodeFailures}
          rowSource={rowSource}
          filenameBase={filenameBase}
          partial={partial}
          presentation="workbench"
        />
      </WorkbenchToolbar>
      {filterOpen ? (
        <ResultMeta><span id={filterScopeId}>{t("results.filterScope")}</span></ResultMeta>
      ) : null}
    </>
  );
}

export function ResultWorkbenchFooter({
  visible,
  total,
  duration,
  state,
  truncated,
  maxRows,
  showMoreCount = 0,
  onShowMore,
  onClearFilter,
  hint,
}: {
  visible: number;
  total: number;
  duration: number | null;
  state?: string;
  truncated: boolean;
  maxRows: number;
  showMoreCount?: number;
  onShowMore?: () => void;
  onClearFilter?: () => void;
  /** A short note about how this result's values are shown, as a tooltip. */
  hint?: string;
}) {
  const { t } = useI18n();
  return (
    <DataGridStatusPill
      title={
        duration === null
          ? t("services.rowSummaryState", {
              visible,
              total,
              state: state ?? t("sql.running"),
            })
          : t("services.rowSummary", { visible, total, duration })
      }
      actions={
        <>
          {hint ? (
            <StatusBadge iconOnly title={hint} aria-label={hint} role="img">
              <Icon name="info" />
            </StatusBadge>
          ) : null}
          {onClearFilter ? (
            <WorkbenchButton
              iconOnly
              size="xs"
              title={t("results.clearFilter")}
              aria-label={t("results.clearFilter")}
              onClick={onClearFilter}
            >
              <Icon name="close" />
            </WorkbenchButton>
          ) : null}
          {onShowMore && showMoreCount > 0 ? (
            <WorkbenchButton onClick={onShowMore}>
              {t("sql.showMore", { count: showMoreCount, total })}
            </WorkbenchButton>
          ) : null}
        </>
      }
    >
      {onClearFilter
        ? t("results.filteredRows", { visible, total })
        : t("ide.queryRows", { count: visible })}
      {duration === null ? "" : ` · ${t("results.durationMs", { duration })}`}
      {truncated ? ` · ${t("sql.capped", { count: maxRows })}` : ""}
    </DataGridStatusPill>
  );
}
