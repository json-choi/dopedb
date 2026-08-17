// Shared roving keyboard focus for ARIA tab strips. One tab owns the Tab stop
// and the arrow keys walk the strip, so consumers only decide the orientation
// and whether moving focus also activates the tab. The same module also restores
// the strip's Tab stop when no tab is active.
import { Children, cloneElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

export type TabRovingDirection = "end" | "next" | "previous" | "start";

export function tabRovingDirection(
  key: string,
  orientation: "horizontal" | "vertical",
  // `crossAxis` also accepts the perpendicular arrow pair. Only a strip with no
  // neighbour claiming that axis may opt in; a document or tool tab row leaves
  // ArrowUp/ArrowDown to the surrounding scroll and pane commands.
  { crossAxis = false }: { crossAxis?: boolean } = {},
): TabRovingDirection | null {
  const vertical = orientation === "vertical";
  const next = vertical ? "ArrowDown" : "ArrowRight";
  const previous = vertical ? "ArrowUp" : "ArrowLeft";
  const crossNext = vertical ? "ArrowRight" : "ArrowDown";
  const crossPrevious = vertical ? "ArrowLeft" : "ArrowUp";
  if (key === next || (crossAxis && key === crossNext)) return "next";
  if (key === previous || (crossAxis && key === crossPrevious)) {
    return "previous";
  }
  if (key === "Home") return "start";
  if (key === "End") return "end";
  return null;
}

type TabStripChildProps = { active?: boolean; tabIndex?: number };

// Roving focus gives the Tab stop to the active tab, so a strip whose consumer
// has no matching active tab yet would be unreachable by the Tab key. The first
// tab takes the stop back in that case. A tab with an explicit `tabIndex` keeps
// its consumer's own fallback, and normalising the children on every render
// keeps the keys stable so a tab never remounts when the stop moves.
export function withTabStripFallbackStop(children: ReactNode): ReactNode {
  const items = Children.toArray(children);
  const tabs = items.filter(
    (item): item is ReactElement<TabStripChildProps> =>
      isValidElement<TabStripChildProps>(item) &&
      typeof item.props.active === "boolean",
  );
  if (tabs.some((tab) => tab.props.active)) return items;
  const fallback = tabs.find((tab) => tab.props.tabIndex === undefined);
  if (!fallback) return items;
  return items.map((item) =>
    item === fallback ? cloneElement(fallback, { tabIndex: 0 }) : item,
  );
}

export function moveTabRovingFocus(
  current: HTMLElement,
  direction: TabRovingDirection,
  { activate = true }: { activate?: boolean } = {},
) {
  const strip = current.closest('[role="tablist"]');
  if (!strip) return;

  const tabs = Array.from(
    strip.querySelectorAll<HTMLElement>('[role="tab"]'),
  ).filter((tab) => !tab.matches(':disabled, [aria-disabled="true"]'));
  if (tabs.length === 0) return;

  const index = tabs.indexOf(current);
  const target =
    direction === "start"
      ? tabs[0]
      : direction === "end"
        ? tabs[tabs.length - 1]
        : direction === "next"
          ? tabs[(index + 1 + tabs.length) % tabs.length]
          : tabs[(index - 1 + tabs.length) % tabs.length];
  if (!target) return;

  target.focus();
  if (activate) target.click();
}
