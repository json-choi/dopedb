// Autosave state machine for one persisted SQL document. It owns debounce, local
// recovery, optimistic revision conflicts, and stale async response suppression.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { errMessage } from "../../ipc/types";
import type {
  ConnectionId,
  SqlDocument,
  SqlDocumentConflict,
  SqlDocumentId,
} from "./domain";
import {
  retrySqlDocumentConflict,
  sqlDocumentConflict,
  sqlRecoveryKey,
} from "./domain";
import type { SqlDocumentGateway } from "./ports";
import type { SqlResolveMode } from "../queries/resolveMode";

export type DocumentSaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "error"
  | "conflict";

interface SqlDocumentAutosaveOptions {
  gateway: SqlDocumentGateway;
  connectionId: ConnectionId;
  documentId: SqlDocumentId | null;
  revision: number;
  title: string;
  selectedDatabase: string;
  selectedSchema: string | null;
  resolveMode: SqlResolveMode;
  content: string;
  recovered: boolean;
  onTitleChange: (title: string) => void;
  onSelectedDatabaseChange: (selectedDatabase: string) => void;
  onSelectedSchemaChange: (selectedSchema: string | null) => void;
  onResolveModeChange: (resolveMode: SqlResolveMode) => void;
  onContentChange: (content: string) => void;
  onPersisted: (document: SqlDocument) => void;
}

interface SqlRecoveryPayload {
  revision: number;
  title: string;
  selectedDatabase: string;
  selectedSchema: string | null;
  resolveMode: SqlResolveMode;
  draft: string;
}

interface PendingRecoveryWrite {
  key: string;
  payload: SqlRecoveryPayload;
}

const RECOVERY_WRITE_INTERVAL_MS = 400;

export function useSqlDocumentAutosave({
  gateway,
  connectionId,
  documentId,
  revision,
  title,
  selectedDatabase,
  selectedSchema,
  resolveMode,
  content,
  recovered,
  onTitleChange,
  onSelectedDatabaseChange,
  onSelectedSchemaChange,
  onResolveModeChange,
  onContentChange,
  onPersisted,
}: SqlDocumentAutosaveOptions) {
  const [saveState, setSaveState] = useState<DocumentSaveState>(
    recovered ? "dirty" : "saved",
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SqlDocumentConflict | null>(null);
  const saveSequence = useRef(0);
  const mounted = useRef(true);
  const recoveryTimer = useRef<number | null>(null);
  const pendingRecovery = useRef<PendingRecoveryWrite | null>(null);
  const latest = useRef({
    revision,
    title,
    selectedDatabase,
    selectedSchema,
    resolveMode,
    content,
  });
  latest.current = {
    revision,
    title,
    selectedDatabase,
    selectedSchema,
    resolveMode,
    content,
  };
  const callbacks = useRef({
    onTitleChange,
    onSelectedDatabaseChange,
    onSelectedSchemaChange,
    onResolveModeChange,
    onContentChange,
    onPersisted,
  });
  callbacks.current = {
    onTitleChange,
    onSelectedDatabaseChange,
    onSelectedSchemaChange,
    onResolveModeChange,
    onContentChange,
    onPersisted,
  };
  const persistedBaseline = useRef<{
    revision: number;
    title: string | null;
    selectedDatabase: string | null;
    selectedSchema: string | null | undefined;
    resolveMode: SqlResolveMode | undefined;
    content: string | null;
  }>({
    revision,
    title: recovered ? null : title,
    selectedDatabase: recovered ? null : selectedDatabase,
    selectedSchema: recovered ? undefined : selectedSchema,
    resolveMode: recovered ? undefined : resolveMode,
    content: recovered ? null : content,
  });

  const flushRecovery = useCallback(() => {
    if (recoveryTimer.current !== null) {
      window.clearTimeout(recoveryTimer.current);
      recoveryTimer.current = null;
    }
    const pending = pendingRecovery.current;
    if (!pending) return;
    pendingRecovery.current = null;
    try {
      localStorage.setItem(pending.key, JSON.stringify(pending.payload));
    } catch (error) {
      pendingRecovery.current = pending;
      if (!mounted.current) return;
      setSaveError(errMessage(error));
      setSaveState("error");
    }
  }, []);

  const scheduleRecovery = useCallback(
    (write: PendingRecoveryWrite) => {
      pendingRecovery.current = write;
      // Do not restart this timer on every keystroke: a continuously edited
      // document must still reach durable recovery storage within 400 ms.
      if (recoveryTimer.current !== null) return;
      recoveryTimer.current = window.setTimeout(
        flushRecovery,
        RECOVERY_WRITE_INTERVAL_MS,
      );
    },
    [flushRecovery],
  );

  const clearRecovery = useCallback((id: SqlDocumentId) => {
    const key = sqlRecoveryKey(id);
    if (pendingRecovery.current?.key === key) {
      pendingRecovery.current = null;
      if (recoveryTimer.current !== null) {
        window.clearTimeout(recoveryTimer.current);
        recoveryTimer.current = null;
      }
    }
    localStorage.removeItem(key);
  }, []);

  const persist = useCallback(
    async (
      expectedRevision: number,
      nextTitle: string,
      nextSelectedDatabase: string,
      nextSelectedSchema: string | null,
      nextResolveMode: SqlResolveMode,
      nextContent: string,
    ) => {
      if (!documentId) return;
      const sequence = ++saveSequence.current;
      setSaveState("saving");
      setSaveError(null);
      try {
        const outcome = await gateway.save({
          id: documentId,
          connectionId,
          title: nextTitle,
          selectedDatabase: nextSelectedDatabase,
          selectedSchema: nextSelectedSchema,
          resolveMode: nextResolveMode,
          content: nextContent,
          expectedRevision,
        });
        if (sequence !== saveSequence.current) return;
        if (!outcome.saved) {
          setConflict(sqlDocumentConflict(outcome.document, {
            title: nextTitle,
            selectedDatabase: nextSelectedDatabase,
            selectedSchema: nextSelectedSchema,
            resolveMode: nextResolveMode,
            content: nextContent,
          }));
          setSaveState("conflict");
          return;
        }
        persistedBaseline.current = {
          revision: outcome.document.localRevision,
          title: outcome.document.title,
          selectedDatabase: outcome.document.selectedDatabase,
          selectedSchema: outcome.document.selectedSchema,
          resolveMode: outcome.document.resolveMode,
          content: outcome.document.content,
        };
        const current = latest.current;
        const savedLatestSnapshot =
          current.revision === expectedRevision &&
          current.title === nextTitle &&
          current.selectedDatabase === nextSelectedDatabase &&
          current.selectedSchema === nextSelectedSchema &&
          current.resolveMode === nextResolveMode &&
          current.content === nextContent;
        if (savedLatestSnapshot) clearRecovery(documentId);
        setConflict(null);
        setSaveState(savedLatestSnapshot ? "saved" : "dirty");
        callbacks.current.onPersisted(outcome.document);
      } catch (error) {
        if (sequence !== saveSequence.current) return;
        setSaveError(errMessage(error));
        setSaveState("error");
      }
    },
    [clearRecovery, connectionId, documentId, gateway],
  );

  useEffect(() => {
    if (!documentId || conflict) return;
    const baseline = persistedBaseline.current;
    const dirty =
      recovered ||
      baseline.revision !== revision ||
      baseline.title !== title ||
      baseline.selectedDatabase !== selectedDatabase ||
      baseline.selectedSchema !== selectedSchema ||
      baseline.resolveMode !== resolveMode ||
      baseline.content !== content;
    if (!dirty) {
      setSaveState("saved");
      clearRecovery(documentId);
      return;
    }
    setSaveState("dirty");
    scheduleRecovery({
      key: sqlRecoveryKey(documentId),
      payload: {
        revision,
        title,
        selectedDatabase,
        selectedSchema,
        resolveMode,
        draft: content,
      },
    });
    if (!title.trim()) return;
    const timer = window.setTimeout(() => {
      void persist(
        revision,
        title,
        selectedDatabase,
        selectedSchema,
        resolveMode,
        content,
      );
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    conflict,
    content,
    clearRecovery,
    documentId,
    persist,
    recovered,
    revision,
    resolveMode,
    scheduleRecovery,
    selectedDatabase,
    selectedSchema,
    title,
  ]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushRecovery();
    };
    window.addEventListener("blur", flushRecovery);
    window.addEventListener("pagehide", flushRecovery);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("blur", flushRecovery);
      window.removeEventListener("pagehide", flushRecovery);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [flushRecovery]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      saveSequence.current += 1;
      flushRecovery();
    };
  }, [flushRecovery]);

  const useSavedVersion = useCallback(() => {
    if (!documentId || !conflict) return;
    const current = conflict.current;
    saveSequence.current += 1;
    persistedBaseline.current = {
      revision: current.localRevision,
      title: current.title,
      selectedDatabase: current.selectedDatabase,
      selectedSchema: current.selectedSchema,
      resolveMode: current.resolveMode,
      content: current.content,
    };
    clearRecovery(documentId);
    callbacks.current.onTitleChange(current.title);
    callbacks.current.onSelectedDatabaseChange(current.selectedDatabase);
    callbacks.current.onSelectedSchemaChange(current.selectedSchema);
    callbacks.current.onResolveModeChange(current.resolveMode);
    callbacks.current.onContentChange(current.content);
    callbacks.current.onPersisted(current);
    setConflict(null);
    setSaveState("saved");
  }, [clearRecovery, conflict, documentId]);

  const keepLocalVersion = useCallback(() => {
    if (!conflict) return;
    const retry = retrySqlDocumentConflict(conflict);
    void persist(
      retry.expectedRevision,
      retry.title,
      retry.selectedDatabase,
      retry.selectedSchema,
      retry.resolveMode,
      retry.content,
    );
  }, [conflict, persist]);

  const reportError = useCallback((error: unknown) => {
    setSaveError(errMessage(error));
    setSaveState("error");
  }, []);

  return {
    saveState,
    saveError,
    conflict,
    useSavedVersion,
    keepLocalVersion,
    reportError,
    flushRecovery,
  };
}
