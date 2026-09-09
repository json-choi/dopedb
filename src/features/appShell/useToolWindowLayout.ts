// Persisted left-panel selection and visibility.
// Local History is a temporary Explorer view; leaving it restores navigation.
import { useCallback, useState } from "react";


const STORAGE_KEY = "dopedb:tool-window-layout:v1";

type LeftToolWindow = "databaseExplorer" | "localHistory";

type StoredToolWindowLayout = {
  databaseExplorerOpen: boolean;
  leftToolWindow: LeftToolWindow;
};

function defaultLayout(): StoredToolWindowLayout {
  return {
    databaseExplorerOpen: true,
    leftToolWindow: "databaseExplorer",
  };
}

function readLayout(): StoredToolWindowLayout {
  const fallback = defaultLayout();
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (
      parsed &&
      typeof parsed === "object" &&
      "databaseExplorerOpen" in parsed &&
      typeof parsed.databaseExplorerOpen === "boolean" &&
      "leftToolWindow" in parsed &&
      (parsed.leftToolWindow === "databaseExplorer" ||
        parsed.leftToolWindow === "localHistory")
    ) {
      return {
        databaseExplorerOpen: parsed.databaseExplorerOpen,
        leftToolWindow: parsed.leftToolWindow,
      };
    }
  } catch {
    // A corrupt layout preference must never block the workbench.
  }
  return fallback;
}

function storeLayout(layout: StoredToolWindowLayout) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function useToolWindowLayout() {
  const [layout, setLayout] = useState(readLayout);

  const toggleLeftToolWindow = useCallback(() => {
    setLayout((current) => {
      const next = { ...current, databaseExplorerOpen: !current.databaseExplorerOpen };
      storeLayout(next);
      return next;
    });
  }, []);

  const setDatabaseExplorerOpen = useCallback((open: boolean) => {
    setLayout((current) => {
      if (
        current.databaseExplorerOpen === open &&
        (!open || current.leftToolWindow === "databaseExplorer")
      ) {
        return current;
      }
      const next = {
        ...current,
        databaseExplorerOpen: open,
        leftToolWindow: open
          ? "databaseExplorer" as const
          : current.leftToolWindow,
      };
      storeLayout(next);
      return next;
    });
  }, []);

  const showDatabaseExplorer = useCallback(
    () => setDatabaseExplorerOpen(true),
    [setDatabaseExplorerOpen],
  );
  const toggleDatabaseExplorer = useCallback(() => {
    setLayout((current) => {
      const next = {
        ...current,
        databaseExplorerOpen:
          current.leftToolWindow === "databaseExplorer"
            ? !current.databaseExplorerOpen
            : true,
        leftToolWindow: "databaseExplorer" as const,
      };
      storeLayout(next);
      return next;
    });
  }, []);

  const showLocalHistory = useCallback(() => {
    setLayout((current) => {
      const next = {
        ...current,
        databaseExplorerOpen: true,
        leftToolWindow: "localHistory" as const,
      };
      storeLayout(next);
      return next;
    });
  }, []);
  const closeLocalHistory = useCallback(() => {
    setLayout((current) => {
      if (
        !current.databaseExplorerOpen ||
        current.leftToolWindow !== "localHistory"
      ) {
        return current;
      }
      const next = {
        ...current,
        databaseExplorerOpen: true,
        leftToolWindow: "databaseExplorer" as const,
      };
      storeLayout(next);
      return next;
    });
  }, []);
  const toggleLocalHistory = useCallback(() => {
    setLayout((current) => {
      const next = {
        ...current,
        databaseExplorerOpen: true,
        leftToolWindow: current.databaseExplorerOpen && current.leftToolWindow === "localHistory"
          ? "databaseExplorer" as const
          : "localHistory" as const,
      };
      storeLayout(next);
      return next;
    });
  }, []);

  return {
    databaseExplorerOpen:
      layout.databaseExplorerOpen &&
      layout.leftToolWindow === "databaseExplorer",
    localHistoryOpen:
      layout.databaseExplorerOpen &&
      layout.leftToolWindow === "localHistory",
    showDatabaseExplorer,
    toggleLeftToolWindow,
    toggleDatabaseExplorer,
    showLocalHistory,
    closeLocalHistory,
    toggleLocalHistory,
  };
}
