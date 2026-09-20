// Member-local record of which persisted SQL documents stay on the tab strip.
// Closing a tab never deletes its document, so the open set is a display
// preference kept in browser storage and keyed by workspace, account, and
// connection. A missing entry means "never recorded" and restores everything
// once; a stored empty list means the member closed every tab.

import type { CatalogScope } from "../../lib/queries";

export type WorkbenchTabScope = Pick<
  CatalogScope,
  "workspaceKind" | "workspaceId" | "accountScope"
>;

export interface StoredOpenTabs {
  /** Persisted SQL document ids, in tab-strip order. */
  open: string[];
  /** The active persisted SQL document id, always a member of `open`. */
  active: string | null;
}

const STORAGE_PREFIX = "dopedb.workbench-open-tabs.v1";
const MAX_STORED_TABS = 128;

/** `null` disables persistence rather than sharing one bucket across scopes. */
export function workbenchTabScopeKey(scope: WorkbenchTabScope): string | null {
  return scope.workspaceKind && scope.workspaceId
    ? `${scope.workspaceKind}:${scope.workspaceId}:account:${scope.accountScope ?? "anonymous"}`
    : null;
}

export function openTabStorageKey(
  scopeKey: string | null,
  connectionId: string,
): string | null {
  return scopeKey
    ? `${STORAGE_PREFIX}:${encodeURIComponent(scopeKey)}:${encodeURIComponent(connectionId)}`
    : null;
}

export function parseOpenTabs(value: unknown): StoredOpenTabs | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { open?: unknown; active?: unknown };
  if (!Array.isArray(candidate.open)) return null;
  const open = new Set<string>();
  for (const entry of candidate.open) {
    if (typeof entry !== "string" || open.has(entry)) continue;
    if (open.size >= MAX_STORED_TABS) break;
    open.add(entry);
  }
  return {
    open: [...open],
    active:
      typeof candidate.active === "string" && open.has(candidate.active)
        ? candidate.active
        : null,
  };
}

/**
 * `null` means no usable record, so the caller keeps the restore-everything
 * default. An unreadable or malformed entry must not look like "closed all".
 */
export function readOpenTabs(key: string | null): StoredOpenTabs | null {
  if (!key || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : parseOpenTabs(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Throws when the browser rejects the write so the caller can surface it. */
export function writeOpenTabs(key: string | null, value: StoredOpenTabs) {
  if (!key || typeof localStorage === "undefined") return;
  const open = value.open.slice(0, MAX_STORED_TABS);
  localStorage.setItem(
    key,
    JSON.stringify({
      open,
      active: value.active !== null && open.includes(value.active)
        ? value.active
        : null,
    }),
  );
}
