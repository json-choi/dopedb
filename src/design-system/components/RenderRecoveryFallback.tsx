// The one fallback shown by RenderRecoveryBoundary when an optional surface
// fails to render: a short explanation and a single retry command.
import { Icon } from "../../components/Icon";
import { Button } from "./Button";

export default function RenderRecoveryFallback({
  title,
  body,
  retryLabel,
  onRetry,
  focusTarget,
}: {
  title: string;
  body: string;
  retryLabel: string;
  onRetry: () => void;
  /** Marks the retry button for a host that restores focus by data attribute. */
  focusTarget?: string;
}) {
  return (
    <div
      className="tw:flex tw:h-full tw:min-h-[240px] tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:p-[var(--ds-pane-pad)] tw:text-center tw:text-sm tw:text-muted-foreground"
      role="alert"
    >
      <Icon className="tw:size-7 tw:text-warning" name="alert" />
      <strong className="tw:text-title tw:text-foreground">{title}</strong>
      <p className="tw:m-0 tw:max-w-[420px] tw:leading-body">{body}</p>
      <Button
        data-agent-focus-target={focusTarget}
        data-modal-initial-focus
        onClick={onRetry}
        size="compact"
        variant="primary"
      >
        <Icon name="refresh" />
        {retryLabel}
      </Button>
    </div>
  );
}
