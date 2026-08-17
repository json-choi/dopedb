// Dense tabs for settings and database-property panels. The active state is
// expressed with ARIA so one canonical class contract serves every consumer,
// and the strip owns one Tab stop with horizontal roving arrow/Home/End focus.
import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

import { moveTabRovingFocus, tabRovingDirection } from "./tabRovingFocus";

export type PanelTab<T extends string> = {
  id: T;
  label: ReactNode;
  disabled?: boolean;
};

export function PanelTabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: readonly PanelTab<T>[];
  active: T;
  onChange: (tab: T) => void;
  label: string;
}) {
  const tabListRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const revealActiveTab = useCallback(() => {
    const tabList = tabListRef.current;
    const activeTab = activeTabRef.current;
    if (!tabList || !activeTab) return;

    const tabLeft = activeTab.offsetLeft;
    const tabRight = tabLeft + activeTab.offsetWidth;
    const visibleLeft = tabList.scrollLeft;
    const visibleRight = visibleLeft + tabList.clientWidth;
    if (tabLeft < visibleLeft) {
      tabList.scrollTo({ left: tabLeft, behavior: "auto" });
    } else if (tabRight > visibleRight) {
      tabList.scrollTo({
        left: Math.max(0, tabRight - tabList.clientWidth),
        behavior: "auto",
      });
    }
  }, []);

  useLayoutEffect(() => {
    revealActiveTab();
    const tabList = tabListRef.current;
    if (!tabList || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(revealActiveTab);
    observer.observe(tabList);
    return () => observer.disconnect();
  }, [active, revealActiveTab]);

  return (
    <div
      ref={tabListRef}
      className="tw:flex tw:min-w-0 tw:shrink-0 tw:items-end tw:gap-1 tw:overflow-x-auto tw:border-b tw:border-border-subtle tw:bg-card tw:px-3"
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
    >
      {tabs.map((tab) => (
        <button
          ref={active === tab.id ? activeTabRef : undefined}
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          disabled={tab.disabled}
          className="tw:relative tw:h-control-lg tw:shrink-0 tw:cursor-pointer tw:border-0 tw:bg-transparent tw:px-3 tw:font-sans tw:text-sm tw:text-muted-foreground tw:after:absolute tw:after:right-2 tw:after:bottom-0 tw:after:left-2 tw:after:h-0.5 tw:after:bg-transparent tw:aria-selected:text-foreground tw:aria-selected:after:bg-primary tw:disabled:cursor-default tw:disabled:opacity-40 tw:hover:text-foreground"
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const direction = tabRovingDirection(event.key, "horizontal");
            if (!direction) return;
            event.preventDefault();
            moveTabRovingFocus(event.currentTarget, direction);
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
