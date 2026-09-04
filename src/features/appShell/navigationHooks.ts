import { useEffect, useState } from "react";

import type { WorkbenchDocument } from "../workbench/domain";

export function preloadSqlEditor() {
  void import("../../components/SqlViewer").catch(() => undefined);
}

export function useSqlEditorPreload(
  selectedConnectionId: string | null,
  supportsSql: boolean,
) {
  useEffect(() => {
    if (!selectedConnectionId || !supportsSql) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(preloadSqlEditor, { timeout: 1_500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preloadSqlEditor, 300);
    return () => window.clearTimeout(id);
  }, [selectedConnectionId, supportsSql]);
}

export function usePersistentSelectedConnection() {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    localStorage.getItem("selectedId"),
  );
  useEffect(() => {
    if (selectedId) localStorage.setItem("selectedId", selectedId);
    else localStorage.removeItem("selectedId");
  }, [selectedId]);
  return [selectedId, setSelectedId] as const;
}

export function useActivitySeen(
  activeKind: WorkbenchDocument["kind"] | null,
  unseen: number,
  markSeen: () => void,
) {
  useEffect(() => {
    if (activeKind === "activity" && unseen > 0) markSeen();
  }, [activeKind, markSeen, unseen]);
}
