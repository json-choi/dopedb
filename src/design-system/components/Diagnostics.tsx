// Shared diagnostics presentation for settings and property editors. Domain
// owners supply the issues and navigation; this primitive owns the compact
// problems hierarchy and semantic state treatment.
import type { ReactNode } from "react";

import { Icon } from "../../components/Icon";

export type DiagnosticTone = "warning" | "danger";

export type DiagnosticItem = {
  id: string;
  tone: DiagnosticTone;
  title: ReactNode;
  description?: ReactNode;
};

export function DiagnosticCount({
  count,
  hasErrors,
}: {
  count: number;
  hasErrors: boolean;
}) {
  return (
    <span
      data-errors={hasErrors || undefined}
      className="tw:inline-flex tw:min-w-5 tw:items-center tw:justify-center tw:rounded-xs tw:border tw:border-border-subtle tw:bg-transparent tw:px-1.5 tw:font-mono tw:text-2xs tw:font-medium tw:text-muted-foreground tw:data-[errors]:border-l-2 tw:data-[errors]:border-l-danger tw:data-[errors]:text-danger"
      aria-label={String(count)}
    >
      {count}
    </span>
  );
}

export function DiagnosticSummary({
  title,
  items,
  emptyMessage,
  onSelect,
}: {
  title: ReactNode;
  items: readonly DiagnosticItem[];
  emptyMessage: ReactNode;
  onSelect?: (id: string) => void;
}) {
  return (
    <section
      className="tw:mx-auto tw:grid tw:w-full tw:max-w-[840px] tw:content-start tw:gap-3"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div className="tw:flex tw:items-center tw:gap-2">
        <Icon name="alert" className="tw:text-muted-foreground" />
        <h3>{title}</h3>
        <DiagnosticCount
          count={items.length}
          hasErrors={items.some((item) => item.tone === "danger")}
        />
      </div>
      {items.length === 0 ? (
        <div
          className="tw:flex tw:min-h-28 tw:items-center tw:justify-center tw:gap-2 tw:border-y tw:border-border-subtle tw:text-sm tw:text-muted-foreground"
          role="status"
        >
          <Icon name="check" className="tw:text-success" />
          {emptyMessage}
        </div>
      ) : (
        <div className="tw:grid tw:border-y tw:border-border-subtle">
          {items.map((item) => {
            const content = (
              <>
                <Icon
                  name="alert"
                  data-tone={item.tone}
                  className="tw:mt-0.5 tw:shrink-0 tw:text-warning tw:data-[tone=danger]:text-danger"
                />
                <span className="tw:grid tw:min-w-0 tw:gap-0.5">
                  <strong className="tw:text-sm tw:font-medium tw:text-foreground">
                    {item.title}
                  </strong>
                  {item.description ? (
                    <span className="tw:text-xs tw:leading-body tw:text-muted-foreground tw:[overflow-wrap:anywhere]">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                {onSelect ? (
                  <Icon
                    name="chevronRight"
                    className="tw:mt-0.5 tw:text-muted-foreground"
                  />
                ) : null}
              </>
            );

            return onSelect ? (
              <button
                key={item.id}
                type="button"
                className="tw:grid tw:min-h-14 tw:w-full tw:cursor-pointer tw:grid-cols-[20px_minmax(0,1fr)_16px] tw:gap-2 tw:border-0 tw:border-b tw:border-border-subtle tw:bg-transparent tw:px-2 tw:py-2 tw:font-sans tw:text-left tw:last:border-b-0 tw:hover:bg-muted tw:focus-visible:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring/30"
                onClick={() => onSelect(item.id)}
              >
                {content}
              </button>
            ) : (
              <div
                key={item.id}
                className="tw:grid tw:min-h-14 tw:grid-cols-[20px_minmax(0,1fr)] tw:gap-2 tw:border-b tw:border-border-subtle tw:px-2 tw:py-2 tw:last:border-b-0"
              >
                {content}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
