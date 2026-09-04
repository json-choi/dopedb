import { useCallback, useState } from "react";

import { createFrameCoalescer } from "../../lib/frameCoalescer";

const STORAGE_KEY = "dopedb:tool-window-layout:v1";

type LeftToolWindow = "databaseExplorer" | "localHistory";

type StoredToolWindowLayout = {
  databaseExplorerOpen: boolean;
  leftToolWindow: LeftToolWindow;
  servicesOpen: boolean;
  servicesHeight: number;
};

const DEFAULT_SERVICES_HEIGHT = 284;
const DEFAULT_SERVICES_VIEWPORT_RATIO = 0.33;
const MIN_SERVICES_HEIGHT = 160;
const MAX_SERVICES_HEIGHT = 560;

function clampServicesHeight(height: number) {
  const viewportMaximum =
    typeof window === "undefined"
      ? MAX_SERVICES_HEIGHT
      : Math.max(MIN_SERVICES_HEIGHT, window.innerHeight - 220);
  return Math.min(
    MAX_SERVICES_HEIGHT,
    viewportMaximum,
    Math.max(MIN_SERVICES_HEIGHT, height),
  );
}

function defaultServicesHeight() {
  return clampServicesHeight(
    typeof window === "undefined"
      ? DEFAULT_SERVICES_HEIGHT
      : Math.floor(window.innerHeight * DEFAULT_SERVICES_VIEWPORT_RATIO),
  );
}

function defaultLayout(): StoredToolWindowLayout {
  return {
    databaseExplorerOpen: true,
    leftToolWindow: "databaseExplorer",
    servicesOpen: false,
    servicesHeight: defaultServicesHeight(),
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
        parsed.leftToolWindow === "localHistory") &&
      "servicesOpen" in parsed &&
      typeof parsed.servicesOpen === "boolean" &&
      "servicesHeight" in parsed &&
      typeof parsed.servicesHeight === "number"
    ) {
      return {
        databaseExplorerOpen: parsed.databaseExplorerOpen,
        leftToolWindow: parsed.leftToolWindow,
        servicesOpen: parsed.servicesOpen,
        servicesHeight: clampServicesHeight(parsed.servicesHeight),
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
      const next = { ...current, databaseExplorerOpen: false };
      storeLayout(next);
      return next;
    });
  }, []);
  const toggleLocalHistory = useCallback(() => {
    setLayout((current) => {
      const next = {
        ...current,
        databaseExplorerOpen:
          current.leftToolWindow === "localHistory"
            ? !current.databaseExplorerOpen
            : true,
        leftToolWindow: "localHistory" as const,
      };
      storeLayout(next);
      return next;
    });
  }, []);

  const setServicesOpen = useCallback((open: boolean) => {
    setLayout((current) => {
      if (current.servicesOpen === open) return current;
      const next = { ...current, servicesOpen: open };
      storeLayout(next);
      return next;
    });
  }, []);
  const showServices = useCallback(
    () => setServicesOpen(true),
    [setServicesOpen],
  );
  const closeServices = useCallback(
    () => setServicesOpen(false),
    [setServicesOpen],
  );
  const toggleServices = useCallback(() => {
    setLayout((current) => {
      const next = { ...current, servicesOpen: !current.servicesOpen };
      storeLayout(next);
      return next;
    });
  }, []);

  const startServicesResize = useCallback(
    (event: { preventDefault(): void; clientY: number }) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = layout.servicesHeight;
      const heightAt = (clientY: number) =>
        clampServicesHeight(startHeight + startY - clientY);
      let persist = false;
      const coalescer = createFrameCoalescer<number>((height) => {
        setLayout((current) => {
          const next = { ...current, servicesHeight: height };
          if (persist) storeLayout(next);
          return next;
        });
      });
      const move = (next: MouseEvent) => {
        coalescer.push(heightAt(next.clientY));
      };
      const up = (next: MouseEvent) => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        persist = true;
        coalescer.push(heightAt(next.clientY));
        coalescer.flush();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [layout.servicesHeight],
  );
  const resetServicesHeight = useCallback(() => {
    setLayout((current) => {
      const next = {
        ...current,
        servicesHeight: defaultServicesHeight(),
      };
      storeLayout(next);
      return next;
    });
  }, []);
  const resizeServicesHeight = useCallback((height: number) => {
    setLayout((current) => {
      const next = {
        ...current,
        servicesHeight: clampServicesHeight(height),
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
    servicesOpen: layout.servicesOpen,
    servicesHeight: layout.servicesHeight,
    servicesMinimumHeight: MIN_SERVICES_HEIGHT,
    servicesMaximumHeight: clampServicesHeight(MAX_SERVICES_HEIGHT),
    showDatabaseExplorer,
    toggleDatabaseExplorer,
    showLocalHistory,
    closeLocalHistory,
    toggleLocalHistory,
    showServices,
    closeServices,
    toggleServices,
    startServicesResize,
    resizeServicesHeight,
    resetServicesHeight,
  };
}
