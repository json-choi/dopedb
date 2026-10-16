// Canonical application chrome surfaces. Feature code supplies
// commands and state; these primitives own the shared title/status geometry.
import type {
  ButtonHTMLAttributes,
  ReactNode,
  Ref,
} from "react";

import { Tooltip } from "./Tooltip";

export function IdeTitleToolbar({
  macosInset,
  contextAction,
  context,
  launchers,
  launchersLabel,
  actions,
}: {
  macosInset: boolean;
  contextAction?: ReactNode;
  context: ReactNode;
  launchers: ReactNode;
  launchersLabel: string;
  actions: ReactNode;
}) {
  return (
    <header
      className="tw:relative tw:col-[1/-1] tw:row-start-1 tw:z-[var(--ds-z-sticky)] tw:flex tw:h-title-toolbar tw:min-w-0 tw:select-none tw:items-center tw:gap-2 tw:bg-background tw:shadow-[inset_0_-1px_0_var(--ds-border-subtle)] tw:px-4 tw:text-muted-foreground"
      data-tauri-drag-region="deep"
    >
      {macosInset ? (
        <div className="tw:w-[68px] tw:shrink-0" aria-hidden="true" />
      ) : null}
      <div className="tw:min-w-0 tw:shrink-0 tw:max-[561px]:hidden">{context}</div>
      {contextAction}
      <div
        className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:justify-center tw:gap-1"
        role="toolbar"
        aria-label={launchersLabel}
      >
        {launchers}
      </div>
      <div className="tw:ml-auto tw:flex tw:shrink-0 tw:items-center tw:gap-1">
        {actions}
      </div>
    </header>
  );
}

export function WorkspaceNavButton({ active, icon, children, ...props }: {
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  return <button
    type="button"
    aria-pressed={active}
    className="tw:flex tw:min-h-control-xl tw:w-full tw:min-w-0 tw:cursor-pointer tw:items-center tw:gap-3 tw:rounded-sm tw:border-0 tw:bg-transparent tw:px-3 tw:font-sans tw:text-left tw:text-ui tw:text-muted-foreground tw:aria-pressed:bg-selection tw:aria-pressed:text-foreground tw:hover:bg-muted tw:hover:text-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:disabled:cursor-default tw:disabled:opacity-40"
    {...props}
  >{icon}<span className="tw:truncate">{children}</span></button>;
}

export function IdeToolbarLauncher({
  active,
  buttonRef,
  children,
  count = 0,
  title,
  "aria-label": ariaLabel,
  ...buttonProps
}: {
  active?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
  /**
   * Items in this tool window waiting for a person. The caller's label must
   * say the same count; the badge is visual only.
   */
  count?: number;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const tooltipLabel =
    typeof title === "string" && title.trim().length > 0
      ? title
      : typeof ariaLabel === "string" && ariaLabel.trim().length > 0
        ? ariaLabel
        : null;
  const button = (
    <button
      ref={buttonRef}
      type="button"
      data-active={active || undefined}
      aria-pressed={active === undefined ? undefined : active}
      aria-label={ariaLabel ?? tooltipLabel ?? undefined}
      className="tw:relative tw:grid tw:size-control-md tw:shrink-0 tw:cursor-pointer tw:place-items-center tw:rounded-sm tw:border-0 tw:bg-transparent tw:text-[length:var(--ds-icon-md)] tw:text-muted-foreground tw:hover:bg-muted tw:hover:text-foreground tw:data-[active=true]:bg-muted tw:data-[active=true]:text-foreground tw:disabled:cursor-not-allowed tw:disabled:opacity-40 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-inset tw:focus-visible:ring-ring"
      {...buttonProps}
    >
      {children}
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="tw:pointer-events-none tw:absolute tw:top-0.5 tw:right-0.5 tw:grid tw:h-3.5 tw:min-w-3.5 tw:place-items-center tw:rounded-full tw:bg-primary tw:px-1 tw:font-sans tw:text-2xs tw:leading-none tw:font-bold tw:tabular-nums tw:text-primary-foreground"
        >
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </button>
  );
  return tooltipLabel ? (
    <Tooltip label={tooltipLabel}>{button}</Tooltip>
  ) : (
    button
  );
}

export function IdeStatusBarSurface({
  label,
  breadcrumbs,
  children,
}: {
  label: string;
  breadcrumbs: ReactNode;
  children: ReactNode;
}) {
  return (
    <footer
      className="tw:col-[1/-1] tw:row-start-3 tw:z-[var(--ds-z-sticky)] tw:flex tw:h-status-bar tw:min-w-0 tw:items-center tw:overflow-hidden tw:border-t tw:border-border-subtle tw:bg-card tw:text-xs tw:leading-none tw:text-muted-foreground"
      aria-label={label}
    >
      {breadcrumbs}
      <div className="tw:flex-1" />
      {children}
    </footer>
  );
}
