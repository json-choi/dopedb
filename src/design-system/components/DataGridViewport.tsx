// Canonical scroll surface shared by table and virtual data-grid renderers. The
// caller chooses whether the grid fills a pane, nests in a scrolling document,
// or sizes as a standalone panel; feature screens never restyle the viewport.
// `DataGridNotice` is the one in-grid status line both renderers use to say why
// a page is missing or why a grid action was refused.
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

export type DataGridSurface = "panel" | "workbench" | "embedded";

type Props = Omit<ComponentPropsWithoutRef<"div">, "className"> & {
  surface?: DataGridSurface;
  virtual?: boolean;
  footerInset?: boolean;
};

export const DataGridViewport = forwardRef<HTMLDivElement, Props>(
  function DataGridViewport(
    { surface = "panel", virtual = false, footerInset = false, ...props },
    ref,
  ) {
    return (
      <div
        {...props}
        ref={ref}
        data-data-grid-scroll
        data-workbench-scroll-owner="grid"
        data-surface={surface}
        data-virtual={virtual}
        data-footer-inset={footerInset}
        className="tw:overflow-auto tw:overscroll-contain tw:scroll-pt-control-sm tw:rounded-lg tw:border tw:border-border-subtle tw:bg-background tw:shadow-panel tw:[&::-webkit-scrollbar]:size-[11px] tw:[&::-webkit-scrollbar-corner]:bg-transparent tw:[&::-webkit-scrollbar-thumb]:rounded-full tw:[&::-webkit-scrollbar-thumb]:border-[var(--ds-border-width-bold)] tw:[&::-webkit-scrollbar-thumb]:border-transparent tw:[&::-webkit-scrollbar-thumb]:bg-muted-foreground tw:[&::-webkit-scrollbar-thumb]:bg-clip-padding tw:[&::-webkit-scrollbar-thumb:hover]:bg-foreground tw:[&::-webkit-scrollbar-track]:bg-transparent tw:data-[surface=panel]:min-h-[180px] tw:data-[surface=panel]:max-h-[60vh] tw:data-[surface=workbench]:min-h-0 tw:data-[surface=workbench]:flex-1 tw:data-[surface=workbench]:rounded-none tw:data-[surface=workbench]:border-0 tw:data-[surface=workbench]:shadow-none tw:data-[surface=embedded]:h-[50cqh] tw:data-[surface=embedded]:min-h-[160px] tw:data-[surface=embedded]:max-h-[360px] tw:data-[surface=embedded]:shrink-0 tw:data-[surface=embedded]:rounded-none tw:data-[surface=embedded]:border-x-0 tw:data-[surface=embedded]:shadow-none tw:data-[virtual=true]:relative tw:data-[virtual=true]:[contain:strict] tw:data-[footer-inset=true]:scroll-pb-12 tw:data-[footer-inset=true]:pb-12"
      />
    );
  },
);

/**
 * Sticky status line pinned inside a grid viewport. Both renderers use it for the
 * same two jobs: a page that could not load, and a grid action refused because
 * the selection contains a cell the backend could not read.
 */
export function DataGridNotice({
  tone,
  children,
}: {
  tone: "danger" | "warning";
  children: ReactNode;
}) {
  return (
    <div
      data-tone={tone}
      role="status"
      className="tw:sticky tw:top-control-sm tw:left-0 tw:z-[var(--ds-z-sticky)] tw:w-fit tw:max-w-[min(520px,90%)] tw:px-2 tw:py-1 tw:font-sans tw:text-xs tw:data-[tone=danger]:bg-danger-muted tw:data-[tone=danger]:text-danger tw:data-[tone=warning]:bg-muted tw:data-[tone=warning]:text-foreground"
    >
      {children}
    </div>
  );
}
