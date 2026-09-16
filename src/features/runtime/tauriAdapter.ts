// Runtime commands the renderer needs from Rust: startup marks, and the packaged
// benchmark's configuration, workload preparation, completion and failure paths.
// The metrics type here is the wire contract the benchmark harness reads back.
import { invoke } from "../../ipc/core";

export type PackagedBenchmarkRendererMetrics = {
  rendererElapsedMs: number;
  reactCommitCount: number;
  reactCommitDurationMs: number;
  maxReactCommitDurationMs: number;
  longTaskSupported: boolean;
  longTaskCount: number;
  maxLongTaskMs: number;
  frameSampleCount: number;
  frameOver50MsCount: number;
  maxFrameGapMs: number;
  ipcCallCount: number;
  ipcTotalDurationMs: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  webviewEngine: "webkit" | "webview2" | "unknown";
  webviewVersion: string;
  actions: Array<{
    name: string;
    samplesMs: number[];
    reactCommitCount: number;
    reactCommitDurationMs: number;
    maxFrameGapMs: number;
    frameSampleCount: number;
    droppedFrameCount: number;
    ipcCallCount: number;
    ipcDurationMs: number;
    ipcPayloadBytes: number;
    sqliteTransactionCount: number;
    retainedBytes: number;
    backendRequestToFirstRowMs: number | null;
    backendFirstRowToIpcBatchMs: number | null;
    ipcBatchToReactCommitMs: number | null;
    backendRequestToFirstRowSamplesMs: number[];
    backendFirstRowToIpcBatchSamplesMs: number[];
    ipcBatchToReactCommitSamplesMs: number[];
    operationClaimMs: number | null;
    poolConnectStartMs: number | null;
    poolConnectReadyMs: number | null;
    backendExecuteStartMs: number | null;
    firstRowMs: number | null;
    firstIpcBatchMs: number | null;
    operationClaimSamplesMs: number[];
    poolConnectStartSamplesMs: number[];
    poolConnectReadySamplesMs: number[];
    backendExecuteStartSamplesMs: number[];
    firstRowSamplesMs: number[];
    firstIpcBatchSamplesMs: number[];
  }>;
  idleObservationMs: number;
  idleIpcCallCount: number;
  webviewHeapBytes: number | null;
};

export type PackagedBenchmarkConfig = {
  scenario: string;
  kind: "startup" | "workload" | "qa";
  phase: "install" | "restart" | null;
};

export function recordStartupMark(
  mark: "first_shell_commit" | "selected_connection_restored",
  succeeded = true,
): Promise<void> {
  return invoke("record_startup_mark", { mark, succeeded });
}

export function packagedBenchmarkConfig(): Promise<PackagedBenchmarkConfig> {
  return invoke("packaged_benchmark_config");
}

export function preparePackagedBenchmarkWorkload(): Promise<void> {
  return invoke("prepare_packaged_benchmark_workload");
}

export function setPackagedBenchmarkCompactWindow(compact: boolean): Promise<void> {
  return invoke("set_packaged_benchmark_compact_window", { compact });
}

export function completePackagedBenchmark(
  metrics: PackagedBenchmarkRendererMetrics,
): Promise<void> {
  return invoke("complete_packaged_benchmark", { metrics });
}

export type PackagedBenchmarkFailureReason =
  | "surface_unavailable"
  | "paint_timeout"
  | "backend_command"
  | "accessibility_contract"
  | "viewport_contract"
  | "locale_contract"
  | "keyboard_contract"
  | "skill_state"
  | "type_error"
  | "range_error"
  | "unexpected";

export function failPackagedBenchmark(
  phase: string,
  reason: PackagedBenchmarkFailureReason,
): Promise<void> {
  return invoke("fail_packaged_benchmark", { phase, reason });
}
