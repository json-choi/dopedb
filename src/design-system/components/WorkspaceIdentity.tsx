// Shared Workspace identity surfaces for hosted authentication and the static Desktop callback.
// Callers own authentication commands; these primitives own only presentation.
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";

export function IdentitySingleShell({ children }: { children: ReactNode }) {
  return (
    <main
      className="tw:relative tw:flex tw:min-h-[100dvh] tw:flex-col tw:items-start tw:px-[clamp(22px,4vw,64px)] tw:py-[clamp(22px,3vw,42px)]"
      id="main-content"
    >
      {children}
    </main>
  );
}

export function IdentityCard({
  children,
  density = "default",
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "className"> & {
  children: ReactNode;
  density?: "compact" | "default";
}) {
  return (
    <section
      data-density={density}
      className="tw:relative tw:w-full tw:overflow-hidden tw:rounded-panel tw:border tw:border-border tw:bg-surface tw:p-12 tw:shadow-panel tw:before:absolute tw:before:top-0 tw:before:left-0 tw:before:h-1 tw:before:w-full tw:before:bg-[linear-gradient(90deg,var(--ds-signal),var(--ds-accent),transparent)] tw:before:content-[''] tw:data-[density=compact]:p-[clamp(28px,4vw,44px)] tw:max-[800px]:p-7"
      {...props}
    >
      {children}
    </section>
  );
}

export function IdentityEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="tw:m-0 tw:font-mono tw:text-2xs tw:font-medium tw:tracking-[0.1em] tw:text-primary tw:uppercase">
      {children}
    </p>
  );
}

export function IdentityTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="tw:my-4 tw:font-serif tw:text-[clamp(36px,5vw,48px)] tw:leading-[1.06] tw:font-normal tw:tracking-[-0.04em]">
      {children}
    </h1>
  );
}

export function IdentityBody({ children }: { children: ReactNode }) {
  return (
    <p className="tw:text-[15px] tw:leading-[1.75] tw:text-muted-foreground">
      {children}
    </p>
  );
}

export function IdentityError({
  children,
  role = "alert",
}: {
  children: ReactNode;
  role?: string;
}) {
  return (
    <div
      className="tw:mt-5 tw:rounded-control tw:border tw:border-danger/30 tw:bg-danger/5 tw:p-3.5 tw:text-xs tw:leading-body tw:text-danger"
      role={role}
    >
      {children}
    </div>
  );
}

export function IdentityPrimaryButton({
  children,
  type = "button",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  children: ReactNode;
}) {
  return (
    <button
      className="tw:mt-7 tw:flex tw:min-h-control-lg tw:w-full tw:cursor-pointer tw:items-center tw:justify-between tw:gap-3 tw:rounded-control tw:border tw:border-chrome tw:bg-chrome tw:px-4 tw:text-[13px] tw:font-semibold tw:text-chrome-foreground tw:transition-[transform,background-color,border-color] tw:duration-200 tw:hover:-translate-y-px tw:hover:border-primary-emphasis tw:hover:bg-primary-emphasis tw:hover:text-primary-foreground tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:active:translate-y-px tw:disabled:cursor-wait tw:disabled:opacity-65 tw:disabled:hover:translate-y-0"
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

// Keep both account identifiers readable when an identity card becomes narrow.
// Authentication commands and navigation remain owned by each calling flow.
export function IdentityAccountChoice({
  name,
  email,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "type"> & {
  name: string;
  email: string;
}) {
  return (
    <button
      {...props}
      type="button"
      className="tw:grid tw:min-h-control-field tw:w-full tw:min-w-0 tw:cursor-pointer tw:content-center tw:gap-1 tw:border-0 tw:border-b tw:border-border tw:bg-transparent tw:px-3 tw:py-2 tw:text-left tw:text-xs tw:text-foreground tw:hover:bg-surface-raised tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-ring tw:disabled:cursor-wait tw:disabled:opacity-[var(--ds-disabled-opacity)]"
    >
      <span className="tw:min-w-0 tw:[overflow-wrap:anywhere]">{name}</span>
      <small className="tw:min-w-0 tw:text-2xs tw:text-muted-foreground tw:[overflow-wrap:anywhere]">
        {email}
      </small>
    </button>
  );
}

export function IdentitySecondaryButton({
  children,
  type = "button",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  children: ReactNode;
}) {
  return (
    <button
      className="tw:mt-2 tw:min-h-control-field tw:w-full tw:cursor-pointer tw:rounded-control tw:border tw:border-border tw:bg-surface tw:px-3 tw:text-xs tw:font-medium tw:text-muted-foreground tw:transition-colors tw:hover:border-primary tw:hover:text-foreground tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:disabled:cursor-wait tw:disabled:opacity-65"
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

export function IdentitySecondaryLink({
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & {
  children: ReactNode;
}) {
  return (
    <a
      className="tw:mt-2 tw:grid tw:min-h-control-field tw:w-full tw:place-items-center tw:rounded-control tw:border tw:border-border tw:bg-surface tw:px-3 tw:text-xs tw:font-medium tw:text-muted-foreground tw:transition-colors tw:hover:border-primary tw:hover:text-foreground tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring"
      {...props}
    >
      {children}
    </a>
  );
}
