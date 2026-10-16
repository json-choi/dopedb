// Owns the ACP dock's DOM-only behavior: sticky transcript scrolling and resize.
import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { createFrameCoalescer } from "../../lib/frameCoalescer";
import type { AcpSessionId } from "./domain";
import {
  AGENT_DOCK_DEFAULT_WIDTH,
  AGENT_DOCK_MAX_WIDTH,
  AGENT_DOCK_MIN_WIDTH,
  agentDockLayout,
  clampAgentDockWidth,
} from "./layout";

const AUTO_SCROLL_THRESHOLD_PX = 96;

interface AcpChatViewportInput {
  activeSessionId: AcpSessionId | null;
  projectionRevision: number | undefined;
  overlay: boolean;
  compact: boolean;
  width: number;
  onWidthChange: (width: number) => void;
}

export function useAcpChatViewport({
  activeSessionId,
  projectionRevision,
  overlay,
  compact,
  width,
  onWidthChange,
}: AcpChatViewportInput) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);
  const previousActiveIdRef = useRef<AcpSessionId | null>(null);

  useEffect(() => {
    if (previousActiveIdRef.current !== activeSessionId) {
      previousActiveIdRef.current = activeSessionId;
      stickToBottomRef.current = true;
    }
    if (!stickToBottomRef.current || autoScrollFrameRef.current !== null) return;
    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      const element = transcriptRef.current;
      if (!element || !stickToBottomRef.current) return;
      element.scrollTop = element.scrollHeight;
    });
  }, [activeSessionId, projectionRevision]);

  useEffect(
    () => () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
      }
    },
    [],
  );

  const updateAutoScroll = useCallback(() => {
    const element = transcriptRef.current;
    if (!element) return;
    stickToBottomRef.current =
      element.scrollHeight - element.clientHeight - element.scrollTop <=
      AUTO_SCROLL_THRESHOLD_PX;
  }, []);

  function beginResize(event: ReactMouseEvent<HTMLDivElement>) {
    if (overlay || compact) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const widthAt = (clientX: number) =>
      clampAgentDockWidth(startWidth + startX - clientX, window.innerWidth);
    const coalescer = createFrameCoalescer<number>(onWidthChange);
    const move = (next: MouseEvent) => {
      coalescer.push(widthAt(next.clientX));
    };
    const up = (next: MouseEvent) => {
      coalescer.push(widthAt(next.clientX));
      coalescer.flush();
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  return {
    layout: agentDockLayout(compact, overlay),
    transcriptRef,
    onTranscriptScroll: updateAutoScroll,
    resize: {
      value: width,
      minimum: AGENT_DOCK_MIN_WIDTH,
      maximum: clampAgentDockWidth(AGENT_DOCK_MAX_WIDTH, window.innerWidth),
      onChange: (next: number) =>
        onWidthChange(clampAgentDockWidth(next, window.innerWidth)),
      onMouseDown: beginResize,
      onReset: () => onWidthChange(AGENT_DOCK_DEFAULT_WIDTH),
    },
  };
}
