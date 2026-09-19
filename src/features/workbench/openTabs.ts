// Member-local persistence for the workbench open-tab set. Closing a tab hides a
// saved SQL document instead of deleting it, so which documents stay open, in what
// order, and which one is active belong to this member's own machine rather than to
// a shared workspace record. The preference scope deliberately omits the volatile
// catalog authority segment so it survives an authority refresh.

import type { CatalogScope } from "../../lib/queries";
import type { SqlDocument } from "../sqlDocuments/domain";

const STORAGE_PREFIX = "dopedb.workbench-open-tabs.v1";
const MAX_STORED_TABS = 128;

export interface StoredOpenTabs {
  open: string[];
  active: string | null;
}

export type OpenTabScope = Pick<
  CatalogScope,
  "workspaceKind" | "workspaceId" | "accountScope"
>;

export function openTabScopeKey(scope: OpenTabScope): string | null {
  return scope.workspaceKind && scope.workspaceId
    ? `${scope.workspaceKind}:${scope.workspaceId}:account:${scope.accountScope ?? "anonymous"}`
    : null;
}

function storageKey(scope: string, connectionId: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(scope)}:${encodeURIComponent(connectionId)}`;
}

/** Returns null only when this member has never stored a tab set for the connection. */
export function readOpenTabs(
  scope: string | null,
  connectionId: string,
): StoredOpenTabs | null {
  if (!scope || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(scope, connectionId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Partial<StoredOpenTabs>;
    if (!Array.isArray(record.open)) return null;
    return {
      open: record.open.filter(
        (value): value is string => typeof value === "string",
      ),
      active: typeof record.active === "string" ? record.active : null,
    };
  } catch {
    return null;
  }
}

/**
 * Writes the member-local tab set. It throws when storage rejects the write so the
 * caller reports a real failure instead of claiming the tabs were remembered.
 */
export function writeOpenTabs(
  scope: string | null,
  connectionId: string,
  value: StoredOpenTabs,
) {
  if (!scope || typeof localStorage === "undefined") return;
  const open = value.open.slice(0, MAX_STORED_TABS);
  localStorage.setItem(
    storageKey(scope, connectionId),
    JSON.stringify({
      open,
      active: value.active && open.includes(value.active) ? value.active : null,
    } satisfies StoredOpenTabs),
  );
}

/**
 * Decides which saved documents may reopen. A missing record restores every saved
 * document the way a first run does, while a stored empty list is a deliberate
 * "closed everything" and stays empty. Ids the backend no longer returns and ids the
 * user closed while the list request was still in flight are dropped, so neither a
 * deleted document nor a just-closed tab can come back; ids opened during that same
 * window are kept, so a late response cannot discard a tab the user just created.
 */
export function restorableOpenTabs(
  stored: StoredOpenTabs | null,
  documents: readonly SqlDocument[],
  closedWhileLoading: ReadonlySet<string>,
  openedWhileLoading: ReadonlySet<string> = new Set(),
): StoredOpenTabs {
  const live = new Set<string>([
    ...documents.map((document) => String(document.id)),
    ...openedWhileLoading,
  ]);
  const requested = [
    ...(stored ? stored.open : documents.map((document) => String(document.id))),
    ...openedWhileLoading,
  ];
  const seen = new Set<string>();
  const open = requested.filter((id) => {
    if (!live.has(id) || closedWhileLoading.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
  const active = stored?.active ?? null;
  return { open, active: active && open.includes(active) ? active : null };
}
