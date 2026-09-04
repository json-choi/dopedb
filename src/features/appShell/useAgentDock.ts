import { useCallback, useRef, useState } from "react";

import {
  AGENT_DOCK_DEFAULT_WIDTH,
  clampAgentDockWidth,
  normalizeAgentDockWidth,
} from "../agents/layout";

function readAgentDockWidth() {
  const saved = Number(localStorage.getItem("agentDockWidth"));
  return normalizeAgentDockWidth(saved || AGENT_DOCK_DEFAULT_WIDTH);
}

export function useAgentDock() {
  const [open, setOpen] = useState(() => {
    return localStorage.getItem("agentDockOpen") === "1";
  });
  const [width, setWidth] = useState(readAgentDockWidth);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const show = useCallback((returnFocus?: HTMLElement | null) => {
    const active =
      returnFocus ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    returnFocusRef.current =
      active && active !== document.body && active.isConnected
        ? active
        : buttonRef.current;
    localStorage.setItem("agentDockOpen", "1");
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    const target = returnFocusRef.current?.isConnected
      ? returnFocusRef.current
      : buttonRef.current;
    localStorage.setItem("agentDockOpen", "0");
    setOpen(false);
    window.requestAnimationFrame(() => {
      target?.focus({ preventScroll: true });
      returnFocusRef.current = null;
    });
  }, []);

  const resize = useCallback((next: number) => {
    const bounded = clampAgentDockWidth(next, window.innerWidth);
    setWidth(bounded);
    localStorage.setItem("agentDockWidth", String(bounded));
  }, []);

  return {
    open,
    width,
    buttonRef,
    returnFocusRef,
    show,
    close,
    resize,
  };
}
