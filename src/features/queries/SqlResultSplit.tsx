// Owns only the SQL document's member-local editor/result geometry. Both panes
// stay mounted and visible; resizing never changes SQL, focus, or run state.
// The shared separator supplies keyboard/ARIA behavior; pointer capture keeps
// drag cleanup local to this surface, without document-level event listeners.
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { ResizeSeparator } from "../../design-system/components/ResizeSeparator";
import { useI18n } from "../../lib/i18n";

const STORAGE_KEY = "dopedb.sqlResultSplit";
const DEFAULT_SHARE = 50;
const MIN_PANE_HEIGHT = 120;
const SEPARATOR_HEIGHT = 6;

function savedShare() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(value) && value >= 20 && value <= 80) return value;
  } catch {
    // An unavailable preference store must not block SQL editing.
  }
  return DEFAULT_SHARE;
}

export default function SqlResultSplit({ editor, result }: { editor: ReactNode; result: ReactNode }) {
  const { t } = useI18n();
  const resultRegionId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [preferredShare, setPreferredShare] = useState(savedShare);
  const [height, setHeight] = useState(0);
  const dragRef = useRef<{
    pointerId: number;
    y: number;
    share: number;
    preferredShare: number;
    availableHeight: number;
  } | null>(null);
  const availableHeight = Math.max(1, height - SEPARATOR_HEIGHT);
  const minimum = Math.max(20, Math.min(50, Math.ceil(MIN_PANE_HEIGHT / availableHeight * 100)));
  const maximum = 100 - minimum;
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value));
  const share = clamp(preferredShare);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setHeight(container.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  function resize(value: number) {
    const next = clamp(value);
    setPreferredShare(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Resizing still works for this mount when preferences cannot be saved.
    }
  }

  function shareAt(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    return drag && drag.pointerId === event.pointerId
      ? clamp(drag.share + (drag.y - event.clientY) / drag.availableHeight * 100)
      : null;
  }

  return (
    <div
      ref={containerRef}
      data-sql-result-split
      className="tw:grid tw:min-h-0 tw:flex-1 tw:grid-cols-1 tw:grid-rows-[minmax(0,var(--sql-editor-share))_6px_minmax(0,var(--sql-result-share))] tw:overflow-hidden"
      style={{ "--sql-editor-share": `${100 - share}fr`, "--sql-result-share": `${share}fr` } as CSSProperties}
    >
      <div data-sql-editor-view role="region" aria-label={t("sql.editorRegion")} className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden">
        {editor}
      </div>
      <ResizeSeparator
        label={t("sql.resizeResults")}
        tooltip={t("sql.resizeResultsHint")}
        orientation="horizontal"
        aria-controls={resultRegionId}
        aria-valuetext={t("sql.resultsHeight", { percent: Math.round(share) })}
        value={Math.round(share)}
        minimum={minimum}
        maximum={maximum}
        step={5}
        onChange={resize}
        onReset={() => resize(DEFAULT_SHARE)}
        className="tw:relative tw:z-[var(--ds-z-base)] tw:w-full tw:cursor-row-resize tw:touch-none tw:select-none tw:bg-border-subtle tw:hover:bg-ring/45"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, y: event.clientY, share, preferredShare, availableHeight };
        }}
        onPointerMove={(event) => {
          const next = shareAt(event);
          if (next !== null) setPreferredShare(next);
        }}
        onPointerUp={(event) => {
          const next = shareAt(event);
          if (next === null) return;
          dragRef.current = null;
          resize(next);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          if (dragRef.current) setPreferredShare(dragRef.current.preferredShare);
          dragRef.current = null;
        }}
        onLostPointerCapture={() => { dragRef.current = null; }}
      />
      <div id={resultRegionId} role="region" aria-label={t("sql.resultsRegion")} className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden">
        {result}
      </div>
    </div>
  );
}
