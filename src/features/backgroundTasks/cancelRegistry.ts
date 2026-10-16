// Entry point that lets the status bar stop work it does not own. The feature that
// started a run registers the exact cancel path it already uses (for SQL, the
// workbench's stream or operation cancel), so the status bar never re-implements
// a cancel command or guesses an operation id. The registration is removed when
// the run settles; a task without one is shown without a Stop control.
import { useSyncExternalStore } from "react";

export type BackgroundTaskCancel = () => void | Promise<unknown>;

let cancels: ReadonlyMap<string, BackgroundTaskCancel> = new Map();
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, BackgroundTaskCancel>) {
  cancels = next;
  for (const listener of listeners) listener();
}

/** Status-bar key of a running SQL session (`QueryServiceActivity.id`). */
export function queryTaskKey(sessionId: string): string {
  return `query:${sessionId}`;
}

/**
 * Register how to stop a running task. Returns the unregister callback, which
 * removes only this registration even if the key was registered again.
 */
export function registerBackgroundTaskCancel(
  key: string,
  cancel: BackgroundTaskCancel,
): () => void {
  const next = new Map(cancels);
  next.set(key, cancel);
  publish(next);
  return () => {
    if (cancels.get(key) !== cancel) return;
    const remaining = new Map(cancels);
    remaining.delete(key);
    publish(remaining);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return cancels;
}

/** Registered cancel paths keyed like `BackgroundTask.key`. */
export function useBackgroundTaskCancels(): ReadonlyMap<string, BackgroundTaskCancel> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
