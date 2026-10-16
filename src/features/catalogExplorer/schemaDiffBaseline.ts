// Remembers each schema group's chosen comparison baseline per workspace member, so the
// Schema Diff screen and the Explorer change chips always compare against one database.
// Storage is a per-viewer convenience: unavailable storage falls back to the session.
import { useCallback, useSyncExternalStore } from "react";

import type { SchemaConnectionGroup } from "../../lib/schemaDiff";

const STORAGE_PREFIX = "dopedb.schemaDiffBaseline";
const selections = new Map<string, string | null>();
const listeners = new Set<() => void>();
const annotated = new WeakMap<
  SchemaConnectionGroup,
  { baselineId: string | null; group: SchemaConnectionGroup }
>();
let version = 0;

function storageKey(scopeKey: string, groupKey: string) {
  return `${STORAGE_PREFIX}:${scopeKey}:${groupKey}`;
}

function readSelection(scopeKey: string, groupKey: string): string | null {
  const key = storageKey(scopeKey, groupKey);
  if (selections.has(key)) return selections.get(key) ?? null;
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(key);
  } catch {
    value = null;
  }
  selections.set(key, value);
  return value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentVersion() {
  return version;
}

/** Persists one group's baseline and re-renders every view comparing that group. */
export function selectSchemaDiffBaseline(
  scopeKey: string,
  groupKey: string,
  connectionId: string,
) {
  const key = storageKey(scopeKey, groupKey);
  selections.set(key, connectionId);
  try {
    window.localStorage.setItem(key, connectionId);
  } catch {
    // The choice still applies for this session.
  }
  version += 1;
  for (const listener of listeners) listener();
}

/** Returns groups annotated with the member's baseline, stable while nothing changes. */
export function useSchemaDiffBaselineGroups(scopeKey: string) {
  const selectionVersion = useSyncExternalStore(subscribe, currentVersion);
  return useCallback(
    (group: SchemaConnectionGroup): SchemaConnectionGroup => {
      // Reading the version ties the callback identity to the latest selection.
      void selectionVersion;
      const baselineId = readSelection(scopeKey, group.key);
      const cached = annotated.get(group);
      if (cached && cached.baselineId === baselineId) return cached.group;
      const next = { ...group, baselineId: baselineId ?? undefined };
      annotated.set(group, { baselineId, group: next });
      return next;
    },
    [scopeKey, selectionVersion],
  );
}
