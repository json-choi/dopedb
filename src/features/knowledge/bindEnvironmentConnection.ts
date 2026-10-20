// Binding a connection to a Project environment: the revision-conflict retry that refreshes
// the native workspace projection once, and the refusal checked before the request for a
// connection that cannot be bound because it is not a team connection.
import { errDetails } from "../../ipc/types";
import type { I18nKey } from "../../lib/i18n";
import { isDeviceOnlySqlite, type ConnectionProfile } from "../connections/domain";
import { refreshWorkspaceAuthState } from "../workspaces/tauriAdapter";
import type {
  BindEnvironmentConnectionInput,
  EnvironmentConnection,
} from "./domain";
import { bindKnowledgeEnvironmentConnection } from "./tauriAdapter";

export function isKnowledgeEnvironmentRevisionConflict(error: unknown): boolean {
  const details = errDetails(error);
  return details.kind === "network"
    && details.message.includes("409 Conflict")
    && details.message.includes("Environment or connection changed");
}

/**
 * A shared Connection revision may advance between an Explorer read and the
 * user's drop/bind action. Refresh the native workspace projection and retry
 * exactly once only for the server's explicit no-write revision conflict.
 */
export async function bindKnowledgeEnvironmentConnectionWithRefresh(
  input: BindEnvironmentConnectionInput,
): Promise<EnvironmentConnection> {
  try {
    return await bindKnowledgeEnvironmentConnection(input);
  } catch (error) {
    if (!isKnowledgeEnvironmentRevisionConflict(error)) throw error;
    await refreshWorkspaceAuthState();
    return bindKnowledgeEnvironmentConnection(input);
  }
}

/**
 * Why a connection cannot be bound in a team workspace, checked before the request so the
 * person gets actionable text. Native still refuses the same cases as the final guard.
 */
export function bindingRefusal(
  connection: ConnectionProfile | undefined,
  teamWorkspace: boolean,
): I18nKey | null {
  if (!connection || !teamWorkspace) return null;
  if (isDeviceOnlySqlite(connection)) return "knowledge.bindFailure.deviceOnly";
  if (connection.workspaceAccess === "local") return "knowledge.bindFailure.notShared";
  return null;
}
