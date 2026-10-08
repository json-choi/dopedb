// Settings section for workspace members and invitations of the active team workspace.
import type { WorkspaceAdminPanelProps } from "../../../features/workspaceAdmin/navigationRequest";
import MembersPanel from "../../../features/workspaceAdmin/members/MembersPanel";

export default function WorkspaceMembersSettings(props: WorkspaceAdminPanelProps) {
  return <MembersPanel {...props} />;
}
