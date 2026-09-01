// Dense tree controls shared by Database Explorer-style tool windows. These
// primitives own keyboard toggling and search chrome so feature trees only
// provide domain labels and results.
import type { KeyboardEventHandler, ReactNode } from "react";

import { Icon, type IconName } from "../../components/Icon";
import type { TreeKeyboardItem } from "../treeKeyboard";

export function TreeSectionButton({
  expanded,
  icon,
  children,
  trailing,
  actions,
  onToggle,
  danger = false,
  selected = false,
  prominence = "default",
  treeItem,
  treeItemContent = false,
}: {
  expanded: boolean;
  icon: IconName;
  children: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  onToggle: () => void;
  danger?: boolean;
  selected?: boolean;
  prominence?: "default" | "project";
  treeItem?: TreeKeyboardItem & { level: number };
  treeItemContent?: boolean;
}) {
  return (
    <div
      data-selected={selected || undefined}
      className={
        danger
          ? "tw:group tw:relative tw:flex tw:h-control-sm tw:min-h-control-sm tw:min-w-0 tw:select-none tw:items-stretch tw:text-sm tw:font-medium tw:leading-ui tw:text-danger tw:data-[selected=true]:bg-selection tw:data-[selected=true]:text-selection-foreground"
          : prominence === "project"
            ? "tw:group tw:relative tw:flex tw:h-control-sm tw:min-h-control-sm tw:min-w-0 tw:select-none tw:items-stretch tw:text-ui tw:font-semibold tw:leading-ui tw:text-foreground tw:hover:bg-muted tw:data-[selected=true]:bg-selection tw:data-[selected=true]:text-selection-foreground"
          : "tw:group tw:relative tw:flex tw:h-control-sm tw:min-h-control-sm tw:min-w-0 tw:select-none tw:items-stretch tw:text-sm tw:font-medium tw:leading-ui tw:text-foreground tw:hover:bg-muted tw:data-[selected=true]:bg-selection tw:data-[selected=true]:text-selection-foreground"
      }
    >
      <button
        type="button"
        className="tw:flex tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:items-center tw:gap-1 tw:border-0 tw:bg-transparent tw:px-1 tw:py-[var(--ds-tree-row-padding-block)] tw:text-left tw:font-inherit tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-level={treeItem?.level}
        aria-selected={treeItem ? selected : undefined}
        data-explorer-tree-item={treeItem ? true : undefined}
        data-explorer-tree-key={treeItem?.key}
        data-explorer-tree-parent-key={treeItem?.parentKey ?? undefined}
        data-tree-expander={treeItem || treeItemContent ? true : undefined}
        data-tree-primary-action={treeItem || treeItemContent ? true : undefined}
        role={treeItem ? "treeitem" : undefined}
        tabIndex={treeItem || treeItemContent ? -1 : undefined}
        onClick={onToggle}
      >
        <span className="tw:grid tw:w-[var(--ds-icon-sm)] tw:shrink-0 tw:place-items-center tw:text-2xs">
          <Icon name={expanded ? "chevronDown" : "chevronRight"} />
        </span>
        <Icon
          name={icon}
          className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)]"
        />
        <span className="tw:min-w-0 tw:flex-1 tw:truncate">{children}</span>
        {trailing}
      </button>
      {actions}
    </div>
  );
}

export function TreeRowActions({ children }: { children: ReactNode }) {
  return (
    <span
      className="tw:pointer-events-none tw:absolute tw:top-1/2 tw:right-1 tw:z-10 tw:flex tw:-translate-y-1/2 tw:items-center tw:gap-[2px] tw:rounded-sm tw:bg-inherit tw:pl-1 tw:opacity-0 tw:transition-opacity tw:group-hover:pointer-events-auto tw:group-hover:opacity-100 tw:group-focus-within:pointer-events-auto tw:group-focus-within:opacity-100"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  );
}

export function TreeSearch({
  value,
  placeholder,
  clearLabel,
  onChange,
  autoFocus = false,
  onEscape,
  onKeyDown,
}: {
  value: string;
  placeholder: string;
  clearLabel: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  onEscape?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <label className="tw:relative tw:block tw:min-w-0">
      <Icon
        name="search"
        className="tw:pointer-events-none tw:absolute tw:top-1/2 tw:left-2 tw:-translate-y-1/2 tw:text-xs tw:text-muted-foreground"
      />
      <input
        type="search"
        className="tw:h-control-sm tw:min-h-control-sm tw:w-full tw:rounded-xs tw:border tw:border-input tw:bg-background tw:pr-7 tw:pl-7 tw:font-sans tw:text-sm tw:text-foreground tw:outline-none tw:placeholder:text-muted-foreground tw:focus:border-ring"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onEscape) {
            event.preventDefault();
            onEscape();
            return;
          }
          onKeyDown?.(event);
        }}
      />
      {value ? (
        <button
          type="button"
          className="tw:absolute tw:top-1/2 tw:right-1 tw:grid tw:size-6 tw:-translate-y-1/2 tw:cursor-pointer tw:place-items-center tw:rounded-xs tw:border-0 tw:bg-transparent tw:text-xs tw:text-muted-foreground tw:hover:bg-muted tw:hover:text-foreground"
          onClick={() => onChange("")}
          title={clearLabel}
          aria-label={clearLabel}
        >
          <Icon name="close" />
        </button>
      ) : null}
    </label>
  );
}
