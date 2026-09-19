// Autosave state machine for one persisted SQL document. It owns debounce, local
// recovery, optimistic revision conflicts, stale async response suppression, and the
// flush that closing this document's tab awaits before the editor unmounts.

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
import {
  registerSqlDocumentFlush,
  type SqlDocumentFlushOutcome,
} from "./pendingSaves";
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
  const latestConflict = useRef(conflict);
  latestConflict.current = conflict;
  const recoveryTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const inFlight = useRef(new Set<Promise<SqlDocumentFlushOutcome>>());
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

  /** Returns the storage error, or null, so an unmount-time failure is not lost. */
  const flushRecovery = useCallback((): unknown => {
    if (recoveryTimer.current !== null) {
      window.clearTimeout(recoveryTimer.current);
      recoveryTimer.current = null;
    }
    const pending = pendingRecovery.current;
    if (!pending) return null;
    pendingRecovery.current = null;
    try {
      localStorage.setItem(pending.key, JSON.stringify(pending.payload));
      return null;
    } catch (error) {
      pendingRecovery.current = pending;
      if (mounted.current) {
        setSaveError(errMessage(error));
        setSaveState("error");
      }
      return error;
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

  const performSave = useCallback(
    async (
      expectedRevision: number,
      nextTitle: string,
      nextSelectedDatabase: string,
      nextSelectedSchema: string | null,
      nextResolveMode: SqlResolveMode,
      nextContent: string,
    ): Promise<SqlDocumentFlushOutcome> => {
      if (!documentId) return { kind: "saved" };
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
        // A newer save has taken over this document; it owns the outcome.
        if (!mounted.current || sequence !== saveSequence.current) return { kind: "pending" };
        if (!outcome.saved) {
          const nextConflict = sqlDocumentConflict(outcome.document, {
            title: nextTitle,
            selectedDatabase: nextSelectedDatabase,
            selectedSchema: nextSelectedSchema,
            resolveMode: nextResolveMode,
            content: nextContent,
          });
          latestConflict.current = nextConflict;
          setConflict(nextConflict);
          setSaveState("conflict");
          return { kind: "conflict" };
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
        latestConflict.current = null;
        setConflict(null);
        setSaveState(savedLatestSnapshot ? "saved" : "dirty");
        callbacks.current.onPersisted(outcome.document);
        return { kind: savedLatestSnapshot ? "saved" : "pending" };
      } catch (error) {
        if (!mounted.current || sequence !== saveSequence.current) return { kind: "pending" };
        setSaveError(errMessage(error));
        setSaveState("error");
        return { kind: "error", message: errMessage(error) };
      }
    },
    [clearRecovery, connectionId, documentId, gateway],
  );

  const persist = useCallback((...args: Parameters<typeof performSave>) => {
    const promise = performSave(...args);
    inFlight.current.add(promise);
    void promise.finally(() => inFlight.current.delete(promise));
    return promise;
  }, [performSave]);

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
      saveTimer.current = null;
      void persist(
        revision,
        title,
        selectedDatabase,
        selectedSchema,
        resolveMode,
        content,
      );
    }, 700);
    saveTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
    };
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

  /**
   * Finishes the debounced write this editor still owes before its tab closes.
   * The caller keeps the tab open on anything but a clean save, so a rejected
   * recovery write or a failed save is never reported as a completed close.
   */
  const flushPendingSave = useCallback(async (): Promise<SqlDocumentFlushOutcome> => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Finish the already-issued write before choosing the optimistic revision.
    await Promise.all(inFlight.current);
    if (!mounted.current) return { kind: "pending" };
    const recoveryError = flushRecovery();
    if (recoveryError) {
      return { kind: "error", message: errMessage(recoveryError) };
    }
    if (latestConflict.current) return { kind: "conflict" };
    if (!documentId) return { kind: "saved" };
    const current = latest.current;
    const baseline = persistedBaseline.current;
    const dirty =
      baseline.title !== current.title ||
      baseline.selectedDatabase !== current.selectedDatabase ||
      baseline.selectedSchema !== current.selectedSchema ||
      baseline.resolveMode !== current.resolveMode ||
      baseline.content !== current.content;
    // An untitled document is never persisted, matching the autosave effect.
    if (!dirty) return { kind: "saved" };
    if (!current.title.trim()) return { kind: "pending" };
    return await persist(
      baseline.revision,
      current.title,
      current.selectedDatabase,
      current.selectedSchema,
      current.resolveMode,
      current.content,
    );
  }, [documentId, flushRecovery, persist]);

  useEffect(() => {
    if (!documentId) return;
    return registerSqlDocumentFlush(documentId, flushPendingSave);
  }, [documentId, flushPendingSave]);

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
