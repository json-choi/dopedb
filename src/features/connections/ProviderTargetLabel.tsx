// Renders the provider branch a connection targets, preferring its name and
// falling back to the id. A pending state outranks the observed one, so the label
// shows where the connection is heading rather than where it last was.
import { Icon } from "../../components/Icon";
import { useI18n } from "../../lib/i18n";
import type { ConnectionProviderTarget } from "./domain";

export function providerTargetDisplayName(target: ConnectionProviderTarget) {
  return target.branchName ?? target.branchId;
}

export function ProviderTargetLabel({
  target,
  showState = false,
}: {
  target: ConnectionProviderTarget;
  showState?: boolean;
}) {
  const { t } = useI18n();
  const name = providerTargetDisplayName(target);
  const state = target.pendingState ?? target.currentState;
  const title = [
    t("connections.neonBranchTarget", { name, id: target.branchId }),
    state ? t("connections.neonBranchState", { state }) : null,
  ].filter(Boolean).join(" · ");

  return (
    <span
      data-state={state ?? "unobserved"}
      className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-xs tw:text-muted-foreground"
      aria-label={title}
      title={title}
    >
      <Icon name="branch" className="tw:size-3 tw:shrink-0" />
      <span className="tw:min-w-0 tw:overflow-hidden tw:font-mono tw:text-ellipsis tw:whitespace-nowrap">
        {name}
      </span>
      {showState && state ? (
        <span className="tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1 tw:text-2xs">
          <span
            className="tw:size-1.5 tw:rounded-full tw:bg-muted-foreground tw:data-[state=ready]:bg-success tw:data-[state=init]:bg-warning tw:data-[state=resetting]:bg-warning tw:data-[state=archived]:bg-danger"
            data-state={state}
            aria-hidden="true"
          />
          {state}
        </span>
      ) : null}
    </span>
  );
}
