// Compact export/copy controls for any result grid. Workbench surfaces use the
// product command grammar of Copy + one CSV format menu; inline metadata keeps
// the explicit text actions. Every action operates on the full result rows.
import { useEffect, useRef, useState } from "react";

import type { SqlStreamRowSource } from "../queries/domain";
import {
  collectCachedSqlResultDecodeFailures,
  collectCachedSqlResultRows,
} from "../queries/resultPageCache";
import type { CellDecodeFailure } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
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
  decodeFailures,
  rowSource,
  filenameBase,
  scopeLabel,
  partial,
  presentation = "inline",
}: {
  columns: string[];
  rows?: unknown[][];
  decodeFailures?: CellDecodeFailure[];
  rowSource?: SqlStreamRowSource;
  filenameBase: string;
  // Optional on-surface scope for page-limited exports (e.g. "page"). Default keeps
  // the bare "CSV"/"JSON" labels so existing callers (Sql, Agent) are unchanged.
  scopeLabel?: string;
  /** Running streams are partial snapshots and cannot be exported as complete. */
  partial?: boolean;
  /** Dense Services toolbar presentation; the default remains inline metadata. */
  presentation?: "inline" | "workbench";
}) {
  const { t } = useI18n();
  const toast = useToast();
  const count = rowSource?.rowCount ?? rows?.length ?? 0;
  const disabled = partial === true;
  const cachedRows = rowSource ? collectCachedSqlResultRows(rowSource) : null;
  const knownDecodeFailures = rowSource
    ? collectCachedSqlResultDecodeFailures(rowSource)
    : (decodeFailures ?? []);
  const firstDecodeFailure = knownDecodeFailures[0];
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
  const failureReason = (action: "copy" | "export") =>
    firstDecodeFailure
      ? t(
          action === "copy"
            ? "grid.decodeFailureCopyBlocked"
            : "results.decodeFailureExportBlocked",
          {
            row: firstDecodeFailure.rowIndex + 1,
            column: firstDecodeFailure.columnIndex + 1,
            type: firstDecodeFailure.databaseType,
          },
        )
      : null;
  const exportStored = (format: "csv" | "json") => {
    if (!rowSource || exportRef.current) return;
    const blocked = failureReason("export");
    if (blocked) {
      toast(blocked, "error");
      return;
    }
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
      .catch((error) => {
        if (cancelledExportIdRef.current !== controller.exportId) {
          toast(errMessage(error) || t("results.exportFailed"), "error");
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
    const blocked = failureReason("export");
    if (blocked) {
      toast(blocked, "error");
      return;
    }
    if (rowSource) {
      exportStored("csv");
      return;
    }
    downloadCsv(filenameBase, columns, rows ?? []);
  };
  const exportJson = () => {
    const blocked = failureReason("export");
    if (blocked) {
      toast(blocked, "error");
      return;
    }
    if (rowSource) {
      exportStored("json");
      return;
    }
    downloadJson(filenameBase, columns, rows ?? []);
  };
  const copyTitle =
    copyDisabled && rowSource && !disabled
      ? t("results.copyBoundedTitle")
      : scopeLabel
        ? t("results.copyScopeTitle", { scope: scopeLabel })
        : t("results.copyTitle");
  const csvTitle = scopeLabel
    ? t("results.exportCsv", { scope: scopeLabel })
    : t("results.downloadCsvTitle");
  const jsonTitle = scopeLabel
    ? t("results.exportJson", { scope: scopeLabel })
    : t("results.downloadJsonTitle");
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
        onClick={() => {
          const blocked = failureReason("copy");
          if (blocked) {
            toast(blocked, "error");
            return;
          }
          void navigator.clipboard
            .writeText(
              toTsv(
                columns,
                rowSource
                  ? (cachedRows ?? []).map((row) => [...row])
                  : (rows ?? []),
              ),
            )
            .then(() => toast(t("results.copyRows", { count })))
            .catch(() => toast(t("results.copyFailed"), "error"));
        }}
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
          label={csvTitle}
          disabled={disabled || exportProgress !== null}
          trigger={
            <>
              CSV
              <Icon name="chevronDown" />
            </>
          }
        >
          <ToolbarMenuItem icon="download" onClick={exportCsv}>
            {csvTitle}
          </ToolbarMenuItem>
          <ToolbarMenuItem icon="download" onClick={exportJson}>
            {jsonTitle}
          </ToolbarMenuItem>
        </ToolbarMenu>
      ) : (
        <>
          <WorkbenchButton
            title={t("results.downloadCsvTitle")}
            disabled={disabled || exportProgress !== null}
            onClick={exportCsv}
          >
            {scopeLabel
              ? t("results.exportCsv", { scope: scopeLabel })
              : "CSV"}
          </WorkbenchButton>
          <WorkbenchButton
            title={t("results.downloadJsonTitle")}
            disabled={disabled || exportProgress !== null}
            onClick={exportJson}
          >
            {scopeLabel
              ? t("results.exportJson", { scope: scopeLabel })
              : "JSON"}
          </WorkbenchButton>
        </>
      )}
      {disabled && (
        <span className="tw:text-muted-foreground">
          {t("results.partialExportUnavailable")}
        </span>
      )}
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
