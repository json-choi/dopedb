// Pure state machine for the workbench document strip. React effects and UI handlers
// dispatch commands here instead of mutating document arrays in multiple places.
// Besides the open documents it owns the persisted SQL documents that are closed
// but still reopenable, and which connection's persisted set has settled — the
// storage projection in useWorkbenchDocuments reads both.

import type { SqlDocument } from "../sqlDocuments/domain";
import type { SqlResolveMode } from "../queries/resolveMode";
import {
  persistedQueryDocument,
  queryDocument,
  stableDocument,
  type SqlWorkbenchDocument,
  type WorkbenchDocument,
} from "./domain";
import type { StoredOpenTabs } from "./openTabStore";

export interface WorkbenchState {
  documents: WorkbenchDocument[];
  activeDocumentId: string | null;
  /** Persisted SQL documents left off the strip; Action Search reopens from here. */
  closedDocuments: SqlWorkbenchDocument[];
  /** Connection whose persisted SQL set has been restored, or `null` while pending. */
  restoredConnectionId: string | null;
}

export const emptyWorkbenchState: WorkbenchState = {
  documents: [],
  activeDocumentId: null,
  closedDocuments: [],
  restoredConnectionId: null,
};

export type WorkbenchAction =
  | { type: "reset" }
  | { type: "initialize"; document: WorkbenchDocument }
  | {
      type: "restoreSql";
      connectionId: string;
      documents: SqlDocument[];
      /** Stored persisted ids in strip order, or `null` when nothing was recorded. */
      open: readonly string[] | null;
      activePersistedId: string | null;
      activateFirst: boolean;
    }
  | { type: "activate"; document: WorkbenchDocument }
  | { type: "activateId"; id: string }
  | {
      type: "close";
      id: string;
      connectionId: string;
      fallbackKind: "welcome" | "documents";
    }
  | { type: "updateTitle"; id: string; title: string }
  | { type: "updateSelectedDatabase"; id: string; selectedDatabase: string }
  | { type: "updateSelectedSchema"; id: string; selectedSchema: string | null }
  | { type: "updateResolveMode"; id: string; resolveMode: SqlResolveMode }
  | { type: "persist"; id: string; document: SqlDocument };

export function workbenchReducer(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  switch (action.type) {
    case "reset":
      return emptyWorkbenchState;
    case "initialize":
      return {
        documents: [action.document],
        activeDocumentId: action.document.id,
        closedDocuments: [],
        restoredConnectionId: null,
      };
    case "restoreSql": {
      const others = state.documents.filter(
        (document) =>
          document.connectionId !== action.connectionId || document.kind !== "sql",
      );
      // Everything the strip already holds for this connection was opened after the
      // request went out, so a late response must neither drop it nor bring back a
      // document closed in the meantime.
      const current = new Map<string, SqlWorkbenchDocument>();
      for (const document of state.documents) {
        if (
          document.connectionId === action.connectionId &&
          document.kind === "sql"
        ) {
          current.set(document.id, document);
        }
      }
      const closedIds = new Set(
        state.closedDocuments.map((document) => document.id),
      );
      const requested = action.open === null ? null : new Set(action.open);
      const rank = new Map((action.open ?? []).map((id, index) => [id, index]));
      const stored = action.documents.map(persistedQueryDocument);
      const storedIds = new Set(stored.map((document) => document.id));
      const opened = stored
        .filter(
          (document) =>
            current.has(document.id) ||
            (!closedIds.has(document.id) &&
              (requested === null ||
                requested.has(document.persistedId ?? document.id))),
        )
        .sort(
          (left, right) =>
            (rank.get(left.persistedId ?? "") ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(right.persistedId ?? "") ?? Number.MAX_SAFE_INTEGER),
        )
        .map((document) => current.get(document.id) ?? document);
      const restored = [
        ...opened,
        ...[...current.values()].filter(
          (document) => !storedIds.has(document.id),
        ),
      ];
      const restoredIds = new Set(restored.map((document) => document.id));
      const documents = [...others, ...restored];
      const active =
        restored.find(
          (document) =>
            action.activePersistedId !== null &&
            document.persistedId === action.activePersistedId,
        ) ?? (action.activateFirst ? restored[0] : undefined);
      return {
        documents,
        activeDocumentId:
          active?.id ??
          (documents.some((document) => document.id === state.activeDocumentId)
            ? state.activeDocumentId
            : (documents[0]?.id ?? null)),
        closedDocuments: [
          ...stored.filter((document) => !restoredIds.has(document.id)),
          ...state.closedDocuments.filter(
            (document) =>
              !storedIds.has(document.id) && !restoredIds.has(document.id),
          ),
        ],
        restoredConnectionId: action.connectionId,
      };
    }
    case "activate":
      return {
        ...state,
        documents: state.documents.some(
          (document) => document.id === action.document.id,
        )
          ? state.documents
          : [...state.documents, action.document],
        activeDocumentId: action.document.id,
        closedDocuments: state.closedDocuments.filter(
          (document) => document.id !== action.document.id,
        ),
      };
    case "activateId":
      return state.documents.some((document) => document.id === action.id)
        ? { ...state, activeDocumentId: action.id }
        : state;
    case "close": {
      const selected = state.documents.filter(
        (document) => document.connectionId === action.connectionId,
      );
      const index = selected.findIndex((document) => document.id === action.id);
      if (index < 0) return state;
      // Closing is not deleting: a persisted document stays reopenable.
      const closing = selected[index];
      const closedDocuments =
        closing?.kind === "sql" && closing.persistedId
          ? [
              ...state.closedDocuments.filter(
                (document) => document.id !== closing.id,
              ),
              closing,
            ]
          : state.closedDocuments;
      let remaining = selected.filter((document) => document.id !== action.id);
      if (remaining.length === 0) {
        remaining = [
          action.fallbackKind === "welcome"
            ? stableDocument(action.connectionId, "welcome")
            : queryDocument(action.connectionId, "documents"),
        ];
      }
      const documents = [
        ...state.documents.filter(
          (document) => document.connectionId !== action.connectionId,
        ),
        ...remaining,
      ];
      return {
        ...state,
        documents,
        activeDocumentId:
          state.activeDocumentId === action.id
            ? (remaining[Math.min(index, Math.max(0, remaining.length - 1))]?.id ??
              null)
            : state.activeDocumentId,
        closedDocuments,
      };
    }
    case "updateTitle":
      return {
        ...state,
        documents: state.documents.map((document) =>
          document.id === action.id && document.kind === "sql"
            ? { ...document, title: action.title }
            : document,
        ),
      };
    case "updateSelectedDatabase":
      return {
        ...state,
        documents: state.documents.map((document) =>
          document.id === action.id && document.kind === "sql"
            ? {
                ...document,
                selectedDatabase: action.selectedDatabase,
                selectedSchema: null,
              }
            : document,
        ),
      };
    case "updateSelectedSchema":
      return {
        ...state,
        documents: state.documents.map((document) =>
          document.id === action.id && document.kind === "sql"
            ? { ...document, selectedSchema: action.selectedSchema }
            : document,
        ),
      };
    case "updateResolveMode":
      return {
        ...state,
        documents: state.documents.map((document) =>
          document.id === action.id && document.kind === "sql"
            ? { ...document, resolveMode: action.resolveMode }
            : document,
        ),
      };
    case "persist":
      return {
        ...state,
        documents: state.documents.map((document) =>
          document.id === action.id && document.kind === "sql"
            ? {
                ...document,
                draft: action.document.content,
                title: action.document.title,
                selectedDatabase: action.document.selectedDatabase,
                selectedSchema: action.document.selectedSchema,
                resolveMode: action.document.resolveMode,
                revision: action.document.localRevision,
                recovered: false,
              }
            : document,
        ),
      };
  }
}

/** Projects the strip into the member-local record persisted per connection. */
export function openTabSnapshot(
  state: WorkbenchState,
  connectionId: string,
): StoredOpenTabs {
  const open: string[] = [];
  let active: string | null = null;
  for (const document of state.documents) {
    if (
      document.connectionId !== connectionId ||
      document.kind !== "sql" ||
      !document.persistedId
    ) {
      continue;
    }
    open.push(document.persistedId);
    if (document.id === state.activeDocumentId) active = document.persistedId;
  }
  return { open, active };
}
