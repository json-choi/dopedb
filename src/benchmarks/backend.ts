import { invoke } from "../ipc/core";

export type PackagedBackendAction =
  | "query-first-batch"
  | "query-page-store-1m"
  | "query-start-cancellable-export"
  | "query-cancel"
  | "query-export"
  | "agent-stream-10k"
  | "agent-skill-reload"
  | "history-10k"
  | "audit-100k"
  | "local-history-50"
  | "analysis-article-local-results";

export type PackagedBackendReceipt = {
  action: PackagedBackendAction;
  backendRequestToFirstRowMs: number | null;
  backendFirstRowToIpcBatchMs: number | null;
  ipcPayloadBytes: number;
  sqliteTransactionCount: number;
  retainedBytes: number;
  rowCount: number;
  columns: string[];
  rows: number[][];
};

export function runPackagedBenchmarkBackend(
  action: PackagedBackendAction,
): Promise<PackagedBackendReceipt> {
  return invoke("run_packaged_benchmark_backend", { action });
}
