// Coordinates the workspace write ceiling and the narrower device Safety gate.
// The ordering is fail-closed and all concrete IPC remains supplied by the screen.
import type { ConnectionProfile } from "../connections/domain";
import type { SafetySettings } from "../../ipc/types";

import { canManageWorkspaceWritePolicy } from "./policy";

export type SafetyPersistenceCommands = {
  setDeviceSafety: (
    connectionId: string,
    settings: SafetySettings,
  ) => Promise<void>;
  setWorkspaceWritePolicy: (
    connectionId: ConnectionProfile["id"],
    allowWrites: boolean,
  ) => Promise<ConnectionProfile>;
};

export class WorkspaceWritePolicyRollbackError extends Error {
  readonly connection: ConnectionProfile;
  readonly originalError: unknown;
  readonly rollbackError: unknown;

  constructor(
    connection: ConnectionProfile,
    originalError: unknown,
    rollbackError: unknown,
  ) {
    super("workspace write policy rollback failed");
    this.name = "WorkspaceWritePolicyRollbackError";
    this.connection = connection;
    this.originalError = originalError;
    this.rollbackError = rollbackError;
  }
}

/**
 * Persist one Safety edit. `writesChanged` says whether the user toggled the
 * Data changes checkbox in this edit: the editor shows the narrower device gate,
 * so a manager who only changed a limit must never rewrite the team's write
 * ceiling from that device value. The Settings screen always passes it; the
 * default keeps direct callers on the explicit-toggle contract.
 */
export async function persistConnectionSafety(
  connection: ConnectionProfile,
  settings: SafetySettings,
  commands: SafetyPersistenceCommands,
  { writesChanged }: { writesChanged: boolean } = { writesChanged: true },
): Promise<ConnectionProfile> {
  const workspacePolicyChange =
    writesChanged &&
    canManageWorkspaceWritePolicy(connection) &&
    connection.allowWrites !== settings.allowWrites;

  if (workspacePolicyChange && settings.allowWrites) {
    const widened = await commands.setWorkspaceWritePolicy(connection.id, true);
    try {
      await commands.setDeviceSafety(connection.id, settings);
      return widened;
    } catch (error) {
      try {
        await commands.setWorkspaceWritePolicy(connection.id, false);
      } catch (rollbackError) {
        throw new WorkspaceWritePolicyRollbackError(
          widened,
          error,
          rollbackError,
        );
      }
      throw error;
    }
  }

  // Narrow the device first. If the hosted mutation fails, this machine stays
  // read-only while the user retries the workspace-wide policy change.
  await commands.setDeviceSafety(connection.id, settings);
  if (workspacePolicyChange) {
    return commands.setWorkspaceWritePolicy(connection.id, false);
  }
  return connection;
}
