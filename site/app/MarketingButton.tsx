import type { AnchorHTMLAttributes, ComponentPropsWithRef, ReactNode } from "react";
import {
  TrackedLink,
  type TrackedLinkTrackingProps,
} from "./TrackedLink";

type MarketingButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  variant: "primary" | "secondary";
} & TrackedLinkTrackingProps;

export function MarketingButton({
  children,
  variant,
  ...props
}: MarketingButtonProps) {
  return (
    <TrackedLink
      {...props}
      data-variant={variant}
      className="tw:group tw:inline-flex tw:min-h-[52px] tw:items-center tw:justify-center tw:gap-3 tw:border tw:border-hairline-strong tw:px-5 tw:py-3 tw:font-mono tw:text-[12px] tw:leading-none tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:transition-[transform,box-shadow,background-color,border-color,color] tw:duration-200 tw:hover:-translate-y-0.5 tw:focus-visible:outline-electric tw:max-[620px]:w-full tw:data-[variant=primary]:border-signal tw:data-[variant=primary]:bg-signal tw:data-[variant=primary]:text-night tw:data-[variant=primary]:shadow-signal tw:data-[variant=primary]:hover:bg-signal-strong tw:data-[variant=secondary]:bg-transparent tw:data-[variant=secondary]:text-cream tw:data-[variant=secondary]:hover:border-cream/55 tw:data-[variant=secondary]:hover:bg-cream/5 tw:[&_svg]:transition-transform tw:[&_svg]:duration-200 tw:hover:[&_svg]:translate-x-0.5 tw:motion-reduce:transition-none tw:motion-reduce:hover:translate-y-0 tw:motion-reduce:[&_svg]:transition-none tw:motion-reduce:hover:[&_svg]:translate-x-0"
    >
      {children}
    </TrackedLink>
  );
}

// Native actions share the public site's control treatment, not Desktop's density.
export function MarketingAction({
  tone = "quiet", shape = "default", children, ...props
}: Omit<ComponentPropsWithRef<"button">, "className"> & {
  tone?: "quiet" | "primary";
  shape?: "default" | "orbit" | "icon";
}) {
  return <button {...props} type={props.type ?? "button"} data-tone={tone} data-shape={shape}
    className="tw:inline-flex tw:min-h-11 tw:items-center tw:justify-center tw:gap-2.5 tw:rounded-sm tw:border tw:border-hairline-strong tw:bg-transparent tw:px-4 tw:py-2.5 tw:text-[13px] tw:font-medium tw:text-cream tw:transition-[background-color,border-color,transform] tw:duration-200 tw:enabled:hover:border-cream/55 tw:enabled:hover:bg-cream/5 tw:enabled:active:translate-y-px tw:disabled:cursor-not-allowed tw:disabled:opacity-35 tw:data-[tone=primary]:border-signal tw:data-[tone=primary]:bg-signal tw:data-[tone=primary]:text-night tw:data-[tone=primary]:enabled:hover:bg-signal-strong tw:data-[shape=orbit]:rounded-full tw:data-[shape=orbit]:bg-night/45 tw:data-[shape=orbit]:text-[11px] tw:data-[shape=orbit]:backdrop-blur-md tw:data-[shape=icon]:size-11 tw:data-[shape=icon]:rounded-full tw:data-[shape=icon]:bg-night/50 tw:data-[shape=icon]:p-0 tw:motion-reduce:transition-none tw:motion-reduce:enabled:active:translate-y-0">
    {children}
  </button>;
}

export function Arrow({ diagonal = false, className = "tw:size-4" }: { diagonal?: boolean; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={diagonal ? "M5 19 19 5M5 5h14v14" : "M4 12h15M13 5l7 7-7 7"} /></svg>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="tw:flex tw:items-center tw:gap-3 tw:font-mono tw:text-[10px] tw:leading-relaxed tw:tracking-[0.14em] tw:text-signal"><span className="tw:h-px tw:w-7 tw:bg-signal/55" />{children}</p>;
}

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-x-4 tw:gap-y-1 tw:border-b tw:border-hairline tw:py-3 tw:text-[12px]"><dt className="tw:text-cream-muted">{label}</dt><dd className="tw:m-0 tw:font-mono tw:text-cream">{children}</dd></div>;
}
