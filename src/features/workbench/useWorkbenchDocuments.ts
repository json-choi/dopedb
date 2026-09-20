// Single writer for workbench document state. It coordinates connection changes,
// persisted SQL restoration, tab commands, and optimistic save projections, and
// mirrors the open-tab set into member-local storage so a closed tab stays closed
// across connection switches and restarts without deleting its document.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  connectionId,
  type SqlDocument,
} from "../sqlDocuments/domain";
import type { SqlDocumentGateway } from "../sqlDocuments/ports";
import type { SqlResolveMode } from "../queries/resolveMode";
import {
  persistedQueryDocument,
  queryDocument,
  stableDocument,
  type WorkbenchDocument,
} from "./domain";
import {
  openTabStorageKey,
  readOpenTabs,
  writeOpenTabs,
} from "./openTabStore";
import {
  emptyWorkbenchState,
  openTabSnapshot,
  workbenchReducer,
} from "./state";
import { useI18n } from "../../lib/i18n";

interface UseWorkbenchDocumentsOptions {
  selectedConnectionId: string | null;
  selectedConnectionDatabase: string | null;
  supportsSql: boolean;
  sqlDocuments: SqlDocumentGateway;
  /** Workspace/account boundary of the stored tab set; `null` disables persistence. */
  tabScopeKey: string | null;
  onRestoreError?: (error: unknown) => void;
  onPersistError?: (error: unknown) => void;
}

interface OpenQueryOptions {
  connectionId: string;
  database: string;
  supportsSql: boolean;
  title?: string;
  content?: string;
}

export function useWorkbenchDocuments({
  selectedConnectionId,
  selectedConnectionDatabase,
  supportsSql,
  sqlDocuments,
  tabScopeKey,
  onRestoreError,
  onPersistError,
}: UseWorkbenchDocumentsOptions) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(workbenchReducer, emptyWorkbenchState);
  const loadToken = useRef(0);
  const pendingInitial = useRef<WorkbenchDocument | null>(null);
  const restoreError = useRef(onRestoreError);
  restoreError.current = onRestoreError;
  const persistError = useRef(onPersistError);
  persistError.current = onPersistError;
  const lastPersisted = useRef<{ key: string; value: string } | null>(null);

  useEffect(() => {
    const token = ++loadToken.current;
    if (!selectedConnectionId) {
      pendingInitial.current = null;
      dispatch({ type: "reset" });
      return;
    }

    const queued = pendingInitial.current;
    pendingInitial.current = null;
    const initial =
      queued?.connectionId === selectedConnectionId
        ? queued
        : supportsSql
          ? stableDocument(selectedConnectionId, "welcome")
          : queryDocument(selectedConnectionId, "documents");
    dispatch({ type: "initialize", document: initial });

    if (!supportsSql) return;
    // Read the recorded set before the request goes out; the reducer then applies
    // it against whatever the strip holds once the response lands.
    const recorded = readOpenTabs(
      openTabStorageKey(tabScopeKey, selectedConnectionId),
    );
    void sqlDocuments
      .list(connectionId(selectedConnectionId))
      .then((stored) => {
        if (token !== loadToken.current) return;
        dispatch({
          type: "restoreSql",
          connectionId: selectedConnectionId,
          documents: stored,
          open: recorded?.open ?? null,
          activePersistedId: recorded?.active ?? null,
          activateFirst: false,
        });
      })
      .catch((error) => {
        if (token === loadToken.current) restoreError.current?.(error);
      });
  }, [
    selectedConnectionDatabase,
    selectedConnectionId,
    sqlDocuments,
    supportsSql,
    tabScopeKey,
  ]);

  // Only a settled connection may write: a failed or pending restore must not
  // record an incomplete set over the member's stored tabs.
  useEffect(() => {
    if (
      !selectedConnectionId ||
      state.restoredConnectionId !== selectedConnectionId
    ) {
      return;
    }
    const key = openTabStorageKey(tabScopeKey, selectedConnectionId);
    if (!key) return;
    const snapshot = openTabSnapshot(state, selectedConnectionId);
    const value = JSON.stringify(snapshot);
    if (
      lastPersisted.current?.key === key &&
      lastPersisted.current.value === value
    ) {
      return;
    }
    lastPersisted.current = { key, value };
    try {
      writeOpenTabs(key, snapshot);
    } catch (error) {
      persistError.current?.(error);
    }
  }, [selectedConnectionId, state, tabScopeKey]);

  const selectedDocuments = useMemo(
    () =>
      state.documents.filter(
        (document) => document.connectionId === selectedConnectionId,
      ),
    [selectedConnectionId, state.documents],
  );
  const activeDocument =
    selectedDocuments.find(
      (document) => document.id === state.activeDocumentId,
    ) ?? null;
  const closedDocuments = useMemo(
    () =>
      state.closedDocuments.filter(
        (document) => document.connectionId === selectedConnectionId,
      ),
    [selectedConnectionId, state.closedDocuments],
  );

  const reset = useCallback(() => {
    loadToken.current += 1;
    pendingInitial.current = null;
    dispatch({ type: "reset" });
  }, []);

  const prime = useCallback((document: WorkbenchDocument) => {
    loadToken.current += 1;
    pendingInitial.current = document;
    dispatch({ type: "initialize", document });
  }, []);

  const activate = useCallback((document: WorkbenchDocument) => {
    dispatch({ type: "activate", document });
  }, []);

  const activateId = useCallback((id: string) => {
    dispatch({ type: "activateId", id });
  }, []);

  const close = useCallback(
    (id: string, connection: string, supportsSqlConnection: boolean) => {
      dispatch({
        type: "close",
        id,
        connectionId: connection,
        fallbackKind: supportsSqlConnection ? "welcome" : "documents",
      });
    },
    [],
  );

  const updateTitle = useCallback((id: string, title: string) => {
    dispatch({ type: "updateTitle", id, title });
  }, []);

  const updateSelectedSchema = useCallback(
    (id: string, selectedSchema: string | null) => {
      dispatch({ type: "updateSelectedSchema", id, selectedSchema });
    },
    [],
  );

  const updateSelectedDatabase = useCallback(
    (id: string, selectedDatabase: string) => {
      dispatch({ type: "updateSelectedDatabase", id, selectedDatabase });
    },
    [],
  );

  const updateResolveMode = useCallback(
    (id: string, resolveMode: SqlResolveMode) => {
      dispatch({ type: "updateResolveMode", id, resolveMode });
    },
    [],
  );

  const applyPersisted = useCallback((id: string, document: SqlDocument) => {
    dispatch({ type: "persist", id, document });
  }, []);

  const openQuery = useCallback(
    async ({
      connectionId: rawConnectionId,
      database,
      supportsSql: canUseSql,
      title = t("sql.untitledQuery"),
      content,
    }: OpenQueryOptions): Promise<WorkbenchDocument> => {
      if (!canUseSql) {
        return queryDocument(rawConnectionId, "documents", content ?? null);
      }
      const document = await sqlDocuments.create({
        connectionId: connectionId(rawConnectionId),
        title,
        selectedDatabase: database,
        content: content ?? "SELECT 1;",
      });
      return persistedQueryDocument(document);
    },
    [sqlDocuments, t],
  );

  return {
    selectedDocuments,
    closedDocuments,
    activeDocument,
    activeDocumentId: state.activeDocumentId,
    reset,
    prime,
    activate,
    activateId,
    close,
    updateTitle,
    updateSelectedDatabase,
    updateSelectedSchema,
    updateResolveMode,
    applyPersisted,
    openQuery,
  };
}
