// Settings section for provider accounts and managed databases of the active workspace.
import type { WorkspaceAdminPanelProps } from "../../../features/workspaceAdmin/navigationRequest";
import ProvidersPanel from "../../../features/workspaceAdmin/providers/ProvidersPanel";

export default function WorkspaceProvidersSettings(props: WorkspaceAdminPanelProps) {
  return <ProvidersPanel {...props} />;
}
