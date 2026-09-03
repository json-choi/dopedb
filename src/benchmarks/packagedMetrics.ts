import type { ProfilerOnRenderCallback } from "react";

const enabled = import.meta.env.VITE_DOPEDB_PACKAGED_BENCHMARK === "1";
const startedAt = performance.now();
// This guard detects a renderer that has stopped painting; it is not an action
// budget. The largest paint-bound action has a 15 second performance budget, so
// the guard must allow that measurement to finish and be judged by the budget.
const PAINT_CHECKPOINT_TIMEOUT_MS = 30_000;

let reactCommitCount = 0;
let reactCommitDurationMs = 0;
let maxReactCommitDurationMs = 0;
let maxActionReactCommitDurationMs = 0;
let ipcCallCount = 0;
let ipcTotalDurationMs = 0;
let longTaskCount = 0;
let maxLongTaskMs = 0;
let actionLongTaskCount = 0;
let maxActionLongTaskMs = 0;
let frameSampleCount = 0;
let frameOver50MsCount = 0;
let maxFrameGapMs = 0;
let previousFrame: number | null = null;
let frameHandle: number | null = null;
let longTaskObserver: PerformanceObserver | null = null;
let idleObservationMs = 0;
let idleIpcCallCount = 0;

type ActionWindow = {
  startedAt: number;
  endedAt: number | null;
};

const actionWindows: ActionWindow[] = [];

export type PackagedBenchmarkActionName =
  | "sql-editor-10k-type"
  | "sql-editor-10k-cursor"
  | "sql-editor-10k-format"
  | "sql-editor-10k-run"
  | "sql-editor-100k-type"
  | "sql-editor-100k-cursor"
  | "sql-editor-100k-format"
  | "sql-editor-100k-run"
  | "sql-editor-1m-type"
  | "sql-editor-1m-cursor"
  | "sql-editor-1m-format"
  | "sql-editor-1m-run"
  | "sql-editor-1m-scroll"
  | "explorer-first-expand"
  | "explorer-secondary-expand"
  | "search-everywhere"
  | "query-first-batch"
  | "query-grid-scroll-50k"
  | "query-page-store-1m"
  | "query-cancel"
  | "query-export"
  | "table-first-page-cold"
  | "table-first-page"
  | "agent-stream-10k"
  | "agent-manual-scroll"
  | "agent-permission"
  | "agent-reconnect"
  | "agent-skill-install-all"
  | "agent-skill-reload"
  | "agent-skill-remove-all"
  | "history-10k"
  | "audit-100k"
  | "local-history-50"
  | "analysis-article-local-results"
  | "erd-drag-1k"
  | "grid-and-pane-resize"
  | "workbench-scroll-continuity";

export type PackagedActionEvidence = {
  ipcPayloadBytes?: number;
  sqliteTransactionCount?: number;
  retainedBytes?: number;
  backendRequestToFirstRowMs?: number | null;
  backendFirstRowToIpcBatchMs?: number | null;
  ipcBatchToReactCommitMs?: number | null;
  operationClaimMs?: number | null;
  poolConnectStartMs?: number | null;
  poolConnectReadyMs?: number | null;
  backendExecuteStartMs?: number | null;
  firstRowMs?: number | null;
  firstIpcBatchMs?: number | null;
  /** Renderer-clock timestamp used only to close the IPC-to-paint interval. */
  ipcBatchAcceptedAtMs?: number | null;
};

type PackagedActionMetrics = {
  name: PackagedBenchmarkActionName;
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
};

const actions = new Map<PackagedBenchmarkActionName, PackagedActionMetrics>();
let activeAction: PackagedBenchmarkActionName | null = null;
const actionFrameGaps = new Map<PackagedBenchmarkActionName, number>();

const longTaskSupported = enabled
  && typeof PerformanceObserver !== "undefined"
  && PerformanceObserver.supportedEntryTypes.includes("longtask");

if (longTaskSupported) {
  longTaskObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTaskCount += 1;
      maxLongTaskMs = Math.max(maxLongTaskMs, entry.duration);
      const belongsToAction = actionWindows.some(
        ({ startedAt, endedAt }) =>
          entry.startTime >= startedAt
          && (endedAt === null || entry.startTime <= endedAt),
      );
      if (belongsToAction) {
        actionLongTaskCount += 1;
        maxActionLongTaskMs = Math.max(maxActionLongTaskMs, entry.duration);
      }
    }
  });
  longTaskObserver.observe({ entryTypes: ["longtask"] });
}

function sampleFrame(timestamp: number) {
  if (previousFrame !== null) {
    const gap = Math.max(0, timestamp - previousFrame);
    frameSampleCount += 1;
    maxFrameGapMs = Math.max(maxFrameGapMs, gap);
    if (gap > 50) frameOver50MsCount += 1;
    if (activeAction !== null) {
      actionFrameGaps.set(
        activeAction,
        Math.max(actionFrameGaps.get(activeAction) ?? 0, gap),
      );
    }
  }
  previousFrame = timestamp;
  frameHandle = window.requestAnimationFrame(sampleFrame);
}

if (enabled) frameHandle = window.requestAnimationFrame(sampleFrame);

export const recordReactCommit: ProfilerOnRenderCallback = (
  _id,
  _phase,
  actualDuration,
) => {
  reactCommitCount += 1;
  reactCommitDurationMs += actualDuration;
  maxReactCommitDurationMs = Math.max(maxReactCommitDurationMs, actualDuration);
  if (activeAction !== null) {
    maxActionReactCommitDurationMs = Math.max(
      maxActionReactCommitDurationMs,
      actualDuration,
    );
  }
};

export function recordBenchmarkIpc(durationMs: number) {
  ipcCallCount += 1;
  ipcTotalDurationMs += Math.max(0, durationMs);
}

type CounterSnapshot = {
  reactCommitCount: number;
  reactCommitDurationMs: number;
  frameSampleCount: number;
  frameOver50MsCount: number;
  ipcCallCount: number;
  ipcTotalDurationMs: number;
};

function counters(): CounterSnapshot {
  return {
    reactCommitCount,
    reactCommitDurationMs,
    frameSampleCount,
    frameOver50MsCount,
    ipcCallCount,
    ipcTotalDurationMs,
  };
}

export function waitForPackagedPaint(): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("packaged benchmark paint checkpoint timed out"));
    }, PAINT_CHECKPOINT_TIMEOUT_MS);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    }));
  });
}

function finiteMetric(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

function appendMetricSample(
  samples: number[],
  value: number | null | undefined,
) {
  const metric = finiteMetric(value);
  if (metric != null) samples.push(metric);
  return metric;
}

export async function measurePackagedAction(
  name: PackagedBenchmarkActionName,
  action: () => void | PackagedActionEvidence | Promise<void | PackagedActionEvidence>,
) {
  activeAction = name;
  const before = counters();
  const started = performance.now();
  const actionWindow: ActionWindow = { startedAt: started, endedAt: null };
  actionWindows.push(actionWindow);
  const evidence = (await action()) ?? {};
  const ipcBatchArrivedAt = finiteMetric(evidence.ipcBatchAcceptedAtMs)
    ?? performance.now();
  await waitForPackagedPaint();
  const paintedAt = performance.now();
  actionWindow.endedAt = paintedAt;
  const elapsed = paintedAt - started;
  const after = counters();
  const current = actions.get(name) ?? {
    name,
    samplesMs: [],
    reactCommitCount: 0,
    reactCommitDurationMs: 0,
    maxFrameGapMs: 0,
    frameSampleCount: 0,
    droppedFrameCount: 0,
    ipcCallCount: 0,
    ipcDurationMs: 0,
    ipcPayloadBytes: 0,
    sqliteTransactionCount: 0,
    retainedBytes: 0,
    backendRequestToFirstRowMs: null,
    backendFirstRowToIpcBatchMs: null,
    ipcBatchToReactCommitMs: null,
    backendRequestToFirstRowSamplesMs: [],
    backendFirstRowToIpcBatchSamplesMs: [],
    ipcBatchToReactCommitSamplesMs: [],
    operationClaimMs: null,
    poolConnectStartMs: null,
    poolConnectReadyMs: null,
    backendExecuteStartMs: null,
    firstRowMs: null,
    firstIpcBatchMs: null,
    operationClaimSamplesMs: [],
    poolConnectStartSamplesMs: [],
    poolConnectReadySamplesMs: [],
    backendExecuteStartSamplesMs: [],
    firstRowSamplesMs: [],
    firstIpcBatchSamplesMs: [],
  } satisfies PackagedActionMetrics;
  current.samplesMs.push(elapsed);
  current.reactCommitCount += after.reactCommitCount - before.reactCommitCount;
  current.reactCommitDurationMs +=
    after.reactCommitDurationMs - before.reactCommitDurationMs;
  current.maxFrameGapMs = Math.max(
    current.maxFrameGapMs,
    actionFrameGaps.get(name) ?? 0,
  );
  current.frameSampleCount += after.frameSampleCount - before.frameSampleCount;
  current.droppedFrameCount +=
    after.frameOver50MsCount - before.frameOver50MsCount;
  current.ipcCallCount += after.ipcCallCount - before.ipcCallCount;
  current.ipcDurationMs += after.ipcTotalDurationMs - before.ipcTotalDurationMs;
  current.ipcPayloadBytes += Math.max(0, evidence.ipcPayloadBytes ?? 0);
  current.sqliteTransactionCount += Math.max(
    0,
    evidence.sqliteTransactionCount ?? 0,
  );
  current.retainedBytes = Math.max(
    current.retainedBytes,
    Math.max(0, evidence.retainedBytes ?? 0),
  );
  current.backendRequestToFirstRowMs = appendMetricSample(
    current.backendRequestToFirstRowSamplesMs,
    evidence.backendRequestToFirstRowMs,
  );
  current.backendFirstRowToIpcBatchMs = appendMetricSample(
    current.backendFirstRowToIpcBatchSamplesMs,
    evidence.backendFirstRowToIpcBatchMs,
  );
  current.ipcBatchToReactCommitMs = appendMetricSample(
    current.ipcBatchToReactCommitSamplesMs,
    evidence.ipcBatchToReactCommitMs ??
      (evidence.backendRequestToFirstRowMs != null
        ? paintedAt - ipcBatchArrivedAt
        : null),
  );
  current.operationClaimMs = appendMetricSample(
    current.operationClaimSamplesMs,
    evidence.operationClaimMs,
  );
  current.poolConnectStartMs = appendMetricSample(
    current.poolConnectStartSamplesMs,
    evidence.poolConnectStartMs,
  );
  current.poolConnectReadyMs = appendMetricSample(
    current.poolConnectReadySamplesMs,
    evidence.poolConnectReadyMs,
  );
  current.backendExecuteStartMs = appendMetricSample(
    current.backendExecuteStartSamplesMs,
    evidence.backendExecuteStartMs,
  );
  current.firstRowMs = appendMetricSample(
    current.firstRowSamplesMs,
    evidence.firstRowMs,
  );
  current.firstIpcBatchMs = appendMetricSample(
    current.firstIpcBatchSamplesMs,
    evidence.firstIpcBatchMs,
  );
  actions.set(name, current);
  activeAction = null;
}

export function currentPackagedAction() {
  return activeAction;
}

export async function measurePackagedIdle(durationMs: number) {
  const before = ipcCallCount;
  const started = performance.now();
  await new Promise((resolve) => window.setTimeout(resolve, durationMs));
  idleObservationMs += performance.now() - started;
  idleIpcCallCount += ipcCallCount - before;
}

function webviewIdentity() {
  const userAgent = navigator.userAgent;
  const webview2 = /Edg\/([0-9._-]+)/.exec(userAgent);
  if (webview2) {
    return { webviewEngine: "webview2" as const, webviewVersion: webview2[1] };
  }
  const webkit = /AppleWebKit\/([0-9._-]+)/.exec(userAgent);
  if (webkit) {
    return { webviewEngine: "webkit" as const, webviewVersion: webkit[1] };
  }
  return { webviewEngine: "unknown" as const, webviewVersion: "unknown" };
}

export function packagedRendererMetrics() {
  if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
  longTaskObserver?.disconnect();
  // Startup samples have no named actions and must include the initial shell
  // mount. Workload samples own a narrower contract: setup and navigation
  // between surfaces are not attributed to the actions being budgeted.
  const budgetedReactCommitDurationMs = actions.size > 0
    ? maxActionReactCommitDurationMs
    : maxReactCommitDurationMs;
  const budgetedLongTaskCount = actions.size > 0
    ? actionLongTaskCount
    : longTaskCount;
  const budgetedLongTaskDurationMs = actions.size > 0
    ? maxActionLongTaskMs
    : maxLongTaskMs;
  return {
    rendererElapsedMs: performance.now() - startedAt,
    reactCommitCount,
    reactCommitDurationMs,
    maxReactCommitDurationMs: budgetedReactCommitDurationMs,
    longTaskSupported,
    longTaskCount: budgetedLongTaskCount,
    maxLongTaskMs: budgetedLongTaskDurationMs,
    frameSampleCount,
    frameOver50MsCount,
    maxFrameGapMs,
    ipcCallCount,
    ipcTotalDurationMs,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    actions: [...actions.values()],
    idleObservationMs,
    idleIpcCallCount,
    webviewHeapBytes: webviewHeapBytes(),
    ...webviewIdentity(),
  };
}

function webviewHeapBytes() {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  const bytes = memory?.usedJSHeapSize;
  return Number.isFinite(bytes) && (bytes ?? 0) >= 0 ? Math.round(bytes!) : null;
}
