// Flat IDE tab primitives shared by workbench document strips. Active tabs sit
// inside the strip instead of turning the entire rectangular segment blue, and
// each strip owns one Tab stop with horizontal roving arrow/Home/End focus.
import type {
  KeyboardEvent,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactNode,
  Ref,
} from "react";

import {
  moveTabRovingFocus,
  tabRovingDirection,
  withTabStripFallbackStop,
} from "./tabRovingFocus";

// Both strips read the focused tab from the tablist, so a focused close button
// or rename input never steals the arrow keys.
function rovingTabTarget(event: KeyboardEvent<HTMLDivElement>) {
  if (!(event.target instanceof HTMLElement)) return null;
  return event.target.closest<HTMLElement>('[role="tab"]');
}

export function IdeTabStrip({
  label,
  children,
  actions,
  onKeyDown,
}: {
  label: string;
  children: ReactNode;
  actions?: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
  return (
    <div className="tw:flex tw:h-document-tab tw:min-h-document-tab tw:min-w-0 tw:items-stretch tw:border-b tw:border-border-subtle tw:bg-background">
      <div
        className="ds-control-row tw:flex tw:min-w-0 tw:flex-1 tw:items-stretch tw:overflow-x-auto tw:[scrollbar-width:none] tw:[&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          const direction = tabRovingDirection(event.key, "horizontal");
          const tab = direction ? rovingTabTarget(event) : null;
          if (!direction || !tab) return;
          event.preventDefault();
          // Activating a document tab swaps the whole workbench document, so
          // arrows only move focus and Enter/Space activates the focused tab.
          moveTabRovingFocus(tab, direction, { activate: false });
        }}
      >
        {withTabStripFallbackStop(children)}
      </div>
      {actions ? (
        <div className="ds-control-row tw:flex tw:shrink-0 tw:items-center tw:border-l tw:border-border-subtle tw:px-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function IdeTab({
  active,
  title,
  tabIndex,
  tabRef,
  editing,
  trailing,
  children,
  onActivate,
  onDoubleClick,
}: {
  active: boolean;
  title: string;
  tabIndex?: number;
  tabRef?: Ref<HTMLDivElement>;
  editing?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  onActivate: () => void;
  onDoubleClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <div
      ref={tabRef}
      data-active={active}
      className="tw:my-1 tw:ml-1 tw:flex tw:min-w-[132px] tw:max-w-[220px] tw:flex-[0_0_180px] tw:items-center tw:rounded-sm tw:border tw:border-transparent tw:text-muted-foreground tw:data-[active=true]:border-input tw:data-[active=true]:bg-card tw:data-[active=true]:text-foreground tw:hover:bg-muted tw:max-[760px]:basis-[148px]"
    >
      {editing ?? (
        <button
          type="button"
          className="tw:flex tw:h-full tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:px-2 tw:font-sans tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-inset tw:focus-visible:ring-ring tw:[&_.icon]:shrink-0 tw:[&>span]:min-w-0 tw:[&>span]:overflow-hidden tw:[&>span]:text-ellipsis tw:[&>span]:whitespace-nowrap"
          role="tab"
          aria-selected={active}
          tabIndex={tabIndex ?? (active ? 0 : -1)}
          onClick={onActivate}
          onDoubleClick={onDoubleClick}
          title={title}
        >
          {children}
        </button>
      )}
      {trailing}
    </div>
  );
}

export function IdeToolTabStrip({
  label,
  children,
  status,
  density = "document",
}: {
  label: string;
  children: ReactNode;
  status?: ReactNode;
  density?: "compact" | "document";
}) {
  return (
    <div
      data-density={density}
      className="tw:flex tw:h-document-tab tw:min-h-document-tab tw:shrink-0 tw:items-center tw:border-b tw:border-border-subtle tw:bg-background tw:px-1 tw:data-[density=compact]:h-workbench-toolbar tw:data-[density=compact]:min-h-workbench-toolbar"
    >
      <div
        className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-1 tw:overflow-x-auto tw:[scrollbar-width:none] tw:[&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={(event) => {
          const direction = tabRovingDirection(event.key, "horizontal");
          const tab = direction ? rovingTabTarget(event) : null;
          if (!direction || !tab) return;
          event.preventDefault();
          // Tool tabs only swap an already loaded view, so focus activates.
          moveTabRovingFocus(tab, direction);
        }}
      >
        {withTabStripFallbackStop(children)}
      </div>
      {status}
    </div>
  );
}

export function IdeToolTab({
  active,
  size = "compact",
  tabIndex,
  children,
  onClick,
}: {
  active: boolean;
  size?: "compact" | "document";
  tabIndex?: number;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={tabIndex ?? (active ? 0 : -1)}
      data-active={active}
      data-size={size}
      className="tw:flex tw:h-control-md tw:min-w-[88px] tw:max-w-[min(42vw,420px)] tw:cursor-pointer tw:items-center tw:gap-1.5 tw:overflow-hidden tw:rounded-sm tw:border tw:border-transparent tw:bg-transparent tw:px-3 tw:font-sans tw:text-sm tw:text-ellipsis tw:whitespace-nowrap tw:text-muted-foreground tw:data-[size=document]:min-w-[120px] tw:data-[active=true]:border-selection tw:data-[active=true]:bg-selection tw:data-[active=true]:text-selection-foreground tw:hover:bg-muted tw:hover:text-foreground"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
