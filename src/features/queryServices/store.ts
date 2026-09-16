// Owns bounded, scope-keyed query-service snapshots and lightweight activity subscriptions.

import { useSyncExternalStore } from "react";

import type {
  QueryServiceSession,
  QueryServiceStatus,
} from "./domain";

const MAX_SESSIONS = 20;

export type QueryServiceSnapshot = {
  scopeKey: string;
  sessions: readonly QueryServiceSession[];
  activeSessionId: string | null;
};

export type QueryServiceActivity = {
  id: string;
  connectionId: string;
  connectionName: string;
  consoleTitle: string;
  status: Extract<QueryServiceStatus, "running" | "waiting">;
  updatedAt: number;
};

type Listener = () => void;

function mergeSessions(
  current: readonly QueryServiceSession[],
  incoming: readonly QueryServiceSession[],
) {
  let changed = false;
  const byId = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) {
    const previous = byId.get(session.id);
    if (!previous || session.updatedAt >= previous.updatedAt) {
      if (previous !== session) changed = true;
      byId.set(session.id, session);
    }
  }
  if (!changed) return current;
  return [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SESSIONS);
}

function activityFor(session: QueryServiceSession): QueryServiceActivity | null {
  if (session.status !== "running" && session.status !== "waiting") return null;
  return {
    id: session.id,
    connectionId: session.connectionId,
    connectionName: session.connectionName,
    consoleTitle: session.consoleTitle,
    status: session.status,
    updatedAt: session.updatedAt,
  };
}

function sameActivity(
  left: QueryServiceActivity,
  right: QueryServiceActivity,
) {
  return (
    left.id === right.id &&
    left.connectionId === right.connectionId &&
    left.connectionName === right.connectionName &&
    left.consoleTitle === right.consoleTitle &&
    left.status === right.status
  );
}

/**
 * Query result progress is intentionally outside AppShell React state. The full
 * snapshot wakes only the Services tool window, while the activity projection
 * wakes shell status consumers only when a query enters or leaves a lifecycle
 * state. Row-count-only batches therefore cannot reconcile Explorer or Agent.
 */
export class QueryServiceStore {
  private snapshot: QueryServiceSnapshot;
  private activities: readonly QueryServiceActivity[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly activityListeners = new Set<Listener>();

  constructor(scopeKey: string) {
    this.snapshot = {
      scopeKey,
      sessions: [],
      activeSessionId: null,
    };
  }

  getSnapshot = () => this.snapshot;

  getActivitySnapshot = () => this.activities;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeActivity = (listener: Listener) => {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  };

  session(id: string) {
    return this.snapshot.sessions.find((session) => session.id === id) ?? null;
  }

  replaceScope(scopeKey: string, sessions: readonly QueryServiceSession[] = []) {
    const nextSessions = mergeSessions([], sessions);
    this.publish({
      scopeKey,
      sessions: nextSessions,
      activeSessionId: nextSessions[0]?.id ?? null,
    });
  }

  merge(sessions: readonly QueryServiceSession[]) {
    if (sessions.length === 0) return;
    const nextSessions = mergeSessions(this.snapshot.sessions, sessions);
    if (nextSessions === this.snapshot.sessions) return;
    const activeSessionId =
      this.snapshot.activeSessionId &&
      nextSessions.some((session) => session.id === this.snapshot.activeSessionId)
        ? this.snapshot.activeSessionId
        : nextSessions[0]?.id ?? null;
    this.publish({ ...this.snapshot, sessions: nextSessions, activeSessionId });
  }

  activate(id: string) {
    if (
      id === this.snapshot.activeSessionId ||
      !this.snapshot.sessions.some((session) => session.id === id)
    ) {
      return;
    }
    this.publish({ ...this.snapshot, activeSessionId: id }, false);
  }

  private publish(next: QueryServiceSnapshot, projectActivity = true) {
    this.snapshot = next;
    if (projectActivity) this.publishActivities(next.sessions);
    for (const listener of this.listeners) listener();
  }

  private publishActivities(sessions: readonly QueryServiceSession[]) {
    const projected = sessions.flatMap((session) => {
      const activity = activityFor(session);
      return activity ? [activity] : [];
    });
    if (
      projected.length === this.activities.length &&
      projected.every((activity, index) =>
        sameActivity(activity, this.activities[index])
      )
    ) {
      return;
    }
    this.activities = projected;
    for (const listener of this.activityListeners) listener();
  }
}

export function useQueryServiceSnapshot(store: QueryServiceStore) {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

export function useQueryServiceActivities(store: QueryServiceStore) {
  return useSyncExternalStore(
    store.subscribeActivity,
    store.getActivitySnapshot,
    store.getActivitySnapshot,
  );
}
