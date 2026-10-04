// Canonical scroll surface shared by table and virtual data-grid renderers. The
// caller chooses whether the grid fills a pane, nests in a scrolling document,
// or sizes as a standalone panel; feature screens never restyle the viewport.
import { forwardRef, type ComponentPropsWithoutRef } from "react";

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
    return (
      <div
        {...props}
        ref={ref}
        tabIndex={props.tabIndex ?? -1}
        data-data-grid-scroll
        data-workbench-scroll-owner="grid"
        data-surface={surface}
        data-virtual={virtual}
        data-footer-inset={footerInset}
        className="tw:overflow-auto tw:overscroll-contain tw:scroll-pt-control-sm tw:rounded-lg tw:border tw:border-border-subtle tw:bg-background tw:shadow-panel tw:[&::-webkit-scrollbar]:size-[11px] tw:[&::-webkit-scrollbar-corner]:bg-transparent tw:[&::-webkit-scrollbar-thumb]:rounded-full tw:[&::-webkit-scrollbar-thumb]:border-[var(--ds-border-width-bold)] tw:[&::-webkit-scrollbar-thumb]:border-transparent tw:[&::-webkit-scrollbar-thumb]:bg-muted-foreground tw:[&::-webkit-scrollbar-thumb]:bg-clip-padding tw:[&::-webkit-scrollbar-thumb:hover]:bg-foreground tw:[&::-webkit-scrollbar-track]:bg-transparent tw:data-[surface=panel]:min-h-[180px] tw:data-[surface=panel]:max-h-[60vh] tw:data-[surface=workbench]:min-h-0 tw:data-[surface=workbench]:flex-1 tw:data-[surface=workbench]:rounded-none tw:data-[surface=workbench]:border-0 tw:data-[surface=workbench]:shadow-none tw:data-[surface=embedded]:h-[50cqh] tw:data-[surface=embedded]:min-h-[160px] tw:data-[surface=embedded]:max-h-[360px] tw:data-[surface=embedded]:shrink-0 tw:data-[surface=embedded]:rounded-none tw:data-[surface=embedded]:border-x-0 tw:data-[surface=embedded]:shadow-none tw:data-[virtual=true]:relative tw:data-[virtual=true]:[contain:strict] tw:data-[footer-inset=true]:scroll-pb-12 tw:data-[footer-inset=true]:pb-12"
      >
        {zoom !== 1 && onResetZoom && resetZoomLabel ? (
          <div className="tw:pointer-events-none tw:sticky tw:top-0 tw:left-0 tw:z-[var(--ds-z-sticky)] tw:h-0 tw:w-full">
            <div className="tw:pointer-events-auto tw:absolute tw:top-2 tw:right-2">
              <Tooltip label={resetZoomLabel}>
                <Button
                  size="compact"
                  aria-label={resetZoomLabel}
                  onClick={(event) => {
                    event.stopPropagation();
                    const viewport = event.currentTarget.closest<HTMLDivElement>("[data-data-grid-scroll]");
                    onResetZoom();
                    viewport?.focus({ preventScroll: true });
                    requestAnimationFrame(() => {
                      if (viewport?.isConnected) {
                        (viewport.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"], [role="rowheader"][tabindex="0"]') ?? viewport).focus({ preventScroll: true });
                      }
                    });
                  }}
                >
                  {Math.round(zoom * 100)}% ↺
                </Button>
              </Tooltip>
            </div>
          </div>
        ) : null}
        {children}
      </div>
    );
  },
);
