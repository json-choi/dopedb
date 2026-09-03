// Root settings navigation owns the active workspace concern. This component
// renders only that concern's command surface and never creates nested settings.
import { ConnectionAccessPanel } from "./ConnectionAccessPanel";
import { CloudAccountPanel } from "./CloudAccountPanel";
import { AnalysisManagementPanel } from "./AnalysisManagementPanel";
import { KnowledgeAccessPanel } from "./KnowledgeAccessPanel";
import { SharedDatabasePanel } from "./SharedDatabasePanel";
import { WorkspaceAccessPanel } from "./WorkspaceAccessPanel";
import { WorkspaceLifecyclePanel } from "./WorkspaceLifecyclePanel";
import { localizedWorkspacePath, type WorkspaceLocale } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";

export type WorkspaceManagementArea =
  | "cloud-accounts"
  | "databases"
  | "database-access"
  | "analyses"
  | "members"
  | "lifecycle";

export function localizedWorkspaceManagementAreas(locale: WorkspaceLocale): Array<{
  id: WorkspaceManagementArea;
  index: string;
  label: string;
  description: string;
}> {
  const areas = workspaceMessages[locale].settings.areas;
  return [
    { id: "cloud-accounts", index: "02", ...areas.cloudAccounts },
    { id: "databases", index: "03", ...areas.databases },
    { id: "database-access", index: "04", ...areas.databaseAccess },
    { id: "analyses", index: "05", ...areas.analyses },
    { id: "members", index: "06", ...areas.members },
    { id: "lifecycle", index: "07", ...areas.lifecycle },
  ];
}

export function WorkspaceManagementPanel({
  workspaceId,
  workspaceName,
  workspaceSlug,
  gcpSetupId,
  initialIntegrationId,
  initialArticleId,
  initialConnectionId,
  area,
  canEditWorkspace,
  locale,
}: {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  gcpSetupId: string | null;
  initialIntegrationId: string | null;
  initialArticleId: string | null;
  initialConnectionId: string | null;
  area: WorkspaceManagementArea;
  canEditWorkspace: boolean;
  locale: WorkspaceLocale;
}) {
  const copy = workspaceMessages[locale];
  const workspaceManagementAreas = localizedWorkspaceManagementAreas(locale);
  const selected =
    workspaceManagementAreas.find((item) => item.id === area)
    ?? workspaceManagementAreas[0];

  return (
    <section className="tw:min-w-0 tw:overflow-hidden tw:rounded-panel tw:border tw:border-border tw:bg-surface tw:shadow-panel">
        <header className="tw:flex tw:items-center tw:justify-between tw:gap-5 tw:border-b tw:border-border tw:bg-surface-inset/70 tw:px-6 tw:py-4 tw:max-[640px]:items-start tw:max-[640px]:px-4">
          <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-3">
            <span className="tw:grid tw:size-10 tw:shrink-0 tw:place-items-center tw:rounded-surface tw:bg-selection tw:font-mono tw:text-2xs tw:font-medium tw:text-primary">
              {workspaceName.slice(0, 2).toUpperCase()}
            </span>
            <div className="tw:grid tw:min-w-0 tw:gap-0.5">
              <h3 className="tw:truncate tw:text-sm tw:font-medium tw:text-foreground">
                {workspaceName}
              </h3>
              <span className="tw:truncate tw:font-mono tw:text-2xs tw:text-muted-foreground">
                {workspaceSlug} · {selected.index} {selected.label}
              </span>
            </div>
          </div>
          <a
            className="tw:shrink-0 tw:rounded-control tw:border tw:border-border tw:bg-surface tw:px-3 tw:py-2 tw:text-2xs tw:font-medium tw:text-muted-foreground tw:transition-colors tw:hover:border-primary tw:hover:text-primary"
            href={localizedWorkspacePath(
              `/settings?workspace=${encodeURIComponent(workspaceId)}&section=workspaces`,
              locale,
            )}
          >
            {copy.settings.changeWorkspace}
          </a>
        </header>

        {area === "members" ? (
          <WorkspaceAccessPanel workspaceId={workspaceId} />
        ) : null}
        {area === "database-access" ? (
          <>
            <ConnectionAccessPanel workspaceId={workspaceId} />
            <KnowledgeAccessPanel workspaceId={workspaceId} />
          </>
        ) : null}
        {area === "cloud-accounts" ? (
          <CloudAccountPanel
            workspaceId={workspaceId}
            gcpSetupId={gcpSetupId}
          />
        ) : null}
        {area === "databases" ? (
          <SharedDatabasePanel
            workspaceId={workspaceId}
            initialIntegrationId={initialIntegrationId}
            initialConnectionId={initialConnectionId}
          />
        ) : null}
        {area === "analyses" ? (
          <AnalysisManagementPanel
            workspaceId={workspaceId}
            initialArticleId={initialArticleId}
          />
        ) : null}
        {area === "lifecycle" ? (
          <WorkspaceLifecyclePanel workspaceId={workspaceId} />
        ) : null}
    </section>
  );
}
