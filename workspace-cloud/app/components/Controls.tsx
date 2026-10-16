// The Workspace Web's one compact command button. Workspace administration moved
// to Desktop; the remaining browser surfaces only need this action style.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function ControlButton({
  tone = "neutral",
  size = "small",
  type = "button",
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  tone?: "danger" | "neutral" | "primary";
  size?: "field" | "small";
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      type={type}
      data-tone={tone}
      data-size={size}
      className="tw:inline-flex tw:h-control-sm tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-control tw:border tw:border-border tw:bg-surface tw:px-3.5 tw:text-2xs tw:font-medium tw:text-foreground tw:no-underline tw:aria-pressed:bg-selection tw:aria-pressed:text-selection-foreground tw:aria-pressed:border-primary tw:shadow-[inset_0_1px_0_color-mix(in_srgb,var(--ds-white)_70%,transparent)] tw:transition-[transform,background-color,border-color,color] tw:duration-200 tw:data-[size=field]:h-control-field tw:data-[size=field]:px-4 tw:data-[tone=danger]:text-danger tw:data-[tone=primary]:border-primary-emphasis tw:data-[tone=primary]:bg-primary-emphasis tw:data-[tone=primary]:font-semibold tw:data-[tone=primary]:text-primary-foreground tw:data-[tone=primary]:shadow-none tw:hover:-translate-y-px tw:hover:border-primary tw:hover:bg-surface-raised tw:data-[tone=primary]:hover:bg-primary tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:active:translate-y-px tw:disabled:cursor-not-allowed tw:disabled:opacity-[var(--ds-disabled-opacity)] tw:disabled:hover:translate-y-0"
    >
      {children}
    </button>
  );
}
