// Stateless chrome for the result workbench: the toolbar row and the row-count footer,
// which can carry a short tooltip note about how the result's values are shown.
// Paging and the show-more decision stay with the result owner.
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
import { StatusBadge } from "../../design-system/components/Status";
import ResultToolbar from "./ResultToolbar";

export function ResultWorkbenchToolbar({
  columns,
  rows,
  decodeFailures,
  rowSource,
  filenameBase,
  partial,
}: {
  columns: string[];
  rows?: unknown[][];
  decodeFailures?: CellDecodeFailure[];
  rowSource?: SqlStreamRowSource;
  filenameBase: string;
  partial?: boolean;
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
          {onShowMore && showMoreCount > 0 ? (
            <WorkbenchButton onClick={onShowMore}>
              {t("sql.showMore", { count: showMoreCount, total })}
            </WorkbenchButton>
          ) : null}
        </>
      }
    >
      {t("ide.queryRows", { count: visible })}
      {duration === null ? "" : ` · ${t("results.durationMs", { duration })}`}
      {truncated ? ` · ${t("sql.capped", { count: maxRows })}` : ""}
    </DataGridStatusPill>
  );
}
