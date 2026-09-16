// Which tabs are open is device UI state, not document content. It is stored
// per account, workspace and connection so that closing a tab is a decision the
// product keeps, while the saved SQL document, its revisions and its unsaved
// recovery draft stay untouched. A missing entry means "never recorded" and is
// initialized from the stored documents; an empty list means the user closed
// every tab.

export interface OpenTabState {
  /** Persisted SQL document ids in tab order. */
  documentIds: string[];
  /** Persisted SQL document id of the active tab, if a SQL tab is active. */
  activeDocumentId: string | null;
}

export interface OpenTabScope {
  workspaceId: string | null;
  accountScope: string | null;
  /** False until the workspace/account generation settles; no record is read or written before then. */
  ready: boolean;
}

const STORAGE_PREFIX = "dopedb.workbenchTabs.v1";

/** Local resources have no account owner, so they fall back to a local scope. */
export function openTabsKey(
  scope: Omit<OpenTabScope, "ready">,
  connectionId: string,
): string {
  return [
    STORAGE_PREFIX,
    scope.workspaceId ?? "local",
    scope.accountScope ?? "local",
    connectionId,
  ].join(".");
}

export function readOpenTabs(key: string): OpenTabState | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // An unreadable store is indistinguishable from a first run here; the
    // caller initializes from the stored documents instead of losing them.
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OpenTabState>;
    if (!Array.isArray(parsed.documentIds)) return null;
    const documentIds = parsed.documentIds.filter(
      (id): id is string => typeof id === "string",
    );
    if (documentIds.length !== parsed.documentIds.length) return null;
    const activeDocumentId =
      typeof parsed.activeDocumentId === "string"
        ? parsed.activeDocumentId
        : null;
    return { documentIds, activeDocumentId };
  } catch {
    return null;
  }
}

/** Throws when the device cannot keep the tab state, so it is never reported as saved. */
export function writeOpenTabs(key: string, state: OpenTabState): void {
  localStorage.setItem(key, JSON.stringify(state));
}
