// Team read access row for one managed database. Shows the confirmed server state
// and, for a workspace admin who manages the database, the toggle; turning it off
// revokes access, so it asks for confirmation first. The command owner applies it.
import type { ReactNode } from "react";
import ConfirmButton from "../../../components/ConfirmButton";
import InfoTip from "../../../components/InfoTip";
import { Button } from "../../../design-system/components/Button";
import { SettingsRow } from "../../../design-system/components/SettingsList";
import { LoadingLabel, StatusBadge } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import type { WorkspaceAdminScope } from "../domain";
import type { GrantSnapshot } from "./domain";

export default function TeamReadAccess({
  scope,
  snapshot,
  loadFailed,
  locked,
  saving,
  notice,
  onChange,
}: {
  scope: WorkspaceAdminScope;
  snapshot: GrantSnapshot | undefined;
  loadFailed: boolean;
  locked: boolean;
  saving: boolean;
  notice: string | null;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const actorGrant = snapshot?.grants.find((grant) => grant.memberId === snapshot.actorMemberId);
  // Team read is a workspace-admin policy on a database the admin manages; anyone
  // else sees its state without a control the server would refuse.
  const canChange = scope.canManage
    && actorGrant?.capability === "manage"
    && (actorGrant.role === "admin" || actorGrant.role === "owner");

  const action: ReactNode = !snapshot || !canChange ? undefined : snapshot.teamReadEnabled ? (
    <ConfirmButton
      size="compact"
      label={t("workspaceAccess.teamReadDisableTitle")}
      confirmLabel={t("workspaceAccess.teamReadDisableConfirm")}
      disabled={locked}
      onConfirm={() => onChange(false)}
    >
      {saving ? t("workspaceAccess.saving") : t("workspaceAccess.teamReadDisable")}
    </ConfirmButton>
  ) : (
    <Button size="compact" disabled={locked} onClick={() => onChange(true)}>
      {saving ? t("workspaceAccess.saving") : t("workspaceAccess.teamReadEnable")}
    </Button>
  );

  return (
    <SettingsRow
      identity={<strong className="tw:text-ui tw:font-medium">{t("workspaceAccess.teamRead")}</strong>}
      details={
        snapshot ? (
          <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
            <StatusBadge>
              {t(snapshot.teamReadEnabled ? "workspaceAccess.teamReadOn" : "workspaceAccess.teamReadOff")}
            </StatusBadge>
            <InfoTip label={t("workspaceAccess.teamReadHint")} />
          </span>
        ) : loadFailed ? (
          <span className="tw:text-xs tw:text-muted-foreground">—</span>
        ) : (
          <span className="tw:text-xs">
            <LoadingLabel>{t("workspaceAdmin.loading")}</LoadingLabel>
          </span>
        )
      }
      actions={action}
    >
      {notice ? (
        <p role="alert" className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger">
          {notice}
        </p>
      ) : null}
    </SettingsRow>
  );
}
