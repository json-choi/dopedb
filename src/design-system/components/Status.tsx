// Small semantic status primitives shared by tool windows and asynchronous
// workflows. Color always communicates state, never navigation selection.
import type { HTMLAttributes, ReactNode } from "react";

import { Icon, type IconName } from "../../components/Icon";
import { Tooltip } from "./Tooltip";

export type StatusTone = "neutral" | "success" | "warning" | "danger";

export function StatusBadge({
  tone = "neutral",
  density = "default",
  iconOnly = false,
  title,
  children,
  ...props
}: {
  tone?: StatusTone;
  density?: "default" | "compact";
  iconOnly?: boolean;
  title?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className">) {
  return (
    <span
      data-tone={tone}
      data-density={density}
      data-icon-only={iconOnly}
      className="tw:inline-flex tw:min-h-[20px] tw:max-w-full tw:min-w-0 tw:shrink-0 tw:items-center tw:gap-1 tw:overflow-hidden tw:rounded-xs tw:border tw:border-l-2 tw:border-border-subtle tw:border-l-border-strong tw:bg-transparent tw:px-1.5 tw:font-mono tw:text-2xs tw:font-medium tw:leading-none tw:tracking-[0.02em] tw:text-ellipsis tw:whitespace-nowrap tw:text-muted-foreground tw:data-[density=compact]:min-h-[18px] tw:data-[density=compact]:px-1.5 tw:data-[icon-only=true]:size-control-md tw:data-[icon-only=true]:min-w-control-md tw:data-[icon-only=true]:justify-center tw:data-[icon-only=true]:gap-0 tw:data-[icon-only=true]:p-0 tw:data-[tone=danger]:border-l-danger tw:data-[tone=danger]:text-danger tw:data-[tone=success]:border-l-success tw:data-[tone=success]:text-success tw:data-[tone=warning]:border-l-warning tw:data-[tone=warning]:text-warning tw:[&_.icon]:shrink-0"
      title={title}
      {...props}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral" }: { tone?: StatusTone }) {
  return (
    <span
      data-tone={tone}
      aria-hidden="true"
      className="tw:size-2 tw:shrink-0 tw:rounded-full tw:bg-muted-foreground tw:data-[tone=danger]:bg-danger tw:data-[tone=success]:bg-success tw:data-[tone=warning]:bg-warning"
    />
  );
}

export function StatusBarItem({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        className="tw:inline-flex tw:h-full tw:min-w-0 tw:shrink-0 tw:cursor-pointer tw:items-center tw:gap-1 tw:whitespace-nowrap tw:border-0 tw:border-l tw:border-border-subtle tw:bg-transparent tw:px-2 tw:font-sans tw:text-inherit tw:hover:bg-muted tw:hover:text-foreground tw:focus-visible:bg-muted tw:focus-visible:text-foreground tw:focus-visible:outline-none"
        onClick={onClick}
        title={title}
      >
        {children}
      </button>
    );
  }

  return (
    <span
      className="tw:inline-flex tw:h-full tw:min-w-0 tw:shrink-0 tw:items-center tw:gap-1 tw:whitespace-nowrap tw:border-0 tw:border-l tw:border-border-subtle tw:bg-transparent tw:px-2 tw:font-sans tw:text-inherit"
      title={title}
    >
      {children}
    </span>
  );
}

export function StatusBarBreadcrumbs({
  label,
  items,
}: {
  label: string;
  items: ReadonlyArray<{
    id: string;
    label: string;
    onSelect?: () => void;
  }>;
}) {
  return (
    <nav
      className="tw:flex tw:h-full tw:min-w-0 tw:items-center tw:overflow-hidden tw:px-2"
      aria-label={label}
    >
      {items.map((item, index) => (
        <span
          key={item.id}
          className="tw:flex tw:min-w-0 tw:items-center tw:gap-1"
        >
          {index > 0 ? (
            <Icon
              name="chevronRight"
              className="tw:size-3 tw:shrink-0 tw:text-muted-foreground"
            />
          ) : null}
          {item.onSelect ? (
            <button
              type="button"
              data-current={index === items.length - 1 || undefined}
              className="tw:min-w-0 tw:cursor-pointer tw:truncate tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-inherit tw:hover:text-foreground tw:focus-visible:text-foreground tw:focus-visible:outline-none tw:focus-visible:underline tw:data-[current=true]:text-foreground"
              onClick={item.onSelect}
            >
              {item.label}
            </button>
          ) : (
            <span
              data-current={index === items.length - 1 || undefined}
              className="tw:truncate tw:data-[current=true]:text-foreground"
            >
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function StatusBarIconButton({
  icon,
  label,
  onClick,
  attention = false,
  spinning = false,
  disabled = false,
  children,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  attention?: boolean;
  spinning?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="tw:relative tw:inline-flex tw:h-full tw:min-w-7 tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:gap-1 tw:border-0 tw:border-l tw:border-border-subtle tw:bg-transparent tw:px-1.5 tw:font-sans tw:text-inherit tw:disabled:cursor-default tw:disabled:opacity-40 tw:not-disabled:hover:bg-muted tw:not-disabled:hover:text-foreground tw:not-disabled:focus-visible:bg-muted tw:not-disabled:focus-visible:text-foreground tw:focus-visible:outline-none"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        <Icon
          name={icon}
          className={
            spinning
              ? "tw:animate-spin tw:motion-reduce:animate-none"
              : undefined
          }
        />
        {children}
        {attention ? (
          <span
            className="tw:absolute tw:top-1 tw:right-1 tw:size-1.5 tw:rounded-full tw:bg-primary"
            aria-hidden="true"
          />
        ) : null}
      </button>
    </Tooltip>
  );
}

export function LoadingLabel({ children }: { children: ReactNode }) {
  return (
    <span
      role="status"
      className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1.5 tw:text-muted-foreground"
    >
      <Icon
        name="refresh"
        className="tw:size-3 tw:animate-spin tw:motion-reduce:animate-none"
      />
      <span>{children}</span>
    </span>
  );
}

export function InlineNotice({
  tone,
  icon,
  children,
  action,
  role,
}: {
  tone: "warning" | "danger";
  icon: IconName;
  children: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      data-tone={tone}
      className="tw:grid tw:min-w-0 tw:grid-cols-[var(--ds-icon-md)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:px-3 tw:py-2 tw:text-xs tw:data-[tone=danger]:border-danger-border tw:data-[tone=danger]:bg-danger-muted tw:data-[tone=warning]:border-warning tw:data-[tone=warning]:bg-muted tw:max-[640px]:grid-cols-[var(--ds-icon-md)_minmax(0,1fr)]"
      role={role}
    >
      <Icon
        name={icon}
        data-tone={tone}
        className="tw:data-[tone=danger]:text-danger"
      />
      <span className="tw:min-w-0">{children}</span>
      {action ? (
        <span className="tw:max-[640px]:col-start-2 tw:max-[640px]:justify-self-start">
          {action}
        </span>
      ) : null}
    </div>
  );
}
