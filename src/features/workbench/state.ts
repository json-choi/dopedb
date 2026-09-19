// Pure state machine for the workbench document strip. React effects and UI handlers
// dispatch commands here instead of mutating document arrays in multiple places.

import type { SqlDocument } from "../sqlDocuments/domain";
import type { SqlResolveMode } from "../queries/resolveMode";
import {
  persistedQueryDocument,
  queryDocument,
  stableDocument,
  type WorkbenchDocument,
} from "./domain";

export interface WorkbenchState {
  documents: WorkbenchDocument[];
  activeDocumentId: string | null;
}

export const emptyWorkbenchState: WorkbenchState = {
  documents: [],
  activeDocumentId: null,
};

export type WorkbenchAction =
  | { type: "reset" }
  | { type: "initialize"; document: WorkbenchDocument }
  | {
      type: "restoreSql";
      connectionId: string;
      documents: SqlDocument[];
      // Exactly the persisted ids this member left open, already ordered and
      // validated against `documents`; closing a tab is not deleting it, so the
      // full stored list is never reopened wholesale.
      open: readonly string[];
      activePersistedId: string | null;
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
      };
    case "restoreSql": {
      const storedById = new Map(
        action.documents.map((document) => [String(document.id), document]),
      );
      // A document created after the list request was issued is open in memory but
      // absent from that response; keep the live instance instead of dropping it.
      const openById = new Map(
        state.documents.flatMap((document) =>
          document.connectionId === action.connectionId &&
          document.kind === "sql" &&
          document.persistedId
            ? [[document.persistedId, document] as const]
            : [],
        ),
      );
      const restored = action.open.flatMap((id) => {
        const stored = storedById.get(id);
        const alreadyOpen = openById.get(id);
        if (alreadyOpen) return [alreadyOpen];
        return stored ? [persistedQueryDocument(stored)] : [];
      });
      const documents = [
        ...state.documents.filter(
          (document) =>
            document.connectionId !== action.connectionId || document.kind !== "sql",
        ),
        ...restored,
      ];
      const reactivated = action.activePersistedId
        ? (restored.find(
            (document) =>
              document.kind === "sql" &&
              document.persistedId === action.activePersistedId,
          )?.id ?? null)
        : null;
      return {
        documents,
        activeDocumentId:
          (restored.some((document) => document.id === state.activeDocumentId)
            ? state.activeDocumentId : null) ??
          reactivated ??
          (documents.some((document) => document.id === state.activeDocumentId)
            ? state.activeDocumentId
            : (documents[0]?.id ?? null)),
      };
    }
    case "activate":
      return {
        documents: state.documents.some(
          (document) => document.id === action.document.id,
        )
          ? state.documents
          : [...state.documents, action.document],
        activeDocumentId: action.document.id,
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
        documents,
        activeDocumentId:
          state.activeDocumentId === action.id
            ? (remaining[Math.min(index, Math.max(0, remaining.length - 1))]?.id ??
              null)
            : state.activeDocumentId,
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
