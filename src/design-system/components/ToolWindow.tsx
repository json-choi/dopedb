// Canonical dense tool-window primitives shared by explorer, assistant, and
// provider surfaces. Consumers provide content and actions, while this module
// owns the repeated compact spacing and interaction contract.
import type {
  ButtonHTMLAttributes,
  FormHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";

import { Icon } from "../../components/Icon";
import { Button } from "./Button";

export function ToolWindowSideSurface({
  compact = false,
  compactOpen = false,
  children,
  ...asideProps
}: {
  compact?: boolean;
  compactOpen?: boolean;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className">) {
  const open = !compact || compactOpen;
  return (
    <aside
      {...asideProps}
      className="sidebar tw:mt-0 tw:mr-0 tw:mb-1 tw:ml-[2px] tw:flex tw:h-[calc(100%_-_var(--ds-space-1))] tw:min-h-0 tw:w-[calc(100%_-_2px)] tw:flex-col tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle tw:bg-background tw:data-[compact=true]:fixed tw:data-[compact=true]:top-title-toolbar tw:data-[compact=true]:right-0 tw:data-[compact=true]:bottom-status-bar tw:data-[compact=true]:left-0 tw:data-[compact=true]:z-[var(--ds-z-modal)] tw:data-[compact=true]:m-0 tw:data-[compact=true]:h-auto tw:data-[compact=true]:w-screen tw:data-[compact=true]:rounded-none tw:data-[compact=true]:border-x-0 tw:data-[compact=true]:shadow-popover tw:data-[compact=true]:transition-transform tw:data-[compact=true]:duration-150 tw:data-[open=false]:pointer-events-none tw:data-[open=false]:-translate-x-full"
      data-compact={compact}
      data-open={open}
      aria-hidden={!open || asideProps["aria-hidden"]}
      inert={!open || asideProps.inert ? true : undefined}
    >
      {children}
    </aside>
  );
}

export function ToolWindowHeader({
  title,
  actions,
  divider = true,
}: {
  title: ReactNode;
  actions?: ReactNode;
  divider?: boolean;
}) {
  return (
    <header
      data-divider={divider || undefined}
      className="tw:flex tw:h-[calc(var(--ds-tool-window-header-height)_-_1px)] tw:min-h-[calc(var(--ds-tool-window-header-height)_-_1px)] tw:shrink-0 tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-transparent tw:bg-background tw:px-3 tw:text-ui tw:data-[divider=true]:border-border-subtle"
    >
      <strong className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
        {title}
      </strong>
      {actions ? (
        <div className="tw:flex tw:items-center tw:gap-[2px]">{actions}</div>
      ) : null}
    </header>
  );
}

export function ToolWindowSearchRow({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-1 tw:border-b tw:border-border-subtle tw:px-1 tw:pt-1 tw:pb-[3px]">
      {children}
    </div>
  );
}

export function ToolWindowSection({
  title,
  prominence = "subtle",
  children,
}: {
  title: ReactNode;
  prominence?: "subtle" | "catalog";
  children: ReactNode;
}) {
  return (
    <section className="tw:grid tw:gap-[2px]">
      <h3
        data-prominence={prominence}
        className="tw:mt-0 tw:mb-1 tw:px-2 tw:text-xs tw:font-semibold tw:tracking-[0.03em] tw:text-muted-foreground tw:data-[prominence=catalog]:mt-1 tw:data-[prominence=catalog]:px-5 tw:data-[prominence=catalog]:text-ui tw:data-[prominence=catalog]:tracking-normal tw:data-[prominence=catalog]:text-foreground"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ToolWindowVerticalSplit({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="tw:grid tw:min-h-0 tw:flex-1 tw:grid-rows-[minmax(0,var(--ds-tool-window-primary-ratio))_minmax(0,1fr)] tw:[&>*]:min-h-0 tw:[&>*:first-child]:border-b tw:[&>*:first-child]:border-border-subtle">
      {children}
    </div>
  );
}

export function ToolWindowAction({
  leading,
  trailing,
  selected = false,
  flush = false,
  children,
  ...buttonProps
}: {
  leading: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  flush?: boolean;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const hasTrailing = trailing != null;
  return (
    <button
      type="button"
      data-flush={flush || undefined}
      data-trailing={hasTrailing || undefined}
      className="tw:grid tw:min-h-control-md tw:w-full tw:cursor-pointer tw:grid-cols-[20px_minmax(0,1fr)] tw:items-center tw:gap-2 tw:rounded-xs tw:border-0 tw:bg-transparent tw:px-2 tw:font-sans tw:text-left tw:text-sm tw:text-foreground tw:aria-pressed:bg-selection tw:aria-pressed:text-selection-foreground tw:data-[flush=true]:rounded-none tw:data-[flush=true]:px-5 tw:data-[trailing=true]:grid-cols-[20px_minmax(0,1fr)_16px] tw:disabled:cursor-progress tw:disabled:opacity-50 tw:hover:bg-muted"
      aria-pressed={selected}
      {...buttonProps}
    >
      {leading}
      <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
        {children}
      </span>
      {hasTrailing ? (
        <span className="tw:text-xs tw:text-muted-foreground">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

export function ToolWindowHideButton({
  label,
  buttonRef,
  ...buttonProps
}: {
  label: string;
  buttonRef?: Ref<HTMLButtonElement>;
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "title" | "aria-label"
>) {
  return (
    <Button
      ref={buttonRef}
      iconOnly
      size="xs"
      variant="ghost"
      title={label}
      aria-label={label}
      {...buttonProps}
    >
      <Icon name="minus" />
    </Button>
  );
}

export function ToolWindowComposerDock({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="tw:mx-3 tw:flex tw:shrink-0 tw:flex-col">
      {children}
    </div>
  );
}

export function ToolWindowComposer({
  children,
  expanded = false,
  busy = false,
  ...formProps
}: FormHTMLAttributes<HTMLFormElement> & {
  expanded?: boolean;
  busy?: boolean;
}) {
  return (
    <form
      data-expanded={expanded || undefined}
      data-busy={busy || undefined}
      className="tw:relative tw:flex tw:min-h-[108px] tw:flex-col tw:rounded-md tw:border tw:border-input tw:bg-background tw:focus-within:border-ring tw:data-[busy=true]:border-ring tw:data-[expanded=true]:min-h-[240px]"
      {...formProps}
    >
      {children}
    </form>
  );
}

export function ToolWindowComposerInput(
  textareaProps: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      className="tw:min-h-16 tw:w-full tw:flex-1 tw:resize-none tw:border-0 tw:bg-transparent tw:pt-3 tw:pr-10 tw:pb-2 tw:pl-3 tw:font-sans tw:text-sm tw:leading-body tw:text-foreground tw:shadow-none tw:outline-none tw:placeholder:text-muted-foreground"
      {...textareaProps}
    />
  );
}

export function ToolWindowComposerContext({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="tw:grid tw:h-control-md tw:shrink-0 tw:grid-cols-[auto_minmax(0,max-content)_minmax(4rem,1fr)] tw:items-center tw:gap-1 tw:px-2">
      {children}
    </div>
  );
}
