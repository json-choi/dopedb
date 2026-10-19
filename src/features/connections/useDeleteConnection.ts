// Owns the one delete command for a saved connection: the local-versus-managed
// branch, the manager-only guard for shared templates, the confirm copy and the
// error mapping. The explorer menu and the connection editor both call it and
// only decide what to refresh or close afterward.
import { useToast } from "../../components/Toast";
import { useI18n } from "../../lib/i18n";
import { deleteWorkspaceConnection } from "../workspaces/tauriAdapter";
import { connectionDeleteFailureMessage } from "./connectionTestFailure";
import type { ConnectionProfile } from "./domain";
import { isDemoSqliteConnection } from "./presets";
import { deleteConnection } from "./tauriAdapter";

/** Local connections and shared templates the member manages can be deleted. */
export function canDeleteConnection(connection: ConnectionProfile): boolean {
  return (
    connection.workspaceAccess === "local"
    || connection.workspaceAccess === "manage"
  );
}

export function useDeleteConnection() {
  const { t } = useI18n();
  const toast = useToast();

  function confirmLabel(connection: ConnectionProfile): string {
    return t(
      isDemoSqliteConnection(connection)
        ? "connections.reallyDeleteDemo"
        : "common.reallyDelete",
    );
  }

  /** Resolves to null after a deleted connection, or a stable failure message. */
  async function remove(connection: ConnectionProfile): Promise<string | null> {
    if (!canDeleteConnection(connection)) return null;
    try {
      if (connection.workspaceAccess === "manage") {
        await deleteWorkspaceConnection(connection.id);
      } else {
        await deleteConnection(connection.id);
      }
      toast(t("connections.connectionDeleted"));
      return null;
    } catch (error) {
      return connectionDeleteFailureMessage(t, error);
    }
  }

  return { canDelete: canDeleteConnection, confirmLabel, remove };
}
