// Scheduled-deletion state of Backups & deletion, whether scheduled just now or by an
// earlier request. Cancelling is owned by Settings → Account, so this view explains the
// state and links there; its only command resends the same scheduling request when the
// server recorded the deletion but could not yet schedule the final purge.
import { useEffect, useRef } from "react";
import { Button } from "../../../design-system/components/Button";
import { InlineNotice } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import { requestWorkspaceMembershipRefresh } from "../../workspaces/membershipRefreshRequest";
import type { WorkspaceAdminPanelProps } from "../navigationRequest";
import type { LifecycleStatus } from "./domain";
import { FailureNotice, LifecycleFacts, LifecycleSection } from "./LifecycleParts";
import { formatLifecycleTime } from "./messages";
import type { LifecycleController } from "./useLifecycleController";

export default function DeletionScheduledView({
  controller,
  status,
  onNavigate,
}: {
  controller: LifecycleController;
  status: LifecycleStatus;
  onNavigate: WorkspaceAdminPanelProps["onNavigate"];
}) {
  const { lang, t } = useI18n();
  const { busy, deletionNotice, justScheduled } = controller;
  const stateRef = useRef<HTMLDivElement>(null);

  // The form that scheduled the deletion is gone; keep keyboard focus on its outcome.
  useEffect(() => {
    if (justScheduled) stateRef.current?.focus();
  }, [justScheduled]);

  const facts = [
    status.deletionRequestedAt
      ? {
          id: "requested",
          label: t("workspaceLifecycle.requestedAt"),
          value: formatLifecycleTime(status.deletionRequestedAt, lang),
        }
      : null,
    status.purgeAfter
      ? {
          id: "purge",
          label: t("workspaceLifecycle.purgeAt"),
          value: formatLifecycleTime(status.purgeAfter, lang),
        }
      : null,
  ].filter((fact) => fact !== null);

  return (
    <LifecycleSection title={t("workspaceLifecycle.deleteTitle")}>
      <div ref={stateRef} tabIndex={-1} className="tw:min-w-0 tw:outline-none">
        <InlineNotice tone="danger" icon="alert" role={justScheduled ? "alert" : "status"}>
          <strong className="tw:font-semibold">{t("workspaceLifecycle.scheduledTitle")}</strong>{" "}
          {t("workspaceLifecycle.scheduledBody")}
        </InlineNotice>
      </div>
      {facts.length > 0 ? <LifecycleFacts items={facts} /> : null}
      <p className="tw:m-0 tw:max-w-[680px] tw:text-ui tw:leading-body tw:text-muted-foreground">
        {t("workspaceLifecycle.cancelLocation")}
      </p>
      <div className="tw:flex tw:min-w-0">
        <Button
          size="compact"
          onClick={() => {
            onNavigate("account");
            // Leaving the view also moves Desktop off this no longer usable workspace.
            void requestWorkspaceMembershipRefresh().catch(() => undefined);
          }}
        >
          {t("workspaceLifecycle.openAccountToCancel")}
        </Button>
      </div>
      {deletionNotice ? (
        <FailureNotice
          error={deletionNotice.error}
          fallback="workspaceLifecycle.scheduleFailed"
          retry={deletionNotice.retryable ? () => void controller.retryDeletion() : undefined}
          refresh={() => void controller.refresh()}
          disabled={busy !== null}
        />
      ) : null}
    </LifecycleSection>
  );
}
