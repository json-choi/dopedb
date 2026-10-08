// Lets the shell, which owns the Settings route, answer administration requests
// raised by the workspace menu, connection recovery, or any other surface.
import { useEffect } from "react";
import { useEventCallback } from "../../lib/useEventCallback";
import {
  onWorkspaceAdminRequested,
  type WorkspaceAdminSettingsSection,
} from "./navigationRequest";

export function useWorkspaceAdminRequests(
  open: (section: WorkspaceAdminSettingsSection) => void,
) {
  const handleRequest = useEventCallback(open);
  useEffect(() => onWorkspaceAdminRequested(handleRequest), [handleRequest]);
}
