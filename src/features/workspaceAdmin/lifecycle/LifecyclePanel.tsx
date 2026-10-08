// Settings → Workspace → Backups & deletion, shown to the owner only. Composes the
// backups, encryption key, retention and deletion blocks for an active workspace, or the
// scheduled-deletion state once deletion is pending. useLifecycleController owns every
// read and command; this root only chooses what the current status allows. Once a
// deletion is scheduled the workspace is no longer usable, so this root announces it,
// opens Account, where it can still be cancelled, and asks for a membership refresh.
import { useToast } from "../../../components/Toast";
import { LoadingLabel } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import { requestWorkspaceMembershipRefresh } from "../../workspaces/membershipRefreshRequest";
import type { WorkspaceAdminPanelProps } from "../navigationRequest";
import BackupsSection from "./BackupsSection";
import DeletionScheduledView from "./DeletionScheduledView";
import type { LifecycleStatus } from "./domain";
import EncryptionKeySection from "./EncryptionKeySection";
import { FailureNotice, LifecycleFacts, LifecycleSection } from "./LifecycleParts";
import { useLifecycleController } from "./useLifecycleController";
import WorkspaceDeletionSection from "./WorkspaceDeletionSection";

export default function LifecyclePanel({ scope, onNavigate }: WorkspaceAdminPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const controller = useLifecycleController(scope, {
    onDeletionScheduled: (scheduled) => {
      toast(t("workspaceLifecycle.scheduledToast", { name: scheduled.workspaceName }));
      onNavigate("account");
      // The account lifecycle retries on its own if this refresh fails.
      void requestWorkspaceMembershipRefresh().catch(() => undefined);
    },
  });
  const { status } = controller;
  const lifecycle = status.data;

  return (
    <div
      data-primary-flow
      className="tw:grid tw:w-full tw:max-w-[800px] tw:min-w-0 tw:content-start tw:gap-4 tw:p-4 tw:@max-[700px]:p-0"
    >
      {!lifecycle ? (
        status.isError ? (
          <FailureNotice
            error={status.error}
            fallback="workspaceLifecycle.loadFailed"
            retry={() => void status.refetch()}
            disabled={status.isFetching}
          />
        ) : (
          <p className="tw:m-0 tw:text-ui">
            <LoadingLabel>{t("workspaceLifecycle.loading")}</LoadingLabel>
          </p>
        )
      ) : (
        <>
          {status.isError ? (
            <FailureNotice
              error={status.error}
              fallback="workspaceLifecycle.refreshFailed"
              tone="warning"
              retry={() => void controller.refresh()}
              disabled={controller.busy !== null}
            />
          ) : null}
          {lifecycle.lifecycleState === "deletion_pending" ? (
            <DeletionScheduledView
              controller={controller}
              status={lifecycle}
              onNavigate={onNavigate}
            />
          ) : (
            <>
              <BackupsSection controller={controller} status={lifecycle} onNavigate={onNavigate} />
              <EncryptionKeySection controller={controller} />
              <RetentionSection status={lifecycle} />
              <WorkspaceDeletionSection
                controller={controller}
                status={lifecycle}
                onNavigate={onNavigate}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function RetentionSection({ status }: { status: LifecycleStatus }) {
  const { t } = useI18n();
  return (
    <LifecycleSection
      title={t("workspaceLifecycle.retentionTitle")}
      description={t("workspaceLifecycle.retentionDescription")}
    >
      <LifecycleFacts
        items={[
          {
            id: "active",
            label: t("workspaceLifecycle.activeBackups"),
            value: status.backupCount,
          },
          {
            id: "purge",
            label: t("workspaceLifecycle.pendingPurge"),
            value: status.tombstonedBackupCount,
          },
          {
            id: "window",
            label: t("workspaceLifecycle.retentionWindow"),
            value: t("workspaceLifecycle.days", { count: status.backupRetentionDays }),
          },
        ]}
      />
    </LifecycleSection>
  );
}
