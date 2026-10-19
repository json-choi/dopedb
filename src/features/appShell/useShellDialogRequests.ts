// Answers "open Workspace management" and "open Settings → Account" requests raised
// anywhere in the app. The shell owns both routes; this hook only routes the
// request and dismisses the compact-shell explorer overlay that would cover it.
import { useAccountSettingsRequests } from "../settings/accountRequest";
import { useWorkspaceAdminRequests } from "../workspaceAdmin/useWorkspaceAdminRequests";
import type { WorkspaceAdminSection } from "../workspaceAdmin/sections";
import type { SettingsSection } from "../settings/domain";

export function useShellDialogRequests(
  route: {
    openSettings: (section?: SettingsSection) => void;
    openWorkspaceAdmin: (section: WorkspaceAdminSection) => void;
  },
  dismissExplorer: () => void,
) {
  const openWorkspaceAdmin = (section: WorkspaceAdminSection) => {
    route.openWorkspaceAdmin(section);
    dismissExplorer();
  };
  useWorkspaceAdminRequests(openWorkspaceAdmin);
  useAccountSettingsRequests(() => {
    route.openSettings("account");
    dismissExplorer();
  });
  return { openWorkspaceAdmin };
}
