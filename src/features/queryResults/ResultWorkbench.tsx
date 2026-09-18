// Stateless chrome for the result workbench: the toolbar row, the row-count footer, and the
// cell-to-text projection they share. Filter text, paging, and the show-more decision stay
// with the result owner.
import type { SqlStreamRowSource } from "../queries/domain";
import type { CellDecodeFailure } from "../../ipc/types";
import {
  DataGridStatusPill,
  WorkbenchButton,
  WorkbenchDivider,
  WorkbenchToolbar,
} from "../../design-system/components/Workbench";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../../components/Icon";
import { TextInput } from "../../design-system/components/FormControls";
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
  onToggleFilter: () => void;
  onFilterChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
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
        title={t("services.resultSearch")}
        disabled={filterDisabled}
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
}: {
  visible: number;
  total: number;
  duration: number | null;
  state?: string;
  truncated: boolean;
  maxRows: number;
  showMoreCount?: number;
  onShowMore?: () => void;
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
        onShowMore && showMoreCount > 0 ? (
          <WorkbenchButton
            onClick={onShowMore}
          >
            {t("sql.showMore", { count: showMoreCount, total })}
          </WorkbenchButton>
        ) : undefined
      }
    >
      {t("ide.queryRows", { count: visible })}
      {truncated ? ` · ${t("sql.capped", { count: maxRows })}` : ""}
    </DataGridStatusPill>
  );
}

export function resultCellText(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
