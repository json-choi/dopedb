// Root settings navigation owns the active workspace concern. This component
// renders only that concern's command surface and never creates nested settings.
import { ConnectionAccessPanel } from "./ConnectionAccessPanel";
import { CloudAccountPanel } from "./CloudAccountPanel";
import { SharedDatabasePanel } from "./SharedDatabasePanel";
import { WorkspaceAccessPanel } from "./WorkspaceAccessPanel";
import { WorkspaceLifecyclePanel } from "./WorkspaceLifecyclePanel";
import type { WorkspaceLocale } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";

export type WorkspaceManagementArea =
  | "access"
  | "providers"
  | "workspace-settings";

export function localizedWorkspaceManagementAreas(locale: WorkspaceLocale): Array<{
  id: WorkspaceManagementArea;
  label: string;
  description: string;
}> {
  const areas = workspaceMessages[locale].settings.areas;
  return [
    { id: "access", ...areas.access },
    { id: "providers", ...areas.providers },
    { id: "workspace-settings", ...areas.workspaceSettings },
  ];
}

export function WorkspaceManagementPanel({
  workspaceId,
  gcpSetupId,
  initialIntegrationId,
  initialConnectionId,
  area,
}: {
  workspaceId: string;
  gcpSetupId: string | null;
  initialIntegrationId: string | null;
  initialConnectionId: string | null;
  area: WorkspaceManagementArea;
}) {
  if (area === "workspace-settings") {
    return <WorkspaceLifecyclePanel workspaceId={workspaceId} />;
  }

  return (
    <div className="tw:min-w-0 tw:divide-y tw:divide-border tw:overflow-hidden tw:rounded-surface tw:border tw:border-border tw:bg-surface">
        {area === "access" ? (
          <WorkspaceAccessPanel workspaceId={workspaceId} />
        ) : null}
        {area === "access" ? (
          <ConnectionAccessPanel workspaceId={workspaceId} />
        ) : null}
        {area === "providers" ? (
          <CloudAccountPanel
            workspaceId={workspaceId}
            gcpSetupId={gcpSetupId}
          />
        ) : null}
        {area === "providers" ? (
          <SharedDatabasePanel
            workspaceId={workspaceId}
            initialIntegrationId={initialIntegrationId}
            initialConnectionId={initialConnectionId}
          />
        ) : null}
    </div>
  );
}
