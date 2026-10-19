// Reuses the exact-connection recovery command in Safety and SQL error surfaces.
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import type { ConnectionProfile } from "./domain";
import RecoveryNotice from "./RecoveryNotice";
import { useManagedConnectionRecovery } from "./useManagedConnectionRecovery";

export default function ManagedConnectionRecoveryNotice({
  connection,
}: {
  connection: ConnectionProfile;
}) {
  const { t } = useI18n();
  const recovery = useManagedConnectionRecovery(connection, useCatalogScope());
  return (
    <RecoveryNotice
      message={t(recovery.canOpenWorkspaceProviders
        ? "connections.managedWorkspace.recoveryRequiredManager"
        : "connections.managedWorkspace.recoveryRequiredMember")}
      action={recovery.canOpenWorkspaceProviders
        ? {
            label: t("connections.managedWorkspace.recover"),
            run: () => recovery.openWorkspaceProviders(),
          }
        : null}
    />
  );
}
