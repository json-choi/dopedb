// Owner-only Settings section for backups, key rotation, retention, and deletion.
import type { WorkspaceAdminPanelProps } from "../../../features/workspaceAdmin/navigationRequest";
import LifecyclePanel from "../../../features/workspaceAdmin/lifecycle/LifecyclePanel";

export default function WorkspaceLifecycleSettings(props: WorkspaceAdminPanelProps) {
  return <LifecyclePanel {...props} />;
}
