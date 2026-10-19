// Shows the loading, empty, or failed-with-refresh state of a provider resource
// list (accounts, projects, datasets) beside the field that selects from it.
import { Button } from "../../design-system/components/Button";

export function ResourceStatus({
  pending,
  empty,
  error,
  loadingLabel,
  emptyLabel,
  refreshLabel,
  refreshAriaLabel,
  onRefresh,
}: {
  pending: boolean;
  empty: boolean;
  error: string | null;
  loadingLabel: string;
  emptyLabel: string;
  refreshLabel: string;
  refreshAriaLabel?: string;
  onRefresh: () => void;
}) {
  if (pending) {
    return (
      <span className="tw:text-xs tw:text-muted-foreground" role="status">
        {loadingLabel}
      </span>
    );
  }
  if (error) {
    return (
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <span className="tw:text-xs tw:text-danger" role="alert">{error}</span>
        <Button size="xs" aria-label={refreshAriaLabel} onClick={onRefresh}>
          {refreshLabel}
        </Button>
      </div>
    );
  }
  return empty ? (
    <span className="tw:text-xs tw:text-muted-foreground" role="status">
      {emptyLabel}
    </span>
  ) : null;
}
