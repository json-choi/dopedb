// Collapsed "Delete workspace" disclosure of Backups & deletion. Unmet prerequisites are
// listed with the section that resolves each one instead of a disabled form; once none
// remain, typing the exact workspace name enables the single destructive command with
// no second confirmation. The confirmation text is local input state only.
import { useState } from "react";
import { Icon } from "../../../components/Icon";
import { Button } from "../../../design-system/components/Button";
import { Field, TextInput } from "../../../design-system/components/FormControls";
import { InlineNotice } from "../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import type { WorkspaceAdminPanelProps } from "../navigationRequest";
import {
  BLOCKER_RESOLUTION,
  outstandingBlockers,
  type BlockerDestination,
  type LifecycleStatus,
} from "./domain";
import { FailureNotice } from "./LifecycleParts";
import { BLOCKER_LABELS } from "./messages";
import type { LifecycleController } from "./useLifecycleController";

type Navigate = WorkspaceAdminPanelProps["onNavigate"];

const DESTINATION_LABELS: Record<BlockerDestination, I18nKey> = {
  "workspace-providers": "workspaceAdmin.providers",
  "workspace-members": "workspaceAdmin.members",
};

export default function WorkspaceDeletionSection({
  controller,
  status,
  onNavigate,
}: {
  controller: LifecycleController;
  status: LifecycleStatus;
  onNavigate: Navigate;
}) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState("");
  const { busy, deletionNotice } = controller;
  const blockers = outstandingBlockers(status.blockers);
  const scheduling = busy?.command === "schedule";
  // Exact comparison: case and whitespace both count, as on the server.
  const canSubmit =
    busy === null && status.canScheduleDeletion && confirmation === status.workspaceName;

  return (
    <details className="tw:group tw:min-w-0 tw:border-t tw:border-border-subtle tw:pt-2">
      <summary className="tw:flex tw:min-h-control-xl tw:cursor-pointer tw:list-none tw:items-center tw:gap-2 tw:rounded-sm tw:[&::-webkit-details-marker]:hidden">
        <Icon
          name="chevronRight"
          className="tw:shrink-0 tw:text-muted-foreground tw:transition-transform tw:group-open:rotate-90 tw:motion-reduce:transition-none"
        />
        <span className="tw:grid tw:min-w-0 tw:gap-0.5">
          <span className="tw:text-ui tw:font-semibold tw:text-danger">
            {t("workspaceLifecycle.deleteTitle")}
          </span>
          <span className="tw:text-xs tw:text-muted-foreground">
            {t("workspaceLifecycle.deleteSummary")}
          </span>
        </span>
      </summary>
      <div className="tw:grid tw:min-w-0 tw:gap-3 tw:pt-2 tw:pb-1 tw:pl-6 tw:@max-[640px]:pl-0">
        {deletionNotice ? (
          <FailureNotice
            error={deletionNotice.error}
            fallback="workspaceLifecycle.scheduleFailed"
            retry={deletionNotice.retryable ? () => void controller.retryDeletion() : undefined}
            refresh={() => void controller.refresh()}
            disabled={busy !== null}
          />
        ) : null}
        {blockers.length > 0 ? (
          <div className="tw:grid tw:min-w-0 tw:gap-2">
            <p className="tw:m-0 tw:text-ui tw:text-foreground">
              {t("workspaceLifecycle.blockersIntro")}
            </p>
            <ul className="tw:m-0 tw:grid tw:list-none tw:divide-y tw:divide-border-subtle tw:overflow-hidden tw:rounded-sm tw:border tw:border-border-subtle tw:p-0">
              {blockers.map(({ kind, count }) => {
                const destination = BLOCKER_RESOLUTION[kind];
                return (
                  <li
                    key={kind}
                    className="tw:grid tw:min-h-[48px] tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-x-3 tw:gap-y-1.5 tw:px-3 tw:py-2 tw:@max-[480px]:grid-cols-1"
                  >
                    <span className="tw:min-w-0 tw:text-ui tw:text-foreground">
                      <span className="tw:font-mono tw:tabular-nums">{count}</span>
                      {" · "}
                      {t(BLOCKER_LABELS[kind])}
                      {destination ? null : (
                        <span className="tw:block tw:text-xs tw:text-muted-foreground">
                          {t("workspaceLifecycle.blockerKeyRotationHint")}
                        </span>
                      )}
                    </span>
                    {destination ? (
                      <Button size="compact" onClick={() => onNavigate(destination)}>
                        {t("workspaceLifecycle.openSection", {
                          section: t(DESTINATION_LABELS[destination]),
                        })}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : !status.canScheduleDeletion ? (
          <InlineNotice
            tone="warning"
            icon="alert"
            role="status"
            action={
              <Button
                size="compact"
                disabled={busy !== null}
                onClick={() => void controller.refresh()}
              >
                {t("common.refresh")}
              </Button>
            }
          >
            {t("workspaceLifecycle.deletionUnavailable")}
          </InlineNotice>
        ) : (
          <form
            className="tw:grid tw:min-w-0 tw:max-w-[560px] tw:gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void controller.scheduleDeletion(confirmation);
            }}
          >
            <p className="tw:m-0 tw:text-ui tw:leading-body tw:text-foreground">
              {t("workspaceLifecycle.deleteExplain", { days: status.retentionDays })}
            </p>
            <Field
              label={
                <>
                  {t("workspaceLifecycle.confirmNameLabel")}{" "}
                  <code className="tw:rounded-xs tw:bg-muted tw:px-1 tw:font-mono tw:whitespace-pre-wrap tw:text-foreground tw:[overflow-wrap:anywhere]">
                    {status.workspaceName}
                  </code>
                </>
              }
            >
              {(binding) => (
                <TextInput
                  {...binding.controlProps()}
                  density="compact"
                  value={confirmation}
                  readOnly={busy !== null}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              )}
            </Field>
            <div className="tw:flex tw:min-w-0">
              <Button
                type="submit"
                size="compact"
                variant="danger"
                disabled={!canSubmit}
                disabledBehavior="focusable"
                aria-busy={scheduling || undefined}
              >
                {scheduling
                  ? t("workspaceLifecycle.schedulingDeletion")
                  : t("workspaceLifecycle.scheduleDeletion")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
