// Canonical scroll surface shared by table and virtual data-grid renderers. The
// caller chooses whether the grid fills a pane, nests in a scrolling document,
// or sizes as a standalone panel. This owns reset focus and routes its zoom
// control to the result status pill, or the viewport bottom when there is none.
import { forwardRef, useContext, useRef, type ComponentPropsWithoutRef } from "react";

import { createPortal } from "react-dom";
import { DataGridStatusContext } from "./DataGridStatusScope";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";

export type DataGridSurface = "panel" | "workbench" | "embedded";

type Props = Omit<ComponentPropsWithoutRef<"div">, "className"> & {
  zoom?: number;
  resetZoomLabel?: string;
  onResetZoom?: () => void;
  surface?: DataGridSurface;
  virtual?: boolean;
  footerInset?: boolean;
};

export const DataGridViewport = forwardRef<HTMLDivElement, Props>(
  function DataGridViewport(
    {
      surface = "panel",
      virtual = false,
      footerInset = false,
      zoom = 1,
      resetZoomLabel,
      onResetZoom,
      children,
      ...props
    },
    ref,
  ) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const status = useContext(DataGridStatusContext);
    const reset = () => {
      const viewport = viewportRef.current;
      onResetZoom?.();
      viewport?.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        if (viewport?.isConnected) {
          (viewport.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"], [role="rowheader"][tabindex="0"]') ?? viewport).focus({ preventScroll: true });
        }
      });
    };
    const resetButton = zoom !== 1 && onResetZoom && resetZoomLabel ? (
      <Tooltip label={resetZoomLabel}>
        <Button
          size="compact"
          variant="ghost"
          aria-label={resetZoomLabel}
          onClick={(event) => {
            event.stopPropagation();
            reset();
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === "0") {
              event.preventDefault();
              event.stopPropagation();
              reset();
            }
          }}
        >
          {Math.round(zoom * 100)}% ↺
        </Button>
      </Tooltip>
    ) : null;
    return (
      <div
        {...props}
        ref={(viewport) => {
          viewportRef.current = viewport;
          if (typeof ref === "function") ref(viewport);
          else if (ref) ref.current = viewport;
        }}
        tabIndex={props.tabIndex ?? -1}
        data-data-grid-scroll
        data-workbench-scroll-owner="grid"
        data-surface={surface}
        data-virtual={virtual}
        data-footer-inset={footerInset}
        className="tw:overflow-auto tw:overscroll-contain tw:scroll-pt-control-sm tw:rounded-lg tw:border tw:border-border-subtle tw:bg-background tw:shadow-panel tw:[&::-webkit-scrollbar]:size-[11px] tw:[&::-webkit-scrollbar-corner]:bg-transparent tw:[&::-webkit-scrollbar-thumb]:rounded-full tw:[&::-webkit-scrollbar-thumb]:border-[var(--ds-border-width-bold)] tw:[&::-webkit-scrollbar-thumb]:border-transparent tw:[&::-webkit-scrollbar-thumb]:bg-muted-foreground tw:[&::-webkit-scrollbar-thumb]:bg-clip-padding tw:[&::-webkit-scrollbar-thumb:hover]:bg-foreground tw:[&::-webkit-scrollbar-track]:bg-transparent tw:data-[surface=panel]:min-h-[180px] tw:data-[surface=panel]:max-h-[60vh] tw:data-[surface=workbench]:min-h-0 tw:data-[surface=workbench]:flex-1 tw:data-[surface=workbench]:rounded-none tw:data-[surface=workbench]:border-0 tw:data-[surface=workbench]:shadow-none tw:data-[surface=embedded]:h-[50cqh] tw:data-[surface=embedded]:min-h-[160px] tw:data-[surface=embedded]:max-h-[360px] tw:data-[surface=embedded]:shrink-0 tw:data-[surface=embedded]:rounded-none tw:data-[surface=embedded]:border-x-0 tw:data-[surface=embedded]:shadow-none tw:data-[virtual=true]:relative tw:data-[virtual=true]:[contain:strict] tw:data-[footer-inset=true]:scroll-pb-12 tw:data-[footer-inset=true]:pb-12"
      >
        {children}
        {status ? (status.host && resetButton ? createPortal(resetButton, status.host) : null) : resetButton ? (
          <div className="tw:pointer-events-none tw:sticky tw:bottom-3 tw:left-0 tw:z-[var(--ds-z-sticky)] tw:h-0 tw:w-full">
            <div className="tw:pointer-events-auto tw:absolute tw:bottom-0 tw:left-1/2 tw:-translate-x-1/2 tw:rounded-md tw:border tw:border-border-strong tw:bg-card tw:shadow-control">
              {resetButton}
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);
