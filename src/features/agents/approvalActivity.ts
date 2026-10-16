// Process-local projections of Agent work the status bar shows outside AI Chat.
// Approved proposals executing now: the approval card is the only writer of
// runs; the card and the status bar can both stop one through the executor's
// cancel path, and the card reads back that a stop was requested so the outcome
// is described as such. Session starts a person is waiting on: only the startup
// hook writes them, so a silent background preparation never appears.
import { useSyncExternalStore } from "react";

import { cancelQuery } from "../queries/tauriAdapter";
import type { AgentProvider } from "./domain";

export type AgentApprovalRun = {
  operationId: string;
  connectionId: string;
  connectionName: string;
  startedAt: number;
  /** A stop was requested; the executor decides whether anything committed. */
  stopping?: boolean;
};

let runs: readonly AgentApprovalRun[] = [];
const stopRequests = new Set<string>();
const listeners = new Set<() => void>();
// A stop pressed between approval and the executor's cancel registration is
// retried briefly; the run either reaches the executor or ends meanwhile.
const STOP_RETRY_ATTEMPTS = 40;
const STOP_RETRY_DELAY_MS = 150;

function publish(next: readonly AgentApprovalRun[]) {
  runs = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return runs;
}

/** Record one approved execution; the returned callback ends it exactly once. */
export function beginAgentApprovalRun(run: AgentApprovalRun): () => void {
  stopRequests.delete(run.operationId);
  publish([
    ...runs.filter((current) => current.operationId !== run.operationId),
    { ...run, stopping: false },
  ]);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    publish(runs.filter((current) => current.operationId !== run.operationId));
  };
}

function setStopping(operationId: string, stopping: boolean) {
  publish(
    runs.map((run) => (run.operationId === operationId ? { ...run, stopping } : run)),
  );
}

const isRunning = (operationId: string) =>
  runs.some((run) => run.operationId === operationId);

/**
 * Stop one approved execution through the same executor cancel path as any
 * Desktop query. The executor registers its cancel only once the run reaches
 * it, so a stop pressed earlier is retried until it lands or the run ends.
 * Resolves `true` once the executor accepted the stop and `false` when the run
 * ended first; only an accepted stop keeps the run marked as stopping.
 */
export async function stopAgentApprovalRun(operationId: string): Promise<boolean> {
  stopRequests.add(operationId);
  setStopping(operationId, true);
  try {
    for (let attempt = 0; attempt < STOP_RETRY_ATTEMPTS; attempt += 1) {
      if (await cancelQuery(operationId)) return true;
      if (!isRunning(operationId)) break;
      await new Promise((resolve) => setTimeout(resolve, STOP_RETRY_DELAY_MS));
    }
  } catch (reason) {
    stopRequests.delete(operationId);
    setStopping(operationId, false);
    throw reason;
  }
  // The run finished before the executor saw the stop: its stored outcome is
  // the truth, so nothing is reported as stopped.
  stopRequests.delete(operationId);
  setStopping(operationId, false);
  return false;
}

/** True once when a stop was requested for this run, from the card or the status bar. */
export function consumeAgentApprovalStop(operationId: string): boolean {
  return stopRequests.delete(operationId);
}

/** Approved Agent changes currently executing, newest last. */
export function useAgentApprovalRuns() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// Foreground starts per connection and provider; the backend cannot tell a
// person's start from a background preparation, so this registry does.
const foregroundStarts = new Map<string, number>();
let foregroundStartKeys: ReadonlySet<string> = new Set();
const startListeners = new Set<() => void>();

function publishStarts() {
  foregroundStartKeys = new Set(foregroundStarts.keys());
  for (const listener of startListeners) listener();
}

function subscribeStarts(listener: () => void) {
  startListeners.add(listener);
  return () => {
    startListeners.delete(listener);
  };
}

const startSnapshot = () => foregroundStartKeys;

export function agentStartKey(connectionId: string, provider: AgentProvider) {
  return `${connectionId}:${provider}`;
}

/** Record a start a person is waiting on; the callback ends it exactly once. */
export function beginForegroundAgentStart(
  connectionId: string,
  provider: AgentProvider,
): () => void {
  const key = agentStartKey(connectionId, provider);
  foregroundStarts.set(key, (foregroundStarts.get(key) ?? 0) + 1);
  publishStarts();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    const remaining = (foregroundStarts.get(key) ?? 1) - 1;
    if (remaining > 0) foregroundStarts.set(key, remaining);
    else foregroundStarts.delete(key);
    publishStarts();
  };
}

/** `agentStartKey`s of the starts a person is waiting on now. */
export function useForegroundAgentStarts() {
  return useSyncExternalStore(subscribeStarts, startSnapshot, startSnapshot);
}
