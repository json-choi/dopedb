// Single writer for workbench document state. It coordinates connection changes,
// persisted SQL restoration, tab commands, and optimistic save projections.

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
  openTabsKey,
  readOpenTabs,
  writeOpenTabs,
  type OpenTabScope,
} from "./openTabsStore";
import {
  emptyWorkbenchState,
  workbenchReducer,
  type WorkbenchState,
} from "./state";
import { useI18n } from "../../lib/i18n";

interface UseWorkbenchDocumentsOptions {
  selectedConnectionId: string | null;
  selectedConnectionDatabase: string | null;
  supportsSql: boolean;
  sqlDocuments: SqlDocumentGateway;
  tabScope: OpenTabScope;
  onRestoreError?: (error: unknown) => void;
  onTabStateError?: (error: unknown) => void;
}

function openTabProjection(state: WorkbenchState, connection: string) {
  const documentIds = state.documents.flatMap((document) =>
    document.connectionId === connection &&
    document.kind === "sql" &&
    document.persistedId !== null
      ? [document.persistedId]
      : [],
  );
  const active = state.documents.find(
    (document) => document.id === state.activeDocumentId,
  );
  return {
    documentIds,
    activeDocumentId:
      active?.kind === "sql" && active.connectionId === connection
        ? active.persistedId
        : null,
  };
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
  tabScope,
  onRestoreError,
  onTabStateError,
}: UseWorkbenchDocumentsOptions) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(workbenchReducer, emptyWorkbenchState);
  const loadToken = useRef(0);
  const pendingInitial = useRef<WorkbenchDocument | null>(null);
  const restoreError = useRef(onRestoreError);
  restoreError.current = onRestoreError;
  const tabStateError = useRef(onTabStateError);
  tabStateError.current = onTabStateError;
  // Tab state is only recorded once its own connection has been restored, so a
  // pre-restore render can never erase the list this device already kept.
  const restoredConnection = useRef<string | null>(null);
  const writtenTabState = useRef<string | null>(null);
  const reportedTabStateError = useRef(false);
  const { workspaceId, accountScope, ready: tabScopeReady } = tabScope;

  useEffect(() => {
    const token = ++loadToken.current;
    restoredConnection.current = null;
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
    void sqlDocuments
      .list(connectionId(selectedConnectionId))
      .then(async (stored) => {
        if (token !== loadToken.current) return;
        // Read the recorded tabs next to the dispatch so a slow list response
        // cannot reopen what the user closed while it was in flight. Before the
        // workspace/account generation settles there is no owner to record for.
        const recorded = tabScopeReady
          ? readOpenTabs(
              openTabsKey({ workspaceId, accountScope }, selectedConnectionId),
            )
          : null;
        if (tabScopeReady) {
          restoredConnection.current = selectedConnectionId;
          writtenTabState.current = null;
          reportedTabStateError.current = false;
        }
        dispatch({
          type: "restoreSql",
          connectionId: selectedConnectionId,
          documents: stored,
          openDocumentIds: recorded?.documentIds ?? null,
          activeDocumentId: recorded?.activeDocumentId ?? null,
          activateFirst: false,
        });
      })
      .catch((error) => {
        if (token === loadToken.current) restoreError.current?.(error);
      });
  }, [
    accountScope,
    selectedConnectionDatabase,
    selectedConnectionId,
    sqlDocuments,
    supportsSql,
    tabScopeReady,
    workspaceId,
  ]);

  useEffect(() => {
    if (!selectedConnectionId || !supportsSql || !tabScopeReady) return;
    if (restoredConnection.current !== selectedConnectionId) return;
    const key = openTabsKey({ workspaceId, accountScope }, selectedConnectionId);
    const projection = openTabProjection(state, selectedConnectionId);
    const signature = `${key}|${projection.documentIds.join(",")}|${projection.activeDocumentId ?? ""}`;
    if (signature === writtenTabState.current) return;
    try {
      writeOpenTabs(key, projection);
      writtenTabState.current = signature;
      reportedTabStateError.current = false;
    } catch (error) {
      // A device that cannot keep the tab list must say so once instead of
      // silently restoring closed tabs on the next connect.
      if (reportedTabStateError.current) return;
      reportedTabStateError.current = true;
      tabStateError.current?.(error);
    }
  }, [
    accountScope,
    selectedConnectionId,
    state,
    supportsSql,
    tabScopeReady,
    workspaceId,
  ]);

  const selectedDocuments = useMemo(
    () =>
      state.documents.filter(
        (document) => document.connectionId === selectedConnectionId,
      ),
    [selectedConnectionId, state.documents],
  );
  const closedDocuments = useMemo(
    () =>
      state.closedDocuments.filter(
        (document) => document.connectionId === selectedConnectionId,
      ),
    [selectedConnectionId, state.closedDocuments],
  );
  const activeDocument =
    selectedDocuments.find(
      (document) => document.id === state.activeDocumentId,
    ) ?? null;

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
