// Each result viewport owns its local magnification. Native WebKit gestures and
// ctrl-wheel pinch events scale grid content without zooming the surrounding app.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createFrameCoalescer } from "../lib/frameCoalescer";

export function clampDataGridZoom(value: number) {
  return Number.isFinite(value) ? Math.max(0.5, Math.min(2, value)) : 1;
}

type MagnificationEvent = Event & { scale: number };

export default function useDataGridZoom(viewportRef: RefObject<HTMLDivElement | null>) {
  const [zoom, setZoom] = useState(1);
  const reset = useRef<() => void>(() => {});
  const resetZoom = useCallback(() => reset.current(), []);
  const current = useRef(1);
  const rendered = useRef(1);
  const center = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport && center.current) {
      viewport.scrollLeft = center.current.x * zoom - viewport.clientWidth / 2;
      viewport.scrollTop = center.current.y * zoom - viewport.clientHeight / 2;
      center.current = null;
    }
    rendered.current = zoom;
  }, [zoom, viewportRef]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const frames = createFrameCoalescer(setZoom);
    let gestureBase: number | null = null;
    const apply = (next: number) => {
      const bounded = clampDataGridZoom(next);
      if (bounded === current.current) return;
      center.current = {
        x: (viewport.scrollLeft + viewport.clientWidth / 2) / rendered.current,
        y: (viewport.scrollTop + viewport.clientHeight / 2) / rendered.current,
      };
      current.current = bounded;
      frames.push(bounded);
    };
    reset.current = () => {
      gestureBase = null;
      apply(1);
      frames.flush();
    };
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key !== "0") return;
      event.preventDefault();
      event.stopPropagation();
      reset.current();
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (gestureBase !== null) return;
      const unit = event.deltaMode === 1 ? 16
        : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const delta = event.deltaY * unit;
      apply(current.current * Math.exp(-delta * 0.01));
    };
    const start = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      gestureBase = current.current;
    };
    const change = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const scale = (event as MagnificationEvent).scale;
      if (gestureBase !== null && Number.isFinite(scale) && scale > 0) {
        apply(gestureBase * scale);
      }
    };
    const end = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      gestureBase = null;
      frames.flush();
    };
    const blur = () => {
      gestureBase = null;
      frames.flush();
    };
    const options = { passive: false, capture: true };
    viewport.addEventListener("keydown", keydown, true);
    viewport.addEventListener("wheel", wheel, options);
    viewport.addEventListener("gesturestart", start, options);
    viewport.addEventListener("gesturechange", change, options);
    viewport.addEventListener("gestureend", end, options);
    window.addEventListener("blur", blur);
    return () => {
      reset.current = () => {};
      frames.cancel();
      viewport.removeEventListener("keydown", keydown, true);
      viewport.removeEventListener("wheel", wheel, options);
      viewport.removeEventListener("gesturestart", start, options);
      viewport.removeEventListener("gesturechange", change, options);
      viewport.removeEventListener("gestureend", end, options);
      window.removeEventListener("blur", blur);
    };
  }, [viewportRef]);
  return { zoom, resetZoom };
}
