// Module-scoped store for unsaved SQL text, keyed by document id and held outside React so
// typing never re-renders the shell. Retention is bounded and only entries without a mounted
// subscriber are evicted, oldest first.
import { useCallback, useSyncExternalStore } from "react";

const MAX_RETAINED_DRAFTS = 64;

interface DraftEntry {
  value: string;
  listeners: Set<() => void>;
}

const drafts = new Map<string, DraftEntry>();

function trimDrafts() {
  while (drafts.size > MAX_RETAINED_DRAFTS) {
    const evictable = [...drafts].find(([, entry]) => entry.listeners.size === 0);
    if (!evictable) return;
    drafts.delete(evictable[0]);
  }
}

export function seedWorkbenchDraft(documentId: string, fallback: string) {
  const current = drafts.get(documentId);
  if (current) {
    // An inactive entry can outlive a closed tab. Reconcile it with the
    // freshly restored document so a newer remote revision is never hidden by
    // an old in-memory draft. Active entries remain authoritative while their
    // editor is mounted.
    if (current.listeners.size === 0 && current.value !== fallback) {
      current.value = fallback;
      drafts.delete(documentId);
      drafts.set(documentId, current);
    }
    return;
  }
  drafts.set(documentId, { value: fallback, listeners: new Set() });
  trimDrafts();
}

export function publishWorkbenchDraft(documentId: string, value: string) {
  const current = drafts.get(documentId);
  if (current?.value === value) return;
  const entry = current ?? { value, listeners: new Set<() => void>() };
  entry.value = value;
  // Refresh insertion order so inactive documents are evicted oldest-first.
  drafts.delete(documentId);
  drafts.set(documentId, entry);
  trimDrafts();
  entry.listeners.forEach((listener) => listener());
}

export function readWorkbenchDraft(documentId: string, fallback: string) {
  return drafts.get(documentId)?.value ?? fallback;
}

function subscribeWorkbenchDraft(documentId: string, listener: () => void) {
  const entry = drafts.get(documentId);
  if (!entry) return () => undefined;
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

/** Subscribes only the active SQL surface, never AppShell or its tool windows. */
export function useWorkbenchDraft(documentId: string, fallback: string) {
  seedWorkbenchDraft(documentId, fallback);
  const subscribe = useCallback(
    (listener: () => void) => subscribeWorkbenchDraft(documentId, listener),
    [documentId],
  );
  const getSnapshot = useCallback(
    () => readWorkbenchDraft(documentId, fallback),
    [documentId, fallback],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
