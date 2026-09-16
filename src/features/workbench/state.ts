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
  /** Saved SQL documents the user closed; they stay reopenable, never deleted. */
  closedDocuments: WorkbenchDocument[];
  activeDocumentId: string | null;
}

export const emptyWorkbenchState: WorkbenchState = {
  documents: [],
  closedDocuments: [],
  activeDocumentId: null,
};

export type WorkbenchAction =
  | { type: "reset" }
  | { type: "initialize"; document: WorkbenchDocument }
  | {
      type: "restoreSql";
      connectionId: string;
      documents: SqlDocument[];
      /** Recorded open tabs; `null` when this install never recorded any. */
      openDocumentIds: string[] | null;
      activeDocumentId: string | null;
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
        closedDocuments: [],
        activeDocumentId: action.document.id,
      };
    case "restoreSql": {
      // Documents closed in this session stay closed even when a slow list
      // response arrives afterwards, and a recorded tab list decides what a
      // reconnect or restart reopens.
      const closedIds = new Set(
        state.closedDocuments.flatMap((document) =>
          document.kind === "sql" && document.persistedId !== null
            ? [document.persistedId]
            : [],
        ),
      );
      const openIds = action.openDocumentIds;
      const opened = action.documents.filter(
        (document) =>
          !closedIds.has(document.id) &&
          (openIds === null || openIds.includes(document.id)),
      );
      const restored = (
        openIds === null
          ? opened
          : [...opened].sort(
              (left, right) =>
                openIds.indexOf(left.id) - openIds.indexOf(right.id),
            )
      ).map(persistedQueryDocument);
      const restoredIds = new Set(restored.map((document) => document.id));
      const closedDocuments = [
        ...state.closedDocuments.filter(
          (document) =>
            document.connectionId !== action.connectionId ||
            document.kind !== "sql",
        ),
        ...action.documents
          .map(persistedQueryDocument)
          .filter((document) => !restoredIds.has(document.id)),
      ];
      const documents = [
        ...state.documents.filter(
          (document) =>
            document.connectionId !== action.connectionId || document.kind !== "sql",
        ),
        ...restored,
      ];
      const recordedActive = action.activeDocumentId
        ? restored.find(
            (document) =>
              document.kind === "sql" &&
              document.persistedId === action.activeDocumentId,
          )
        : undefined;
      return {
        documents,
        closedDocuments,
        activeDocumentId:
          recordedActive?.id ??
          (action.activateFirst && restored[0]
            ? restored[0].id
            : documents.some((document) => document.id === state.activeDocumentId)
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
        closedDocuments: state.closedDocuments.filter(
          (document) => document.id !== action.document.id,
        ),
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
      // Closing a tab never deletes the saved document, so a saved one stays
      // reopenable from the existing document search instead of disappearing.
      const closed = selected[index];
      const closedDocuments =
        closed?.kind === "sql" && closed.persistedId !== null
          ? [
              ...state.closedDocuments.filter(
                (document) => document.id !== closed.id,
              ),
              closed,
            ]
          : state.closedDocuments;
      return {
        documents,
        closedDocuments,
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
