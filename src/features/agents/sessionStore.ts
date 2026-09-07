// The ACP process inventory and backend event subscription are application state,
// not panel state. One external store closes the list/listen race once and lets the
// Agent tool window plus status bar observe the same authoritative projection.
import { useEffect, useMemo, useSyncExternalStore } from "react";

import type {
  AcpSessionChanged,
  AcpSessionFocus,
  AcpSessionId,
  AcpSessionSummary,
} from "./domain";
import { listAgentAcpSessions, onAgentAcpChanged } from "./tauriAdapter";
import {
  appendAcpConversationEvents,
  mergeAcpConversationFocus,
  type AcpConversationProjection,
} from "./transcript";

export type AcpSessionSnapshot = {
  scopeKey: string | null;
  sessions: readonly AcpSessionSummary[];
  projections: ReadonlyMap<AcpSessionId, AcpConversationProjection>;
  loading: boolean;
  error: unknown;
};

type Listener = () => void;
type LiveChangeListener = (change: AcpSessionChanged) => void;
const MAX_ACP_SESSION_PROJECTIONS = 16;

const EMPTY_SNAPSHOT: AcpSessionSnapshot = {
  scopeKey: null,
  sessions: [],
  projections: new Map(),
  loading: false,
  error: null,
};

function pendingSnapshot(scopeKey: string): AcpSessionSnapshot {
  return {
    scopeKey,
    sessions: [],
    projections: new Map(),
    loading: true,
    error: null,
  };
}

export function mergeAcpSessionSummaries(
  current: readonly AcpSessionSummary[],
  incoming: readonly AcpSessionSummary[],
): readonly AcpSessionSummary[] {
  if (incoming.length === 0) return current;
  const merged = new Map(current.map((session) => [session.id, session]));
  let changed = false;
  for (const session of incoming) {
    const previous = merged.get(session.id);
    if (previous && previous.updatedAt > session.updatedAt) continue;
    if (previous !== session) changed = true;
    merged.set(session.id, session);
  }
  return changed ? [...merged.values()] : current;
}

export class AcpSessionStore {
  private snapshot: AcpSessionSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<Listener>();
  private liveChangeListeners = new Set<LiveChangeListener>();
  private unlisten: (() => void) | null = null;
  private generation = 0;
  private pendingChanges = new Map<
    AcpSessionId,
    {
      session: AcpSessionSummary;
      events: NonNullable<AcpSessionChanged["event"]>[];
    }
  >();
  private cancelFlush: (() => void) | null = null;

  constructor(
    private readonly scheduleFlush = scheduleStreamingFrame,
  ) {}

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  observeLiveChanges = (listener: LiveChangeListener) => {
    this.liveChangeListeners.add(listener);
    return () => this.liveChangeListeners.delete(listener);
  };

  activate(scopeKey: string) {
    if (
      this.snapshot.scopeKey === scopeKey &&
      (this.snapshot.loading || this.snapshot.error === null)
    ) {
      return;
    }
    const generation = ++this.generation;
    this.unlisten?.();
    this.unlisten = null;
    this.pendingChanges.clear();
    this.cancelFlush?.();
    this.cancelFlush = null;
    this.publish({
      scopeKey,
      sessions: [],
      projections: new Map(),
      loading: true,
      error: null,
    });

    void onAgentAcpChanged((change) => {
      if (generation !== this.generation) return;
      this.queueChange(change);
    })
      .then((unlisten) => {
        if (generation !== this.generation) {
          unlisten();
          return;
        }
        this.unlisten = unlisten;
        return listAgentAcpSessions().then((sessions) => {
          if (generation !== this.generation) return;
          this.publish({
            ...this.snapshot,
            sessions: mergeAcpSessionSummaries(this.snapshot.sessions, sessions),
            loading: false,
            error: null,
          });
        });
      })
      .catch((error) => {
        if (generation !== this.generation) return;
        this.publish({ ...this.snapshot, loading: false, error });
      });
  }

  recordFocus(scopeKey: string, focus: AcpSessionFocus): boolean {
    if (this.snapshot.scopeKey !== scopeKey) return false;
    const sessions = mergeAcpSessionSummaries(
      this.snapshot.sessions,
      [focus.session],
    );
    const projections = new Map(this.snapshot.projections);
    touchProjection(
      projections,
      focus.session.id,
      mergeAcpConversationFocus(
        projections.get(focus.session.id),
        focus.events,
        focus.replayTruncated,
      ),
    );
    this.publish({ ...this.snapshot, sessions, projections });
    return true;
  }

  private applyChanges(
    changes: readonly {
      session: AcpSessionSummary;
      events: readonly NonNullable<AcpSessionChanged["event"]>[];
    }[],
  ) {
    let sessions = this.snapshot.sessions;
    const projections = this.snapshot.projections;
    let nextProjections: Map<AcpSessionId, AcpConversationProjection> | null =
      null;
    for (const change of changes) {
      sessions = mergeAcpSessionSummaries(sessions, [change.session]);
      if (change.events.length === 0) continue;
      const activeProjections = nextProjections ?? projections;
      const result = appendAcpConversationEvents(
        activeProjections.get(change.session.id),
        [...change.events],
      );
      nextProjections ??= new Map(projections);
      touchProjection(nextProjections, change.session.id, result.projection);
    }
    const publishedProjections = nextProjections ?? projections;
    if (
      sessions === this.snapshot.sessions &&
      publishedProjections === this.snapshot.projections
    ) {
      return;
    }
    this.publish({
      ...this.snapshot,
      sessions,
      projections: publishedProjections,
    });
  }

  private queueChange(change: AcpSessionChanged) {
    // Only the Tauri listener enters this path. Focus replay deliberately bypasses
    // it so one live outcome cannot be counted again when a transcript is reopened.
    for (const listener of this.liveChangeListeners) {
      try {
        listener(change);
      } catch {
        // Outcome observation is best-effort and must never interrupt the
        // authoritative session projection.
      }
    }
    const pending = this.pendingChanges.get(change.session.id);
    const session =
      pending && pending.session.updatedAt > change.session.updatedAt
        ? pending.session
        : change.session;
    this.pendingChanges.set(change.session.id, {
      session,
      events: pending?.events ?? [],
    });
    if (change.event) this.pendingChanges.get(change.session.id)!.events.push(change.event);
    if (isProjectionBoundary(change.event)) {
      this.flushChanges();
      return;
    }
    if (this.cancelFlush) return;
    this.cancelFlush = this.scheduleFlush(() => this.flushChanges());
  }

  private flushChanges() {
    this.cancelFlush?.();
    this.cancelFlush = null;
    if (this.pendingChanges.size === 0) return;
    const pending = [...this.pendingChanges.values()];
    this.pendingChanges.clear();
    this.applyChanges(pending);
  }

  private publish(snapshot: AcpSessionSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

// Token bursts share one paint, while permission/turn boundaries flush at once.
// A bounded timer also drains the queue when a hidden WebView suspends frames.
function scheduleStreamingFrame(flush: () => void): () => void {
  let completed = false;
  let frame: number | null = null;
  const finish = () => {
    if (completed) return;
    cancel();
    flush();
  };
  const timer = setTimeout(finish, 50);
  const cancel = () => {
    completed = true;
    clearTimeout(timer);
    if (frame !== null) cancelAnimationFrame(frame);
  };
  if (typeof requestAnimationFrame === "function") {
    frame = requestAnimationFrame(finish);
  }
  return cancel;
}

export const acpSessionStore = new AcpSessionStore();

export function useAcpSessionSnapshot(scopeKey: string, enabled = true) {
  useEffect(() => {
    if (enabled) acpSessionStore.activate(scopeKey);
  }, [enabled, scopeKey]);
  const snapshot = useSyncExternalStore(
    acpSessionStore.subscribe,
    acpSessionStore.getSnapshot,
    acpSessionStore.getSnapshot,
  );
  return useMemo(
    () => snapshot.scopeKey === scopeKey
      ? snapshot
      : enabled
        ? pendingSnapshot(scopeKey)
        : EMPTY_SNAPSHOT,
    [enabled, scopeKey, snapshot],
  );
}

export function retryAcpSessionSnapshot(scopeKey: string) {
  acpSessionStore.activate(scopeKey);
}

export function recordAcpSessionFocus(
  scopeKey: string,
  focus: AcpSessionFocus,
) {
  return acpSessionStore.recordFocus(scopeKey, focus);
}

/** Observe only new ACP changes from the native event stream, never focus replay. */
export function observeLiveAcpSessionChanges(listener: LiveChangeListener) {
  return acpSessionStore.observeLiveChanges(listener);
}

function isProjectionBoundary(change: AcpSessionChanged["event"]) {
  if (!change || change.type !== "sessionUpdate") return true;
  const update = change.update.sessionUpdate;
  return update !== "agent_message_chunk" && update !== "agent_thought_chunk";
}

function touchProjection(
  projections: Map<AcpSessionId, AcpConversationProjection>,
  sessionId: AcpSessionId,
  projection: AcpConversationProjection,
) {
  projections.delete(sessionId);
  projections.set(sessionId, projection);
  while (projections.size > MAX_ACP_SESSION_PROJECTIONS) {
    const oldestSessionId = projections.keys().next().value;
    if (oldestSessionId === undefined) break;
    projections.delete(oldestSessionId);
  }
}
