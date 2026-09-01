// Builds narrow Workspace Web destinations from the trusted console origin
// returned by the native control-plane adapter.
import type { ConnectionId } from "../connections/domain";

export function workspaceManagedConnectionSettingsUrl(
  consoleUrl: string,
  connectionId: ConnectionId,
): string {
  const target = new URL(consoleUrl);
  target.searchParams.set("section", "databases");
  target.searchParams.set("connection", connectionId);
  target.hash = `database-${connectionId}`;
  return target.toString();
}
