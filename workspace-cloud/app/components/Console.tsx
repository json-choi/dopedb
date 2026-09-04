import type { ReactNode } from "react";

export function ConsoleNotice({
  tone = "success",
  children,
}: {
  tone?: "danger" | "success";
  children: ReactNode;
}) {
  return (
    <p
      data-tone={tone}
      className="tw:mt-5 tw:mb-0 tw:rounded-surface tw:border tw:border-primary/20 tw:bg-selection tw:px-4 tw:py-3.5 tw:text-xs tw:leading-body tw:text-[var(--ds-text-secondary)] tw:data-[tone=danger]:border-danger/25 tw:data-[tone=danger]:bg-danger/5 tw:data-[tone=danger]:text-danger"
      role={tone === "danger" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
