// Single writer for workbench document state. It coordinates connection changes,
// persisted SQL restoration, tab commands, and optimistic save projections, and it
// owns the member-local open-tab record so a closed tab stays closed.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  connectionId,
  type SqlDocument,
} from "../sqlDocuments/domain";
import { flushSqlDocumentSave } from "../sqlDocuments/pendingSaves";
import type { SqlDocumentGateway } from "../sqlDocuments/ports";
import type { SqlResolveMode } from "../queries/resolveMode";
import { errMessage } from "../../ipc/types";
import {
  persistedQueryDocument,
  queryDocument,
  stableDocument,
  type WorkbenchDocument,
} from "./domain";
import {
  readOpenTabs,
  restorableOpenTabs,
  writeOpenTabs,
} from "./openTabs";
import {
  emptyWorkbenchState,
  workbenchReducer,
} from "./state";
import { useI18n } from "../../lib/i18n";

interface UseWorkbenchDocumentsOptions {
  selectedConnectionId: string | null;
  selectedConnectionDatabase: string | null;
  supportsSql: boolean;
  sqlDocuments: SqlDocumentGateway;
  /** Member-local preference scope; null suspends open-tab persistence. */
  openTabScope: string | null;
  onRestoreError?: (error: unknown) => void;
  /** Reports a localized recoverable failure that kept a command from completing. */
  onError?: (message: string) => void;
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
  openTabScope,
  onRestoreError,
  onError,
}: UseWorkbenchDocumentsOptions) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(workbenchReducer, emptyWorkbenchState);
  const [restoringConnectionId, setRestoringConnectionId] = useState<string | null>(null);
  const loadToken = useRef(0);
  const pendingInitial = useRef<{ document: WorkbenchDocument; showRestore: boolean } | null>(null);
  const restoreError = useRef(onRestoreError);
  restoreError.current = onRestoreError;
  const reportError = useRef(onError);
  reportError.current = onError;
  const latestState = useRef(state);
  latestState.current = state;
  // Set only once a connection's stored tab set has been resolved. Until then the
  // documents in state are an initial placeholder, not the member's open tabs, and
  // persisting them would erase what they left open.
  const persistTarget = useRef<{ scope: string | null; connectionId: string } | null>(
    null,
  );
  // Tabs closed or opened while the document list was still loading. The restore
  // must honour both, so a late response neither reopens what the user just closed
  // nor discards a query they just created.
  const closedWhileLoading = useRef(new Set<string>());
  const openedWhileLoading = useRef(new Set<string>());

  useEffect(() => {
    const token = ++loadToken.current;
    persistTarget.current = null;
    closedWhileLoading.current = new Set();
    openedWhileLoading.current = new Set();
    if (!selectedConnectionId) {
      pendingInitial.current = null;
      setRestoringConnectionId(null);
      dispatch({ type: "reset" });
      return;
    }

    const queued = pendingInitial.current;
    pendingInitial.current = null;
    const initial =
      queued?.document.connectionId === selectedConnectionId
        ? queued.document
        : supportsSql
          ? stableDocument(selectedConnectionId, "welcome")
          : queryDocument(selectedConnectionId, "documents");
    setRestoringConnectionId(supportsSql && (queued?.showRestore ?? true) ? selectedConnectionId : null);
    if (queued?.document !== initial) dispatch({ type: "initialize", document: initial });
    if (initial.kind === "sql" && initial.persistedId) {
      openedWhileLoading.current.add(initial.persistedId);
    }

    if (!supportsSql) return;
    void sqlDocuments
      .list(connectionId(selectedConnectionId))
      .then((stored) => {
        if (token !== loadToken.current) return;
        const restorable = restorableOpenTabs(
          readOpenTabs(openTabScope, selectedConnectionId),
          stored,
          closedWhileLoading.current,
          openedWhileLoading.current,
        );
        persistTarget.current = {
          scope: openTabScope,
          connectionId: selectedConnectionId,
        };
        closedWhileLoading.current = new Set();
        openedWhileLoading.current = new Set();
        dispatch({
          type: "restoreSql",
          connectionId: selectedConnectionId,
          documents: stored,
          open: restorable.open,
          activePersistedId: restorable.active,
        });
        setRestoringConnectionId(null);
      })
      .catch((error) => {
        if (token !== loadToken.current) return;
        setRestoringConnectionId(null);
        restoreError.current?.(error);
      });
  }, [
    openTabScope,
    selectedConnectionDatabase,
    selectedConnectionId,
    sqlDocuments,
    supportsSql,
  ]);

  // Declared after the load effect so a commit that both switches connection and
  // replaces the documents clears the persist target before this can write.
  useEffect(() => {
    const target = persistTarget.current;
    if (!target) return;
    const open: string[] = [];
    let active: string | null = null;
    for (const document of state.documents) {
      if (
        document.connectionId !== target.connectionId ||
        document.kind !== "sql" ||
        !document.persistedId
      ) {
        continue;
      }
      open.push(document.persistedId);
      if (document.id === state.activeDocumentId) active = document.persistedId;
    }
    try {
      writeOpenTabs(target.scope, target.connectionId, { open, active });
    } catch (error) {
      reportError.current?.(
        t("tabs.openTabsNotRemembered", { reason: errMessage(error) }),
      );
    }
  }, [state.activeDocumentId, state.documents, t]);

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
  const restoring = supportsSql && selectedConnectionId !== null && (
    restoringConnectionId === selectedConnectionId ||
    (selectedDocuments.length === 0 && state.documents.length === 0)
  );

  const reset = useCallback(() => {
    loadToken.current += 1;
    persistTarget.current = null;
    closedWhileLoading.current = new Set();
    openedWhileLoading.current = new Set();
    pendingInitial.current = null;
    setRestoringConnectionId(null);
    dispatch({ type: "reset" });
  }, []);

  const prime = useCallback((document: WorkbenchDocument, showRestore = false) => {
    loadToken.current += 1;
    persistTarget.current = null;
    closedWhileLoading.current = new Set();
    openedWhileLoading.current = new Set();
    pendingInitial.current = { document, showRestore };
    setRestoringConnectionId(showRestore ? document.connectionId : null);
    dispatch({ type: "initialize", document });
  }, []);

  const activate = useCallback((document: WorkbenchDocument) => {
    setRestoringConnectionId(null);
    if (
      !persistTarget.current &&
      document.kind === "sql" &&
      document.persistedId
    ) {
      closedWhileLoading.current.delete(document.persistedId);
      openedWhileLoading.current.add(document.persistedId);
    }
    dispatch({ type: "activate", document });
  }, []);

  const activateId = useCallback((id: string) => {
    dispatch({ type: "activateId", id });
  }, []);

  // Closing a tab hides a saved document instead of deleting it, so the editor's
  // debounced write has to land first. A failure keeps the tab open and is reported
  // rather than swallowed, because the unmounted editor could not retry it.
  const close = useCallback(
    async (id: string, connection: string, supportsSqlConnection: boolean) => {
      const token = loadToken.current;
      const target = latestState.current.documents.find(
        (document) => document.id === id,
      );
      if (!target || target.connectionId !== connection) return;
      const persistedId = target?.kind === "sql" ? target.persistedId : null;
      if (persistedId) {
        const outcome = await flushSqlDocumentSave(persistedId);
        if (token !== loadToken.current || outcome.kind === "pending") return;
        if (outcome.kind !== "saved") {
          reportError.current?.(
            outcome.kind === "conflict"
              ? t("sql.saveConflict")
              : outcome.message,
          );
          return;
        }
        if (!persistTarget.current) {
          closedWhileLoading.current.add(persistedId);
          openedWhileLoading.current.delete(persistedId);
        }
      }
      dispatch({
        type: "close",
        id,
        connectionId: connection,
        fallbackKind: supportsSqlConnection ? "welcome" : "documents",
      });
    },
    [t],
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
    activeDocument,
    activeDocumentId: state.activeDocumentId,
    restoring,
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
