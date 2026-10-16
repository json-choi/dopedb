// Lets the shell, which owns the Workspace management and Settings routes, answer
// administration requests raised by the workspace or account menu, the data source
// catalog, connection recovery, or any other surface.
import { useEffect } from "react";
import { useEventCallback } from "../../lib/useEventCallback";
import { onWorkspaceAdminRequested } from "./navigationRequest";
import type { WorkspaceAdminDestination } from "./sections";

export function useWorkspaceAdminRequests(
  open: (destination: WorkspaceAdminDestination) => void,
) {
  const handleRequest = useEventCallback(open);
  useEffect(() => onWorkspaceAdminRequested(handleRequest), [handleRequest]);
}
