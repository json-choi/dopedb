// Presents the server-owned endpoint boundary and its exact Settings recovery command.
import { Button } from "../../design-system/components/Button";
import { PropertyRow } from "../../design-system/components/FormControls";
import { StatusBadge } from "../../design-system/components/Status";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ManagedWorkspaceConnectionField({
  recovery,
  busy,
  verified,
}: {
  recovery: ConnectionEditorController["commands"]["managedConnection"];
  busy: boolean;
  /** A check passed for the current draft; otherwise the state is unverified. */
  verified: boolean;
}) {
  const { t } = useI18n();
  return (
    <PropertyRow label={t("connections.managedWorkspace.label")}>
      <div className="tw:grid tw:min-h-control-md tw:gap-2">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <StatusBadge tone={verified ? "success" : "neutral"}>
            {verified
              ? t("connections.credentialVerified")
              : t("connections.managedWorkspace.status")}
          </StatusBadge>
          {recovery.canOpenSettings ? (
            <Button
              size="compact"
              disabled={busy}
              onClick={() => recovery.openSettings()}
            >
              {t("connections.managedWorkspace.open")}
            </Button>
          ) : null}
        </div>
        <p className="tw:m-0 tw:max-w-[560px] tw:text-xs tw:leading-body tw:text-muted-foreground">
          {recovery.canOpenSettings
            ? t("connections.managedWorkspace.managerDescription")
            : t("connections.managedWorkspace.memberDescription")}
        </p>
      </div>
    </PropertyRow>
  );
}
