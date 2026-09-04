import { useCallback, useEffect, useState } from "react";

import { createFrameCoalescer } from "../../lib/frameCoalescer";

const EXPLORER_STORAGE_KEY = "sidebarW";
const LOCAL_HISTORY_STORAGE_KEY = "localHistorySidebarW";
const EXPLORER_MIN = 180;
const LOCAL_HISTORY_MIN = 300;
const MAX = 520;
const VIEWPORT_RATIO = 0.4;
export const DEFAULT_SIDEBAR_WIDTH = 396;
export const DEFAULT_LOCAL_HISTORY_WIDTH = 459;

type SidebarKind = "databaseExplorer" | "localHistory";

function minimum(kind: SidebarKind) {
  return kind === "localHistory" ? LOCAL_HISTORY_MIN : EXPLORER_MIN;
}

function defaultWidth(kind: SidebarKind) {
  return kind === "localHistory"
    ? DEFAULT_LOCAL_HISTORY_WIDTH
    : DEFAULT_SIDEBAR_WIDTH;
}

function storageKey(kind: SidebarKind) {
  return kind === "localHistory"
    ? LOCAL_HISTORY_STORAGE_KEY
    : EXPLORER_STORAGE_KEY;
}

function clamp(kind: SidebarKind, width: number) {
  return Math.min(MAX, Math.max(minimum(kind), width));
}

function readWidth(kind: SidebarKind) {
  const saved = Number(localStorage.getItem(storageKey(kind)));
  return saved >= minimum(kind) && saved <= MAX
    ? saved
    : defaultWidth(kind);
}

export function useSidebarWidth(kind: SidebarKind) {
  const [widths, setWidths] = useState(() => ({
    databaseExplorer: readWidth("databaseExplorer"),
    localHistory: readWidth("localHistory"),
  }));
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const coalescer = createFrameCoalescer<number>(setViewportWidth);
    const sync = () => coalescer.push(window.innerWidth);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      coalescer.cancel();
    };
  }, []);
  const viewportMaximum = Math.max(
    minimum(kind),
    Math.floor(viewportWidth * VIEWPORT_RATIO),
  );
  const maximum = Math.min(MAX, viewportMaximum);
  const width = Math.min(widths[kind], maximum);

  const startDrag = useCallback(
    (event: { preventDefault(): void; clientX: number }) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      const widthAt = (clientX: number) =>
        clamp(kind, startWidth + clientX - startX);
      const coalescer = createFrameCoalescer<number>((nextWidth) =>
        setWidths((current) => ({ ...current, [kind]: nextWidth })),
      );
      const move = (next: MouseEvent) => {
        coalescer.push(widthAt(next.clientX));
      };
      const up = (next: MouseEvent) => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        const nextWidth = widthAt(next.clientX);
        coalescer.push(nextWidth);
        coalescer.flush();
        localStorage.setItem(
          storageKey(kind),
          String(nextWidth),
        );
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    },
    [kind, width],
  );

  const reset = useCallback(() => {
    const nextWidth = defaultWidth(kind);
    setWidths((current) => ({ ...current, [kind]: nextWidth }));
    localStorage.setItem(storageKey(kind), String(nextWidth));
  }, [kind]);
  const resize = useCallback(
    (nextWidth: number) => {
      const bounded = Math.min(maximum, Math.max(minimum(kind), nextWidth));
      setWidths((current) => ({ ...current, [kind]: bounded }));
      localStorage.setItem(storageKey(kind), String(bounded));
    },
    [kind, maximum],
  );

  return {
    width,
    minimum: minimum(kind),
    maximum,
    startDrag,
    resize,
    reset,
  };
}
