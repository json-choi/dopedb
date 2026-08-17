// Canonical vertical category navigation for dense desktop dialogs. The rail
// owns icon geometry, selected state, tooltip parity, and roving keyboard focus.
import type { ReactNode } from "react";

import { Button } from "./Button";
import { moveTabRovingFocus, tabRovingDirection } from "./tabRovingFocus";

export type IconRailTab<T extends string> = {
  id: T;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
};

export function IconRailTabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: readonly IconRailTab<T>[];
  active: T;
  onChange: (tab: T) => void;
  label: string;
}) {
  return (
    <div
      className="tw:flex tw:w-[42px] tw:shrink-0 tw:flex-col tw:items-center tw:gap-1 tw:border-r tw:border-border-subtle tw:bg-card tw:py-1"
      role="tablist"
      aria-label={label}
      aria-orientation="vertical"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <Button
            key={tab.id}
            iconOnly
            size="compact"
            variant="ghost"
            active={selected}
            role="tab"
            aria-selected={selected}
            disabled={tab.disabled}
            tabIndex={selected ? 0 : -1}
            title={tab.label}
            aria-label={tab.label}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              // The rail is vertical, but nothing to its right claims the
              // horizontal arrows, so ArrowLeft/ArrowRight keep walking the
              // categories the way they did before roving focus was shared.
              const direction = tabRovingDirection(event.key, "vertical", {
                crossAxis: true,
              });
              if (!direction) return;
              event.preventDefault();
              // The rail only swaps an already mounted category pane, so moving
              // focus selects the tab it lands on.
              moveTabRovingFocus(event.currentTarget, direction);
            }}
          >
            {tab.icon}
          </Button>
        );
      })}
    </div>
  );
}
