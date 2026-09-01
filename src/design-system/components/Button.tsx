// Canonical Tailwind button primitive. Visual variants, density, icon geometry,
// active state, and compact visibility are semantic props rather than class maps.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

import { Tooltip } from "./Tooltip";

type ButtonBaseProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "className" | "title" | "type"
> & {
  active?: boolean;
  collapse?: "never" | "compact" | "narrow";
  presentation?: "button" | "menuItem";
  size?: "default" | "compact" | "xs" | "tree";
  tone?: "danger" | "neutral" | "primary" | "success";
  variant?: "danger" | "dangerGhost" | "default" | "ghost" | "primary" | "selected";
  type?: "button" | "submit" | "reset";
  children: ReactNode;
};

type IconButtonAccessibleName =
  | { "aria-label": string; title?: string }
  | { "aria-label"?: string; title: string };

export type ButtonProps = ButtonBaseProps &
  (
    | ({ iconOnly: true } & IconButtonAccessibleName)
    | {
        iconOnly?: false;
        "aria-label"?: string;
        title?: string;
      }
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    active = false,
    collapse = "never",
    iconOnly = false,
    presentation = "button",
    size = "default",
    tone = "neutral",
    variant = "default",
    children,
    type = "button",
    title,
    "aria-label": ariaLabel,
    ...props
  },
  ref,
) {
  const tooltipLabel =
    typeof ariaLabel === "string" && ariaLabel.trim().length > 0
      ? ariaLabel
      : typeof title === "string" && title.trim().length > 0
        ? title
        : null;
  if (iconOnly && !tooltipLabel) {
    throw new Error("Button iconOnly requires a non-empty title or aria-label");
  }
  const button = (
    <button
      ref={ref}
      type={type}
      title={iconOnly ? undefined : title}
      aria-label={iconOnly ? tooltipLabel ?? undefined : ariaLabel}
      role={presentation === "menuItem" ? "menuitem" : undefined}
      data-active={active}
      data-collapse={collapse}
      data-icon-only={iconOnly}
      data-presentation={presentation}
      data-size={size}
      data-tone={tone}
      data-variant={variant}
      className="tw:inline-flex tw:h-control-lg tw:min-h-control-lg tw:max-w-full tw:min-w-0 tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:gap-2 tw:overflow-hidden tw:rounded-sm tw:border tw:border-input tw:bg-secondary tw:px-3 tw:font-sans tw:text-sm tw:font-medium tw:leading-none tw:text-foreground tw:shadow-control tw:transition-colors tw:data-[presentation=menuItem]:h-auto tw:data-[presentation=menuItem]:min-h-control-md tw:data-[presentation=menuItem]:w-full tw:data-[presentation=menuItem]:justify-start tw:data-[presentation=menuItem]:border-transparent tw:data-[presentation=menuItem]:bg-transparent tw:data-[presentation=menuItem]:px-2 tw:data-[presentation=menuItem]:text-left tw:data-[presentation=menuItem]:shadow-none tw:data-[variant=danger]:border-transparent tw:data-[variant=danger]:bg-destructive tw:data-[variant=danger]:text-destructive-foreground tw:data-[variant=danger]:shadow-none tw:data-[variant=dangerGhost]:border-transparent tw:data-[variant=dangerGhost]:bg-transparent tw:data-[variant=dangerGhost]:text-danger tw:data-[variant=dangerGhost]:shadow-none tw:data-[variant=ghost]:border-transparent tw:data-[variant=ghost]:bg-transparent tw:data-[variant=ghost]:shadow-none tw:data-[variant=primary]:border-transparent tw:data-[variant=primary]:bg-primary tw:data-[variant=primary]:text-primary-foreground tw:data-[variant=primary]:shadow-none tw:data-[variant=selected]:border-transparent tw:data-[variant=selected]:bg-selection tw:data-[variant=selected]:text-selection-foreground tw:data-[variant=selected]:shadow-none tw:data-[size=compact]:h-control-md tw:data-[size=compact]:min-h-control-md tw:data-[size=compact]:px-2 tw:data-[size=xs]:h-control-sm tw:data-[size=xs]:min-h-control-sm tw:data-[size=xs]:rounded-xs tw:data-[size=xs]:px-2 tw:data-[size=xs]:text-ui tw:data-[size=tree]:h-control-xs tw:data-[size=tree]:min-h-control-xs tw:data-[size=tree]:rounded-xs tw:data-[size=tree]:px-1.5 tw:data-[size=tree]:text-xs tw:data-[icon-only=true]:size-control-lg tw:data-[icon-only=true]:min-w-control-lg tw:data-[icon-only=true]:gap-0 tw:data-[icon-only=true]:px-0 tw:data-[icon-only=true]:text-muted-foreground tw:data-[size=compact]:data-[icon-only=true]:size-control-md tw:data-[size=compact]:data-[icon-only=true]:min-w-control-md tw:data-[size=xs]:data-[icon-only=true]:size-control-sm tw:data-[size=xs]:data-[icon-only=true]:min-w-control-sm tw:data-[size=tree]:data-[icon-only=true]:size-control-xs tw:data-[size=tree]:data-[icon-only=true]:min-w-control-xs tw:data-[tone=danger]:text-danger tw:data-[tone=primary]:text-primary tw:data-[tone=success]:text-success tw:data-[active=true]:border-transparent tw:data-[active=true]:bg-selection tw:data-[active=true]:text-selection-foreground tw:aria-expanded:border-transparent tw:aria-expanded:bg-selection tw:aria-expanded:text-selection-foreground tw:aria-pressed:border-transparent tw:aria-pressed:bg-selection tw:aria-pressed:text-selection-foreground tw:hover:bg-muted tw:hover:text-foreground tw:data-[variant=danger]:hover:bg-destructive tw:data-[variant=danger]:hover:text-destructive-foreground tw:data-[variant=dangerGhost]:hover:bg-danger-muted tw:data-[variant=dangerGhost]:hover:text-danger tw:data-[variant=primary]:hover:bg-primary-hover tw:data-[variant=primary]:hover:text-primary-foreground tw:focus-visible:border-ring tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring/30 tw:disabled:cursor-default tw:disabled:opacity-50 tw:@max-[480px]:data-[collapse=compact]:hidden tw:@max-[760px]:data-[collapse=narrow]:hidden tw:[&_.icon]:shrink-0 tw:[&_.icon]:text-[length:var(--ds-icon-sm)]"
      {...props}
    >
      {children}
    </button>
  );
  return iconOnly && tooltipLabel ? (
    <Tooltip label={tooltipLabel}>{button}</Tooltip>
  ) : (
    button
  );
});
