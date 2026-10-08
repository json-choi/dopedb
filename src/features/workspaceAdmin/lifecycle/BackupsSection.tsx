// Backups block of Backups & deletion: create a backup, list backups newest first, and
// restore or delete one. The lifecycle controller owns every command and its result;
// this block renders them beside the list's own loading, empty and failure states.
import ConfirmButton from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import Skeleton from "../../../components/Skeleton";
import { Button } from "../../../design-system/components/Button";
import { SettingsList, SettingsRow } from "../../../design-system/components/SettingsList";
import { InlineNotice, LoadingLabel } from "../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import type { WorkspaceAdminPanelProps } from "../navigationRequest";
import type { LifecycleStatus } from "./domain";
import { FailureNotice, LifecycleSection } from "./LifecycleParts";
import { formatLifecycleTime } from "./messages";
import type { BackupsNotice, LifecycleController } from "./useLifecycleController";

const FAILURE_FALLBACK: Record<"create" | "restore" | "delete", I18nKey> = {
  create: "workspaceLifecycle.createFailed",
  restore: "workspaceLifecycle.restoreFailed",
  delete: "workspaceLifecycle.deleteFailed",
};

export default function BackupsSection({
  controller,
  status,
  onNavigate,
}: {
  controller: LifecycleController;
  status: LifecycleStatus;
  onNavigate: WorkspaceAdminPanelProps["onNavigate"];
}) {
  const { lang, t } = useI18n();
  const { backups, busy, backupsNotice } = controller;
  const creating = busy?.command === "create";

  return (
    <LifecycleSection
      title={t("workspaceLifecycle.backupsTitle")}
      description={t("workspaceLifecycle.backupsDescription")}
      trailing={
        <Button
          size="compact"
          variant="primary"
          disabled={busy !== null}
          disabledBehavior="focusable"
          aria-busy={creating || undefined}
          onClick={() => void controller.createBackup()}
        >
          {creating ? t("workspaceLifecycle.creatingBackup") : t("workspaceLifecycle.createBackup")}
        </Button>
      }
    >
      {backupsNotice ? (
        <BackupsResult
          notice={backupsNotice}
          controller={controller}
          retentionDays={status.backupRetentionDays}
          onNavigate={onNavigate}
        />
      ) : null}
      {backups.isPending ? <Skeleton lines={2} /> : null}
      {backups.isError ? (
        <FailureNotice
          error={backups.error}
          fallback="workspaceLifecycle.backupsLoadFailed"
          tone={backups.data ? "warning" : "danger"}
          retry={() => void backups.refetch()}
          disabled={backups.isFetching}
        />
      ) : null}
      {backups.data?.length === 0 ? (
        <p className="tw:m-0 tw:py-2 tw:text-ui tw:text-muted-foreground">
          {t("workspaceLifecycle.noBackups")}
        </p>
      ) : null}
      {backups.data && backups.data.length > 0 ? (
        <SettingsList>
          {backups.data.map((backup) => {
            const createdAt = formatLifecycleTime(backup.createdAt, lang);
            const rowCommand = busy?.backupId === backup.id ? busy.command : null;
            return (
              <SettingsRow
                key={backup.id}
                identity={
                  <span className="tw:block tw:truncate tw:text-ui tw:font-medium tw:text-foreground">
                    {createdAt}
                  </span>
                }
                details={
                  <span className="tw:text-ui tw:text-muted-foreground">
                    {t("workspaceLifecycle.backupDetails", {
                      revision: backup.sourceRevision,
                      keyVersion: backup.keyVersion,
                    })}
                  </span>
                }
                actions={
                  <>
                    <ConfirmButton
                      iconOnly
                      label={t("workspaceLifecycle.restoreBackup", { date: createdAt })}
                      size="compact"
                      variant="ghost"
                      disabled={busy !== null}
                      confirmLabel={t("workspaceLifecycle.restoreConfirm")}
                      onConfirm={() => void controller.restoreBackup(backup.id)}
                    >
                      <Icon name="history" />
                    </ConfirmButton>
                    <ConfirmButton
                      iconOnly
                      label={t("workspaceLifecycle.deleteBackup", { date: createdAt })}
                      size="compact"
                      variant="ghost"
                      tone="danger"
                      disabled={busy !== null}
                      confirmLabel={t("workspaceLifecycle.deleteBackupConfirm", {
                        days: status.backupRetentionDays,
                      })}
                      onConfirm={() => void controller.deleteBackup(backup.id)}
                    >
                      <Icon name="trash" />
                    </ConfirmButton>
                  </>
                }
              >
                {rowCommand === "restore" || rowCommand === "delete" ? (
                  <span className="tw:text-xs">
                    <LoadingLabel>
                      {rowCommand === "restore"
                        ? t("workspaceLifecycle.restoring")
                        : t("workspaceLifecycle.deletingBackup")}
                    </LoadingLabel>
                  </span>
                ) : null}
              </SettingsRow>
            );
          })}
        </SettingsList>
      ) : null}
    </LifecycleSection>
  );
}

function BackupsResult({
  notice,
  controller,
  retentionDays,
  onNavigate,
}: {
  notice: BackupsNotice;
  controller: LifecycleController;
  retentionDays: number;
  onNavigate: WorkspaceAdminPanelProps["onNavigate"];
}) {
  const { t } = useI18n();
  if (notice.kind === "failed") {
    const retryBackupId = notice.retryBackupId;
    return (
      <FailureNotice
        error={notice.error}
        fallback={FAILURE_FALLBACK[notice.command]}
        retry={retryBackupId ? () => void controller.deleteBackup(retryBackupId) : undefined}
        refresh={() => void controller.refresh()}
        disabled={controller.busy !== null}
      />
    );
  }
  if (notice.kind === "created") {
    return <ResultLine>{t("workspaceLifecycle.backupCreated")}</ResultLine>;
  }
  if (notice.kind === "deleted") {
    return (
      <ResultLine>{t("workspaceLifecycle.backupDeleted", { days: retentionDays })}</ResultLine>
    );
  }
  const restored = t("workspaceLifecycle.restoreDone", { count: notice.restored });
  if (notice.conflicts === 0) {
    return <ResultLine>{restored}</ResultLine>;
  }
  return (
    <InlineNotice
      tone="warning"
      icon="alert"
      role="status"
      action={
        <Button size="compact" onClick={() => onNavigate("workspace-access")}>
          {t("workspaceLifecycle.reviewConflicts")}
        </Button>
      }
    >
      {restored} {t("workspaceLifecycle.restoreConflicts", { count: notice.conflicts })}
    </InlineNotice>
  );
}

function ResultLine({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="tw:m-0 tw:flex tw:items-center tw:gap-1.5 tw:text-ui tw:text-muted-foreground"
    >
      <Icon name="check" className="tw:shrink-0 tw:text-success" />
      {children}
    </p>
  );
}
