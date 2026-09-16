// Shared lifecycle and deterministic fixture projections for packaged benchmark
// scenarios. Scenario modules own UI interactions; this file owns measurement setup.
import { useEffect, useRef, type ReactNode } from "react";

import {
  completePackagedBenchmark,
  failPackagedBenchmark,
  preparePackagedBenchmarkWorkload,
  type PackagedBenchmarkFailureReason,
} from "../../features/runtime/tauriAdapter";
import type { QueryResult } from "../../ipc/types";
import {
  currentPackagedAction,
  measurePackagedAction,
  packagedRendererMetrics,
  type PackagedActionEvidence,
  type PackagedBenchmarkActionName,
} from "../packagedMetrics";
import type { PackagedBackendReceipt } from "../backend";

export const ACTION_SAMPLES = 5;
export const FIXTURE_CONNECTION_ID = "bed00000-0000-0000-0000-000000000001";
export const DENSE_GRID_COLUMN_COUNT = 36;

export function BenchmarkSurface({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <main className="tw:flex tw:h-screen tw:min-h-0 tw:w-screen tw:min-w-0 tw:flex-col tw:overflow-hidden tw:bg-background tw:text-foreground">
      <header className="tw:flex tw:h-control-lg tw:shrink-0 tw:items-center tw:border-b tw:border-border-subtle tw:bg-card tw:px-3 tw:text-sm tw:font-semibold">
        {title}
      </header>
      <div className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
        {children}
      </div>
    </main>
  );
}

export function useScenarioRunner(ready: boolean, runner: () => Promise<void>) {
  const started = useRef(false);
  const latest = useRef(runner);
  latest.current = runner;
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void preparePackagedBenchmarkWorkload()
      .then(() => latest.current())
      .catch((error) =>
        failPackagedBenchmark(
          currentPackagedAction() ?? "scenario-setup",
          benchmarkFailureReason(error),
        ),
      );
  }, [ready]);
}

function benchmarkFailureReason(error: unknown): PackagedBenchmarkFailureReason {
  if (error instanceof RangeError) return "range_error";
  if (error instanceof TypeError) return "type_error";
  if (!(error instanceof Error)) return "unexpected";
  if (error.message.includes("accessibility contract")) return "accessibility_contract";
  if (error.message.includes("viewport")) return "viewport_contract";
  if (error.message.includes("locale")) return "locale_contract";
  if (error.message.includes("keyboard")) return "keyboard_contract";
  if (
    error.message.includes("Skill inventory")
    || error.message.includes("Skill targets")
    || error.message.includes("Skill removal")
  ) {
    return "skill_state";
  }
  if (error.message.includes("unavailable")) return "surface_unavailable";
  if (error.message.includes("timed out")) return "paint_timeout";
  if (error.message.includes("benchmark backend")) return "backend_command";
  return "unexpected";
}

export async function finishBenchmark() {
  await completePackagedBenchmark(packagedRendererMetrics());
}

export async function samples(
  name: PackagedBenchmarkActionName,
  count: number,
  action: (index: number) => void | PackagedActionEvidence | Promise<void | PackagedActionEvidence>,
) {
  for (let index = 0; index < count; index += 1) {
    await measurePackagedAction(name, () => action(index));
  }
}

export function queryResult(rowCount: number): QueryResult {
  const columns = Array.from(
    { length: DENSE_GRID_COLUMN_COUNT },
    (_, index) => index === 0 ? "id" : `metric_${index}`,
  );
  return {
    columns,
    rows: Array.from({ length: rowCount }, (_, rowIndex) =>
      columns.map((_, columnIndex) =>
        columnIndex === 0
          ? rowIndex
          : (rowIndex * (columnIndex + 1)) % 10_000,
      ),
    ),
    rowCount,
    truncated: false,
    durationMs: 0,
    unreadableCells: [],
  };
}

export function backendEvidence(receipt: PackagedBackendReceipt): PackagedActionEvidence {
  return {
    backendRequestToFirstRowMs: receipt.backendRequestToFirstRowMs,
    backendFirstRowToIpcBatchMs: receipt.backendFirstRowToIpcBatchMs,
    ipcPayloadBytes: receipt.ipcPayloadBytes,
    sqliteTransactionCount: receipt.sqliteTransactionCount,
    retainedBytes: receipt.retainedBytes,
  };
}
