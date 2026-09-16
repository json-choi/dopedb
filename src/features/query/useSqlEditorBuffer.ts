// Keeps the active SQL text buffer responsive while debouncing document snapshots.

import { useCallback, useEffect, useRef, useState } from "react";

const SHELL_SNAPSHOT_DELAY_MS = 400;

interface SqlEditorBufferOptions {
  documentId: string;
  snapshot: string;
  onSnapshot: (documentId: string, snapshot: string) => void;
}

interface SqlEditorBuffer {
  text: string;
  version: number;
}

/**
 * Owns the hot SQL editor buffer below AppShell. The shell receives a bounded,
 * debounced snapshot for Agent context and document navigation, while typing
 * itself only commits the SQL workbench subtree.
 */
export function useSqlEditorBuffer({
  documentId,
  snapshot,
  onSnapshot,
}: SqlEditorBufferOptions) {
  const [buffer, setBuffer] = useState<SqlEditorBuffer>(() => ({
    text: snapshot,
    version: 0,
  }));
  const bufferRef = useRef(buffer);
  const onSnapshotRef = useRef(onSnapshot);
  const lastPublishedRef = useRef(snapshot);
  const publishTimerRef = useRef<number | null>(null);
  onSnapshotRef.current = onSnapshot;

  const flushSnapshot = useCallback(() => {
    if (publishTimerRef.current !== null) {
      window.clearTimeout(publishTimerRef.current);
      publishTimerRef.current = null;
    }
    const next = bufferRef.current.text;
    if (next === lastPublishedRef.current) return;
    lastPublishedRef.current = next;
    onSnapshotRef.current(documentId, next);
  }, [documentId]);

  const setText = useCallback((text: string) => {
    const current = bufferRef.current;
    if (current.text === text) return;
    const next = { text, version: current.version + 1 };
    bufferRef.current = next;
    setBuffer(next);
  }, []);

  // A parent snapshot that is not our own acknowledgement is an explicit
  // restore/reload and replaces the local buffer.
  useEffect(() => {
    if (
      snapshot === lastPublishedRef.current ||
      snapshot === bufferRef.current.text
    ) {
      return;
    }
    lastPublishedRef.current = snapshot;
    const current = bufferRef.current;
    const next = { text: snapshot, version: current.version + 1 };
    bufferRef.current = next;
    setBuffer(next);
  }, [snapshot]);

  useEffect(() => {
    if (
      buffer.text === lastPublishedRef.current ||
      publishTimerRef.current !== null
    ) {
      return;
    }
    publishTimerRef.current = window.setTimeout(
      flushSnapshot,
      SHELL_SNAPSHOT_DELAY_MS,
    );
  }, [buffer.text, flushSnapshot]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushSnapshot();
    };
    window.addEventListener("blur", flushSnapshot);
    window.addEventListener("pagehide", flushSnapshot);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("blur", flushSnapshot);
      window.removeEventListener("pagehide", flushSnapshot);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flushSnapshot();
    };
  }, [flushSnapshot]);

  return {
    draft: buffer.text,
    draftVersion: buffer.version,
    setDraft: setText,
    flushSnapshot,
  };
}
