// One shared database of the workspace inventory: identity, credential mode and the
// pinned provider target, plus the repair and removal commands the member may run.
// A focused row (from a managed-connection recovery request) is shown selected and
// leads with its repair command; a newly added row is only shown selected.
import ConfirmButton from "../../../../components/ConfirmButton";
import { Icon } from "../../../../components/Icon";
import { Button } from "../../../../design-system/components/Button";
import { SettingsRow } from "../../../../design-system/components/SettingsList";
import { StatusBadge } from "../../../../design-system/components/Status";
import { Tooltip } from "../../../../design-system/components/Tooltip";
import { useI18n } from "../../../../lib/i18n";
import type { ManagedConnection, Provider, SharedConnection } from "../domain";
import {
  canRemoveSharedConnection,
  canRepairManagedAccess,
  managedTargetPath,
} from "./model";

export default function SharedDatabaseRow({
  connection,
  managed,
  provider,
  focused,
  revealed,
  emphasizeRepair,
  locked,
  removing,
  repairing,
  anchorRef,
  onRepair,
  onRemove,
  onOpenAccounts,
}: {
  connection: SharedConnection;
  managed: ManagedConnection | null;
  provider: Provider | null;
  /** Requested by a recovery flow: selected, with its repair guidance expanded. */
  focused: boolean;
  /** Just added by this view: selected only. */
  revealed: boolean;
  /** The repair command is this view's single primary action. */
  emphasizeRepair: boolean;
  /** Another administration command is running. */
  locked: boolean;
  removing: boolean;
  repairing: boolean;
  anchorRef: (node: HTMLDivElement | null) => void;
  onRepair: (managed: ManagedConnection) => void;
  onRemove: (connection: SharedConnection) => void;
  onOpenAccounts: () => void;
}) {
  const { t } = useI18n();
  const managedAccess = connection.credentialMode === "managed";
  const repairable = canRepairManagedAccess(connection, managed);
  const removable = canRemoveSharedConnection(connection);
  const path = managed ? managedTargetPath(managed, provider) : "";
  const target = provider && path
    ? t("workspaceProviderDatabases.target", { provider: provider.name, path })
    : "";
  const repairLabel = t(repairing
    ? "workspaceProviderDatabases.repairing"
    : "workspaceProviderDatabases.repair");
  const rowRepair = repairable && !focused;

  function repair() {
    if (managed) onRepair(managed);
  }

  return (
    <div
      ref={anchorRef}
      role="listitem"
      tabIndex={-1}
      data-focused={focused || revealed}
      aria-current={focused ? "true" : undefined}
      className="tw:min-w-0 tw:scroll-my-6 tw:outline-none tw:data-[focused=true]:bg-selection tw:data-[focused=true]:text-selection-foreground tw:focus-visible:ring-2 tw:focus-visible:ring-inset tw:focus-visible:ring-ring"
    >
      <SettingsRow
        identity={
          <span className="tw:grid tw:min-w-0 tw:gap-0.5">
            <strong className="tw:truncate tw:text-ui tw:font-medium" title={connection.name}>
              {connection.name}
            </strong>
            <span className="tw:truncate tw:font-mono tw:text-2xs tw:uppercase tw:tracking-[0.05em] tw:text-muted-foreground">
              {connection.engine}
            </span>
          </span>
        }
        details={
          <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
            <StatusBadge
              density="compact"
              title={t(managedAccess
                ? "workspaceProviderDatabases.managedModeHint"
                : "workspaceProviderDatabases.localModeHint")}
            >
              {t(managedAccess
                ? "workspaceProviderDatabases.managedMode"
                : "workspaceProviderDatabases.localMode")}
            </StatusBadge>
            {target ? (
              <Tooltip label={target}>
                <span
                  tabIndex={0}
                  className="tw:min-w-0 tw:truncate tw:rounded-xs tw:font-mono tw:text-xs tw:text-muted-foreground tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                >
                  {target}
                </span>
              </Tooltip>
            ) : managedAccess ? null : (
              <span className="tw:min-w-0 tw:truncate tw:text-xs tw:text-muted-foreground">
                {t("workspaceProviderDatabases.localModeHint")}
              </span>
            )}
          </span>
        }
        actions={rowRepair || removable ? (
          <>
            {rowRepair ? (
              <Button
                size="compact"
                variant="ghost"
                iconOnly
                title={repairLabel}
                disabled={locked}
                onClick={repair}
              >
                {repairing ? (
                  <Icon name="refresh" className="tw:animate-spin tw:motion-reduce:animate-none" />
                ) : (
                  <Icon name="shield" />
                )}
              </Button>
            ) : null}
            {removable ? (
              <ConfirmButton
                iconOnly
                label={t(removing
                  ? "workspaceProviderDatabases.removing"
                  : "workspaceProviderDatabases.remove")}
                size="compact"
                variant="ghost"
                tone="danger"
                disabled={locked}
                confirmLabel={t("workspaceProviderDatabases.removeConfirm", { name: connection.name })}
                onConfirm={() => onRemove(connection)}
              >
                {removing ? (
                  <Icon name="refresh" className="tw:animate-spin tw:motion-reduce:animate-none" />
                ) : (
                  <Icon name="trash" />
                )}
              </ConfirmButton>
            ) : null}
          </>
        ) : undefined}
      >
        {focused && managed ? (
          <div className="tw:grid tw:min-w-0 tw:justify-items-start tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-2">
            <p role="status" className="tw:m-0 tw:text-sm tw:leading-body tw:text-foreground">
              {t(repairable
                ? "workspaceProviderDatabases.focusRepair"
                : "workspaceProviderDatabases.focusManaged")}
            </p>
            {repairable ? (
              <>
                <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
                  {t(managed.provider === "gcpCloudSql"
                    ? "workspaceProviderDatabases.repairDescription"
                    : "workspaceProviderDatabases.repairAccountDescription")}
                </p>
                <Button
                  size="compact"
                  variant={emphasizeRepair ? "primary" : "default"}
                  disabled={locked}
                  onClick={repair}
                >
                  {repairing ? (
                    <Icon name="refresh" className="tw:animate-spin tw:motion-reduce:animate-none" />
                  ) : (
                    <Icon name="shield" />
                  )}
                  {repairLabel}
                </Button>
              </>
            ) : (
              <Button size="compact" disabled={locked} onClick={onOpenAccounts}>
                {t("workspaceProviderDatabases.openAccounts")}
              </Button>
            )}
          </div>
        ) : null}
      </SettingsRow>
    </div>
  );
}
