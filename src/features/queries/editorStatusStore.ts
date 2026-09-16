// Publishes document-owned SQL cursor snapshots without subscribing the shell to editor text.

import { useSyncExternalStore } from "react";
import type {
  SqlCursorPosition,
  SqlEditorStatus,
} from "./editorStatus";

type Listener = () => void;

let snapshot: SqlEditorStatus | null = null;
const listeners = new Set<Listener>();

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return null;
}

export function publishSqlEditorCursor(
  documentId: string,
  position: SqlCursorPosition,
) {
  if (
    snapshot?.documentId === documentId &&
    snapshot.line === position.line &&
    snapshot.column === position.column
  ) {
    return;
  }
  snapshot = { documentId, ...position };
  listeners.forEach((listener) => listener());
}

export function clearSqlEditorCursor(documentId: string) {
  if (snapshot?.documentId !== documentId) return;
  snapshot = null;
  listeners.forEach((listener) => listener());
}

export function useSqlEditorCursor(documentId: string | null) {
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return current?.documentId === documentId ? current : null;
}
