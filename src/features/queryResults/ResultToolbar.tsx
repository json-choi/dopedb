// Compact export/copy controls for any result grid. Workbench surfaces use the
// product command grammar of Copy + one CSV format menu; inline metadata keeps
// the explicit text actions. Every action operates on the full result rows.
// A result holding a cell the backend could not read blocks copy and export
// outright: a file or clipboard payload that silently empties those cells would
// claim a value they do not have.
import { useEffect, useRef, useState } from "react";

import type { SqlStreamRowSource } from "../queries/domain";
import { collectCachedSqlResultRows } from "../queries/resultPageCache";
import {
  exportSqlResult,
  type SqlResultExportController,
  type SqlResultExportProgress,
} from "../queries/tauriAdapter";
import {
  downloadCsv,
  downloadJson,
  toTsv,
} from "../../lib/export";
import { useI18n } from "../../lib/i18n";
import { WorkbenchButton } from "../../design-system/components/Workbench";
import { ProgressBar } from "../../design-system/components/Progress";
import { Icon } from "../../components/Icon";
import ToolbarMenu, { ToolbarMenuItem } from "../../components/ToolbarMenu";
import { useToast } from "../../components/Toast";

export default function ResultToolbar({
  columns,
  rows,
  rowSource,
  filenameBase,
  scopeLabel,
  partial,
  unreadableCells = 0,
  presentation = "inline",
}: {
  columns: string[];
  rows?: unknown[][];
  rowSource?: SqlStreamRowSource;
  filenameBase: string;
  /** Cells of this result the backend could not read; any blocks copy/export. */
  unreadableCells?: number;
  // Name of the exact rows these actions cover (e.g. the current page). Set it
  // wherever the grid shows part of a larger result, so copy and export never read
  // as "everything"; leaving it unset keeps the bare labels for whole results.
  scopeLabel?: string;
  /** Running streams are partial snapshots and cannot be exported as complete. */
  partial?: boolean;
  /** Dense Services toolbar presentation; the default remains inline metadata. */
  presentation?: "inline" | "workbench";
}) {
  const { t } = useI18n();
  const toast = useToast();
  const count = rowSource?.rowCount ?? rows?.length ?? 0;
  const unreadable = unreadableCells > 0;
  const disabled = partial === true || unreadable;
  const cachedRows = rowSource ? collectCachedSqlResultRows(rowSource) : null;
  const copyDisabled = disabled || (!!rowSource && cachedRows === null);
  const exportRef = useRef<SqlResultExportController | null>(null);
  const cancelledExportIdRef = useRef<string | null>(null);
  const [exportProgress, setExportProgress] =
    useState<SqlResultExportProgress | null>(null);
  useEffect(
    () => () => {
      const controller = exportRef.current;
      if (!controller) return;
      cancelledExportIdRef.current = controller.exportId;
      void controller.cancel();
    },
    [],
  );
  const cancelExport = () => {
    const controller = exportRef.current;
    if (!controller) return;
    cancelledExportIdRef.current = controller.exportId;
    void controller.cancel();
  };
  const exportStored = (format: "csv" | "json") => {
    if (!rowSource || exportRef.current) return;
    const controller = exportSqlResult(
      rowSource,
      format,
      `${filenameBase}.${format}`,
      setExportProgress,
    );
    cancelledExportIdRef.current = null;
    exportRef.current = controller;
    setExportProgress({
      exportId: controller.exportId,
      operationId: rowSource.operationId ?? "",
      rowsWritten: 0,
      totalRows: rowSource.rowCount,
    });
    void controller.completion
      .catch(() => {
        if (cancelledExportIdRef.current !== controller.exportId) {
          toast(t("results.exportFailed"), "error");
        }
      })
      .finally(() => {
        if (exportRef.current === controller) {
          exportRef.current = null;
          setExportProgress(null);
        }
        if (cancelledExportIdRef.current === controller.exportId) {
          cancelledExportIdRef.current = null;
        }
      });
  };
  const exportCsv = () => {
    if (rowSource) {
      exportStored("csv");
      return;
    }
    downloadCsv(filenameBase, columns, rows ?? []);
  };
  const exportJson = () => {
    if (rowSource) {
      exportStored("json");
      return;
    }
    downloadJson(filenameBase, columns, rows ?? []);
  };
  const copyTitle = unreadable
    ? t("results.unreadableBlockedTitle", { count: unreadableCells })
    : copyDisabled && rowSource && !disabled
      ? t("results.copyBoundedTitle")
      : scopeLabel
        ? t("results.copyScopeTitle", { scope: scopeLabel })
        : t("results.copyTitle");
  const exportTitle = unreadable
    ? t("results.unreadableBlockedTitle", { count: unreadableCells })
    : null;
  return (
    <span
      data-presentation={presentation}
      className="tw:inline-flex tw:items-center tw:gap-1 tw:align-middle tw:data-[presentation=inline]:ml-2 tw:data-[presentation=workbench]:ml-auto"
    >
      <WorkbenchButton
        size={presentation === "workbench" ? "xs" : "md"}
        {...(presentation === "workbench"
          ? {
              iconOnly: true as const,
              title: copyTitle,
              "aria-label": copyTitle,
            }
          : {
              iconOnly: false as const,
              title: copyTitle,
              "aria-label": copyTitle,
            })}
        onClick={() =>
          navigator.clipboard
            .writeText(
              toTsv(
                columns,
                rowSource
                  ? (cachedRows ?? []).map((row) => [...row])
                  : (rows ?? []),
              ),
            )
            .then(() => toast(t("results.copyRows", { count })))
            .catch(() => toast(t("results.copyFailed"), "error"))
        }
        disabled={copyDisabled}
      >
        {presentation === "workbench" ? (
          <Icon name="copy" />
        ) : (
          t("results.copy")
        )}
      </WorkbenchButton>
      {presentation === "workbench" ? (
        <ToolbarMenu
          label={exportTitle ?? t("results.downloadCsvTitle")}
          disabled={disabled || exportProgress !== null}
          trigger={
            <>
              CSV
              <Icon name="chevronDown" />
            </>
          }
        >
          <ToolbarMenuItem icon="download" onClick={exportCsv}>
            {scopeLabel
              ? t("results.exportCsv", { scope: scopeLabel })
              : t("results.downloadCsvTitle")}
          </ToolbarMenuItem>
          <ToolbarMenuItem icon="download" onClick={exportJson}>
            {scopeLabel
              ? t("results.exportJson", { scope: scopeLabel })
              : t("results.downloadJsonTitle")}
          </ToolbarMenuItem>
        </ToolbarMenu>
      ) : (
        <>
          <WorkbenchButton
            title={exportTitle ?? t("results.downloadCsvTitle")}
            disabled={disabled || exportProgress !== null}
            onClick={exportCsv}
          >
            {scopeLabel
              ? t("results.exportCsv", { scope: scopeLabel })
              : "CSV"}
          </WorkbenchButton>
          <WorkbenchButton
            title={exportTitle ?? t("results.downloadJsonTitle")}
            disabled={disabled || exportProgress !== null}
            onClick={exportJson}
          >
            {scopeLabel
              ? t("results.exportJson", { scope: scopeLabel })
              : "JSON"}
          </WorkbenchButton>
        </>
      )}
      {unreadable ? (
        <span className="tw:text-warning">
          {t("results.unreadableBlocked", { count: unreadableCells })}
        </span>
      ) : disabled ? (
        <span className="tw:text-muted-foreground">
          {t("results.partialExportUnavailable")}
        </span>
      ) : null}
      {exportProgress ? (
        <span className="tw:inline-grid tw:min-w-36 tw:grid-cols-[minmax(72px,1fr)_auto] tw:items-center tw:gap-x-1 tw:gap-y-0.5 tw:text-xs tw:text-muted-foreground">
          <span className="tw:col-span-2 tw:truncate">
            {t("results.exportProgress", {
              current: exportProgress.rowsWritten,
              total: exportProgress.totalRows,
            })}
          </span>
          <ProgressBar
            density="compact"
            value={exportProgress.rowsWritten}
            max={exportProgress.totalRows || 1}
            label={t("results.exportProgress", {
              current: exportProgress.rowsWritten,
              total: exportProgress.totalRows,
            })}
          />
          <WorkbenchButton
            iconOnly
            size="xs"
            title={t("common.cancel")}
            aria-label={t("common.cancel")}
            onClick={cancelExport}
          >
            <Icon name="close" />
          </WorkbenchButton>
        </span>
      ) : null}
    </span>
  );
}
