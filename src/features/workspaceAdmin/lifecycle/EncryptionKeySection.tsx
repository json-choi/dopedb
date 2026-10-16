// Encryption key block of Backups & deletion: the active data-key version, the rotate
// or continue command, and rotation progress. The lifecycle controller owns the run
// (batches, busy claims, its request id); this block renders the status it reports.
import Skeleton from "../../../components/Skeleton";
import { Button } from "../../../design-system/components/Button";
import { ProgressBar } from "../../../design-system/components/Progress";
import { InlineNotice } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import { keyVersionLabel } from "./domain";
import { FailureNotice, LifecycleFacts, LifecycleSection } from "./LifecycleParts";
import { formatLifecycleTime } from "./messages";
import type { LifecycleController } from "./useLifecycleController";

export default function EncryptionKeySection({ controller }: { controller: LifecycleController }) {
  const { lang, t } = useI18n();
  const { keyRotation, busy, keyNotice } = controller;
  const data = keyRotation.data;
  const run = data?.rotation ?? null;
  const rotating = busy?.command === "rotate";
  // Progress belongs to the current run only once the server reports it running.
  const live = rotating && run?.status === "running" ? run : null;

  return (
    <LifecycleSection
      title={t("workspaceLifecycle.keyTitle")}
      description={t("workspaceLifecycle.keyDescription")}
      trailing={
        data && data.activeVersion !== null ? (
          <Button
            size="compact"
            disabled={busy !== null}
            disabledBehavior="focusable"
            aria-busy={rotating || undefined}
            onClick={() => void controller.rotateKey()}
          >
            {rotating
              ? t("workspaceLifecycle.rotating")
              : run?.status === "running"
                ? t("workspaceLifecycle.continueRotation")
                : t("workspaceLifecycle.rotateKey")}
          </Button>
        ) : undefined
      }
    >
      {keyRotation.isPending ? <Skeleton lines={1} /> : null}
      {keyRotation.isError ? (
        <FailureNotice
          error={keyRotation.error}
          fallback="workspaceLifecycle.keyLoadFailed"
          tone={data ? "warning" : "danger"}
          retry={() => void keyRotation.refetch()}
          disabled={keyRotation.isFetching}
        />
      ) : null}
      {data ? (
        <div className="tw:grid tw:min-w-0 tw:gap-1.5">
          {data.activeVersion === null ? (
            <p className="tw:m-0 tw:text-ui tw:text-muted-foreground">
              {t("workspaceLifecycle.keyNotInitialized")}
            </p>
          ) : (
            <LifecycleFacts
              items={[
                {
                  id: "active",
                  label: t("workspaceLifecycle.activeKey"),
                  value: <code className="tw:font-mono">{keyVersionLabel(data.activeVersion)}</code>,
                },
              ]}
            />
          )}
          <div aria-live="polite" className="tw:grid tw:min-w-0 tw:gap-1.5">
            {rotating ? (
              <>
                <ProgressBar
                  value={live ? live.processedBackups : null}
                  max={live ? live.processedBackups + live.remainingBackups : undefined}
                  label={t("workspaceLifecycle.rotationProgressLabel")}
                />
                <span className="tw:text-xs tw:text-muted-foreground">
                  {live
                    ? t("workspaceLifecycle.rotationProgress", {
                        processed: live.processedBackups,
                        remaining: live.remainingBackups,
                      })
                    : t("workspaceLifecycle.rotationStarting")}
                </span>
              </>
            ) : run?.status === "running" ? (
              <InlineNotice tone="warning" icon="refresh">
                {t("workspaceLifecycle.rotationRunning", { remaining: run.remainingBackups })}
              </InlineNotice>
            ) : run?.status === "completed" ? (
              <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
                {run.completedAt
                  ? t("workspaceLifecycle.rotationCompletedAt", {
                      date: formatLifecycleTime(run.completedAt, lang),
                      count: run.processedBackups,
                    })
                  : t("workspaceLifecycle.rotationCompleted", { count: run.processedBackups })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {keyNotice?.kind === "busy" ? (
        <InlineNotice
          tone="warning"
          icon="alert"
          role="status"
          action={
            <Button size="compact" disabled={busy !== null} onClick={() => void controller.refresh()}>
              {t("common.refresh")}
            </Button>
          }
        >
          {t("workspaceLifecycle.rotationBusy")}
        </InlineNotice>
      ) : keyNotice?.kind === "failed" ? (
        <FailureNotice
          error={keyNotice.error}
          fallback="workspaceLifecycle.rotateFailed"
          refresh={() => void controller.refresh()}
          disabled={busy !== null}
        />
      ) : null}
    </LifecycleSection>
  );
}
