// One cursor snapshot lives outside React so typing re-renders the status bar
// alone, not the editor's parents. A reader gets a position only when it belongs
// to the document it asked about, so a background tab cannot show another cursor.
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
