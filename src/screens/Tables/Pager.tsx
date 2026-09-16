// Presents table-page navigation using the caller's loaded-row and total-count state.

import type { ReactNode } from "react";

import { Icon } from "../../components/Icon";
import { WorkbenchButton } from "../../design-system/components/Workbench";
import { useI18n } from "../../lib/i18n";

export default function Pager({
  page,
  pageSize,
  total,
  hasMore,
  rows,
  busy,
  showRefresh = true,
  collapseNavigation = false,
  onPage,
  onRefresh,
  children,
}: {
  page: number;
  pageSize: number;
  total: number | null;
  hasMore?: boolean;
  rows: number;
  busy: boolean;
  showRefresh?: boolean;
  collapseNavigation?: boolean;
  onPage: (page: number) => void;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const lastPage =
    total != null ? Math.max(0, Math.ceil(total / pageSize) - 1) : null;
  const hasPrev = page > 0;
  const hasNext =
    total != null ? page < (lastPage ?? 0) : (hasMore ?? rows === pageSize);

  return (
    <div
      className="ds-control-row tw:flex tw:shrink-0 tw:flex-nowrap tw:items-center tw:gap-1"
      role="group"
      aria-label={t("tables.pagination")}
    >
      <WorkbenchButton
        collapse="narrow"
        iconOnly
        disabled={busy || !hasPrev}
        onClick={() => onPage(0)}
        title={t("common.first")}
        aria-label={t("common.first")}
      >
        <Icon name="chevronsLeft" />
      </WorkbenchButton>
      <WorkbenchButton
        collapse={collapseNavigation ? "narrow" : "never"}
        iconOnly
        disabled={busy || !hasPrev}
        onClick={() => onPage(page - 1)}
        title={t("common.prev")}
        aria-label={t("common.prev")}
      >
        <Icon name="arrowLeft" />
      </WorkbenchButton>
      <span
        data-collapse={collapseNavigation}
        className="tw:min-w-[58px] tw:text-center tw:text-sm tw:text-muted-foreground tw:whitespace-nowrap tw:@max-[760px]:data-[collapse=true]:hidden"
      >
        {t("tables.page", { page: page + 1 })}
        {lastPage != null && ` / ${lastPage + 1}`}
      </span>
      <WorkbenchButton
        collapse={collapseNavigation ? "narrow" : "never"}
        iconOnly
        disabled={busy || !hasNext}
        onClick={() => onPage(page + 1)}
        title={t("common.next")}
        aria-label={t("common.next")}
      >
        <Icon name="arrowRight" />
      </WorkbenchButton>
      <WorkbenchButton
        collapse="narrow"
        iconOnly
        disabled={busy || lastPage == null || !hasNext}
        onClick={() => lastPage != null && onPage(lastPage)}
        title={t("tables.last")}
        aria-label={t("tables.last")}
      >
        <Icon name="chevronsRight" />
      </WorkbenchButton>
      {showRefresh ? (
        <WorkbenchButton
          collapse="compact"
          iconOnly
          disabled={busy}
          aria-label={t("common.refresh")}
          title={t("common.refresh")}
          onClick={onRefresh}
        >
          {busy ? "…" : <Icon name="refresh" />}
        </WorkbenchButton>
      ) : null}
      {children}
    </div>
  );
}
