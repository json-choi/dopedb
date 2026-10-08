// Settings section for shared-database grants, team read access, and edit conflicts.
import type { WorkspaceAdminPanelProps } from "../../../features/workspaceAdmin/navigationRequest";
import ConnectionAccessPanel from "../../../features/workspaceAdmin/access/ConnectionAccessPanel";

export default function WorkspaceAccessSettings(props: WorkspaceAdminPanelProps) {
  return <ConnectionAccessPanel {...props} />;
}
