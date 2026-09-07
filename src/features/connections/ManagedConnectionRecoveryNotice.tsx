// Reuses the exact-connection recovery command in Safety and SQL error surfaces.
import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import type { ConnectionProfile } from "./domain";
import { useManagedConnectionRecovery } from "./useManagedConnectionRecovery";

export default function ManagedConnectionRecoveryNotice({
  connection,
}: {
  connection: ConnectionProfile;
}) {
  const { t } = useI18n();
  const recovery = useManagedConnectionRecovery(connection, useCatalogScope());
  return (
    <InlineNotice
      tone="danger"
      icon="alert"
      role="alert"
      action={recovery.canOpenSettings ? (
        <Button
          size="compact"
          disabled={recovery.openingSettings}
          onClick={() => void recovery.openSettings()}
        >
          {t(recovery.openingSettings
            ? "connections.managedWorkspace.opening"
            : "connections.managedWorkspace.recover")}
        </Button>
      ) : undefined}
    >
      {t(recovery.canOpenSettings
        ? "connections.managedWorkspace.recoveryRequiredManager"
        : "connections.managedWorkspace.recoveryRequiredMember")}
    </InlineNotice>
  );
}
