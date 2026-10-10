// Owns stored-result exports for the whole window. An export outlives the toolbar
// that started it (switching SQL/results or running another query does not cancel
// it); toolbars only observe progress for their result and request cancellation,
// and the status bar lists every export that is writing (PD-10). Progress exists
// only once rows are being written, never while the save dialog is open. Rows the
// renderer already holds are saved through the same native dialog and toasts.
import { useSyncExternalStore } from "react";

import type { I18nKey } from "../../lib/i18n";
import { csvExportText, jsonExportText } from "../../lib/export";
import type { SqlStreamRowSource } from "../queries/domain";
import {
  exportSqlResult,
  saveResultText,
  type SqlResultExportController,
  type SqlResultExportFormat,
  type SqlResultExportProgress,
} from "../queries/tauriAdapter";

export type ResultExportOutcome =
  | { kind: "completed"; rowsWritten: number; fileName: string | null }
  | { kind: "dismissed" }
  | { kind: "cancelled" }
  | { kind: "failed"; error: unknown };

type ActiveExport = {
  controller: SqlResultExportController;
  /** The suggested file name, shown while the export writes. */
  title: string;
  startedAt: number;
  /** Null while the save dialog is open: nothing is being written yet. */
  progress: SqlResultExportProgress | null;
  cancelled: boolean;
};

/** A stored-result export that is writing rows, as the status bar lists it. */
export type ResultExportTask = {
  operationId: string;
  title: string;
  startedAt: number;
  rowsWritten: number;
  totalRows: number;
  cancelled: boolean;
};

const active = new Map<string, ActiveExport>();
const listeners = new Set<() => void>();
let writingTasks: readonly ResultExportTask[] = [];

function notify() {
  writingTasks = [...active].flatMap(([operationId, entry]) =>
    entry.progress
      ? [{
          operationId,
          title: entry.title,
          startedAt: entry.startedAt,
          rowsWritten: entry.progress.rowsWritten,
          totalRows: entry.progress.totalRows,
          cancelled: entry.cancelled,
        }]
      : [],
  );
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Starts one export per stored result. `onDone` runs exactly once, after the
 * native file is written, the save dialog is dismissed, or the export stops.
 */
export function startResultExport(
  rowSource: SqlStreamRowSource,
  format: SqlResultExportFormat,
  suggestedName: string,
  onDone: (outcome: ResultExportOutcome) => void,
) {
  const operationId = rowSource.operationId;
  if (!operationId || active.has(operationId)) return false;
  const controller = exportSqlResult(rowSource, format, suggestedName, (progress) => {
    const current = active.get(operationId);
    if (!current || current.controller !== controller) return;
    active.set(operationId, { ...current, progress });
    notify();
  });
  active.set(operationId, {
    controller,
    title: suggestedName,
    startedAt: Date.now(),
    cancelled: false,
    progress: null,
  });
  notify();
  void controller.completion
    .then((receipt): ResultExportOutcome =>
      receipt
        ? {
            kind: "completed",
            rowsWritten: receipt.rowsWritten,
            fileName: receipt.fileName ?? null,
          }
        : { kind: "dismissed" },
    )
    .catch((error: unknown): ResultExportOutcome =>
      active.get(operationId)?.cancelled
        ? { kind: "cancelled" }
        : { kind: "failed", error },
    )
    .then((outcome) => {
      if (active.get(operationId)?.controller === controller) {
        active.delete(operationId);
        notify();
      }
      onDone(outcome);
    });
  return true;
}

export function cancelResultExport(operationId: string | null) {
  const current = operationId ? active.get(operationId) : undefined;
  if (!current || !operationId) return;
  active.set(operationId, { ...current, cancelled: true });
  notify();
  void current.controller.cancel().catch(() => undefined);
}

/** Live progress of the export writing one stored result, if any. */
export function useResultExportProgress(
  operationId: string | null | undefined,
): SqlResultExportProgress | null {
  return useSyncExternalStore(
    subscribe,
    () => (operationId ? (active.get(operationId)?.progress ?? null) : null),
  );
}

/** Whether an export for this stored result is choosing a file or writing. */
export function useResultExportActive(operationId: string | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => !!operationId && active.has(operationId));
}

/** Every stored-result export that is writing rows, for the status bar. */
export function useResultExportTasks(): readonly ResultExportTask[] {
  return useSyncExternalStore(subscribe, () => writingTasks);
}

/** Largest text one renderer-built save may write; the native save refuses more. */
const RENDERER_EXPORT_MAX_BYTES = 64 * 1024 * 1024;
const RENDERER_EXPORT_MAX_MIB = RENDERER_EXPORT_MAX_BYTES / 1024 / 1024;

/** UTF-8 size check without encoding text that is clearly within or over it. */
function exceedsRendererExportLimit(text: string): boolean {
  // Each UTF-16 code unit is one to three UTF-8 bytes (a surrogate pair is four).
  if (text.length > RENDERER_EXPORT_MAX_BYTES) return true;
  if (text.length * 3 <= RENDERER_EXPORT_MAX_BYTES) return false;
  return new TextEncoder().encode(text).length > RENDERER_EXPORT_MAX_BYTES;
}

/**
 * Saves rows the renderer already holds (a filtered view, a materialized or
 * script-statement result, one cell) through the native save dialog, with the
 * same completion and failure toasts as a stored-result export. Text over the
 * native save's limit is refused before the dialog opens, with that reason.
 */
export async function saveRendererExport(
  format: SqlResultExportFormat,
  base: string,
  columns: string[],
  rows: unknown[][],
  t: Translate,
  toast: (message: string, tone?: "error") => void,
) {
  const text = format === "csv" ? csvExportText(columns, rows) : jsonExportText(columns, rows);
  if (exceedsRendererExportLimit(text)) {
    toast(t("results.exportTooLarge", { limit: RENDERER_EXPORT_MAX_MIB }), "error");
    return;
  }
  try {
    const fileName = await saveResultText(`${base}.${format}`, format, text);
    if (fileName === null) return;
    toast(
      fileName
        ? t("results.exportSucceeded", { count: rows.length, file: fileName })
        : t("results.exportSucceededNoName", { count: rows.length }),
    );
  } catch (error) {
    toast(resultExportErrorMessage(error, t), "error");
  }
}

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

/** Translated reason for a failed stored-result export; never the raw error. */
export function resultExportErrorMessage(error: unknown, t: Translate): string {
  const shaped = error && typeof error === "object"
    ? (error as { kind?: unknown; message?: unknown })
    : {};
  const message = typeof shaped.message === "string" ? shaped.message : "";
  const decode = /row (\d+), column (\d+) could not be decoded as (.+)$/.exec(message);
  if (decode) {
    return t("results.exportBlockedDecode", {
      row: decode[1],
      column: decode[2],
      type: decode[3],
    });
  }
  const shortened = /row (\d+), column (\d+) was shortened/.exec(message);
  if (shortened) {
    return t("results.exportBlockedTruncated", {
      row: shortened[1],
      column: shortened[2],
    });
  }
  if (shaped.kind === "blocked" && message.includes("authority changed")) {
    return t("results.exportAuthorityChanged");
  }
  if (shaped.kind === "blocked" && message.includes("larger than one in-memory save")) {
    return t("results.exportTooLarge", { limit: RENDERER_EXPORT_MAX_MIB });
  }
  if (shaped.kind === "blocked" && message.includes("destination is not a regular file")) {
    return t("results.exportDestinationRefused");
  }
  if (
    shaped.kind === "notFound" ||
    (shaped.kind === "io" && /no such file|not found/i.test(message))
  ) {
    return t("results.exportExpired");
  }
  return t("results.exportFailed");
}
