// Canonical workbench primitives for editor, data, and result panes. These own
// the dense IDE spacing shared by table data, SQL, and document surfaces.
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Icon, type IconName } from "../../components/Icon";
import { Button, type ButtonProps } from "./Button";

export function WorkbenchPane({ children }: { children: ReactNode }) {
  return (
    <section
      data-workbench-pane
      className="tw:relative tw:flex tw:h-full tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden tw:bg-background tw:[container-type:inline-size]"
    >
      {children}
    </section>
  );
}

export function WorkbenchContainedBody({
  children,
  ...props
}: Omit<ComponentPropsWithoutRef<"div">, "className">) {
  return (
    <div
      {...props}
      data-workbench-body="contained"
      className="tw:relative tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-hidden tw:[container-type:size]"
    >
      {children}
    </div>
  );
}

export function WorkbenchScrollBody({
  children,
  ...props
}: Omit<ComponentPropsWithoutRef<"div">, "className">) {
  return (
    <div
      {...props}
      data-workbench-body="scroll"
      data-workbench-scroll-owner="document"
      className="scrollbar-sleek tw:relative tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-auto tw:overscroll-contain tw:[container-type:size]"
    >
      {children}
    </div>
  );
}

export function WorkbenchToolbar({
  label,
  compact = false,
  children,
}: {
  label: string;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      data-workbench-toolbar
      data-compact={compact}
      className="ds-control-row tw:flex tw:h-workbench-toolbar tw:min-h-workbench-toolbar tw:shrink-0 tw:items-center tw:gap-1 tw:overflow-hidden tw:border-b tw:border-border-subtle tw:bg-background tw:px-2"
    >
      {children}
    </div>
  );
}

export function WorkbenchDivider() {
  return (
    <span
      aria-hidden="true"
      className="tw:mx-1 tw:h-control-sm tw:w-px tw:shrink-0 tw:bg-border-subtle"
    />
  );
}

type WorkbenchButtonProps<T = ButtonProps> = T extends ButtonProps
  ? Omit<T, "size"> & { size?: "md" | "xs" }
  : never;

export function WorkbenchButton({
  size = "md",
  variant = "ghost",
  ...props
}: WorkbenchButtonProps) {
  return (
    <Button
      size={size === "xs" ? "xs" : "compact"}
      variant={variant}
      {...props}
    />
  );
}

export function WorkbenchSelect({
  label,
  title,
  value,
  disabled = false,
  icon,
  onChange,
  children,
}: {
  label: string;
  title?: string;
  value: string;
  disabled?: boolean;
  icon?: IconName;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label
      className="tw:inline-flex tw:h-control-sm tw:min-w-0 tw:max-w-[180px] tw:shrink tw:items-center tw:gap-1 tw:rounded-xs tw:px-1 tw:text-sm tw:text-foreground tw:hover:bg-muted"
      title={title}
    >
      {icon ? (
        <Icon name={icon} className="tw:shrink-0 tw:text-muted-foreground" />
      ) : null}
      <span className="tw:sr-only">{label}</span>
      <select
        className="tw:h-control-sm tw:min-w-0 tw:max-w-[140px] tw:cursor-pointer tw:truncate tw:border-0 tw:bg-transparent tw:p-0 tw:pr-1 tw:font-sans tw:text-sm tw:text-foreground tw:shadow-none tw:outline-none tw:focus:border-transparent tw:focus:shadow-none tw:disabled:cursor-default tw:disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        {children}
      </select>
    </label>
  );
}

export function WorkbenchEmptyState({
  icon,
  children,
}: {
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <div className="tw:flex tw:min-h-[200px] tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:p-4 tw:text-ui tw:text-muted-foreground">
      {icon ? (
        <Icon name={icon} className="tw:text-heading tw:opacity-60" />
      ) : null}
      {children}
    </div>
  );
}

export function ResultMeta({ children }: { children: ReactNode }) {
  return (
    <div className="tw:flex tw:min-h-control-md tw:flex-wrap tw:items-center tw:gap-1 tw:border-b tw:border-border-subtle tw:px-3 tw:py-1 tw:text-sm tw:text-muted-foreground">
      {children}
    </div>
  );
}

export function DataGridStatusPill({
  children,
  actions,
  title,
}: {
  children: ReactNode;
  actions?: ReactNode;
  title?: string;
}) {
  return (
    <footer
      className="tw:absolute tw:bottom-3 tw:left-1/2 tw:z-[var(--ds-z-raised)] tw:flex tw:h-control-lg tw:min-w-[108px] tw:max-w-[calc(100%_-_var(--ds-space-4))] tw:-translate-x-1/2 tw:items-center tw:justify-center tw:gap-1 tw:rounded-md tw:border tw:border-border-strong tw:bg-card tw:px-3 tw:text-sm tw:whitespace-nowrap tw:text-foreground tw:shadow-control"
      title={title}
    >
      <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis">
        {children}
      </span>
      {actions ? (
        <div className="tw:ml-1 tw:flex tw:items-center tw:border-l tw:border-border-subtle tw:pl-2">
          {actions}
        </div>
      ) : null}
    </footer>
  );
}

export function SqlSnippet({ children }: { children: ReactNode }) {
  return (
    <code className="tw:inline-block tw:max-w-[60ch] tw:overflow-hidden tw:rounded-sm tw:bg-muted tw:px-1.5 tw:py-px tw:align-bottom tw:font-mono tw:text-sm tw:text-ellipsis tw:whitespace-nowrap">
      {children}
    </code>
  );
}

export function InspectorHeader({
  title,
  metadata,
  actions,
}: {
  title: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="tw:mb-2 tw:flex tw:items-start tw:justify-between tw:gap-2 tw:@max-[760px]:flex-col">
      <div className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">
        <strong className="tw:min-w-0">{title}</strong>
        {metadata}
      </div>
      {actions ? (
        <div className="ds-control-row tw:flex tw:shrink-0 tw:items-start tw:gap-2 tw:@max-[760px]:w-full tw:@max-[760px]:flex-wrap">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function InspectorFooter({ children }: { children: ReactNode }) {
  return (
    <div className="ds-action-row ds-control-row tw:sticky tw:bottom-[-12px] tw:mx-[-12px] tw:mt-2 tw:mb-[-12px] tw:border-t tw:border-border-subtle tw:bg-card tw:p-3">
      {children}
    </div>
  );
}
