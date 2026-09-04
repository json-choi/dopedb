import { errDetails } from "../../ipc/types";
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
