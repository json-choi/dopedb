// Authenticated workspace and device-session console. Server rendering resolves the
// current Better Auth identity before exposing any organization administration UI.
import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { db } from "../../lib/db";
import { acceptPendingWorkspaceInvitations } from "../../lib/pending-invitations";
import {
  isPersonalKnowledgeMetadata,
  isPersonalKnowledgeOrganization,
} from "../../lib/knowledge/personal-scope";
import { member, workspaceProfile } from "../../lib/schema";
import { Brand } from "../components/Brand";
import { LocaleSwitcher } from "../components/LocaleSwitcher";
import { ConsoleNotice } from "../components/Console";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";
import { AccountSwitcher } from "./AccountSwitcher";
import { AccountManagementPanel } from "./AccountManagementPanel";
import {
  settingsSection,
  SettingsNavigation,
  type SettingsSection,
} from "./SettingsNavigation";
import {
  localizedWorkspaceManagementAreas,
  WorkspaceManagementPanel,
  type WorkspaceManagementArea,
} from "./WorkspaceManagementPanel";
import { localizedWorkspacePath } from "../../lib/workspace-locale";
import { getWorkspaceLocale } from "../../lib/workspace-locale-server";
import { workspaceMessages } from "../../lib/workspace-messages";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    workspace?: string | string[];
    provider?: string | string[];
    status?: string | string[];
    gcpSetup?: string | string[];
    integration?: string | string[];
    connection?: string | string[];
    section?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale];
  const workspaceManagementAreas = localizedWorkspaceManagementAreas(locale);
  const requestedSection: SettingsSection = settingsSection(params.section);
  const requestedWorkspaceId =
    typeof params.workspace === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.workspace)
      ? params.workspace
      : null;
  const requestedGcpSetupId =
    typeof params.gcpSetup === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(params.gcpSetup)
      ? params.gcpSetup
      : null;
  const requestedIntegrationId =
    typeof params.integration === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(params.integration)
      ? params.integration
      : null;
  const requestedConnectionId =
    typeof params.connection === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(params.connection)
      ? params.connection
      : null;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const encodedWorkspaceId = requestedWorkspaceId
    ? encodeURIComponent(requestedWorkspaceId)
    : null;
  const settingsPath = localizedWorkspacePath(`/settings?${
    encodedWorkspaceId ? `workspace=${encodedWorkspaceId}&` : ""
  }section=${requestedSection}${
    requestedConnectionId
      ? `&connection=${encodeURIComponent(requestedConnectionId)}`
      : ""
  }`, locale);
  if (!session) {
    redirect(localizedWorkspacePath(
      `/auth/sign-in?returnTo=${encodeURIComponent(settingsPath)}`,
      locale,
    ));
  }
  await acceptPendingWorkspaceInvitations({
    api: auth.api,
    headers: requestHeaders,
    user: session.user,
    activeOrganizationId: session.session.activeOrganizationId,
  });
  const workspaces = await auth.api.listOrganizations({ headers: requestHeaders });
  const roleRows = workspaces.length > 0
    ? await db.select({
        organizationId: member.organizationId,
        role: member.role,
        lifecycleState: workspaceProfile.lifecycleState,
      })
        .from(member)
        .innerJoin(
          workspaceProfile,
          eq(workspaceProfile.organizationId, member.organizationId),
        )
        .where(and(
          eq(member.userId, session.user.id),
          inArray(member.organizationId, workspaces.map((workspace) => workspace.id)),
        ))
    : [];
  const workspaceRoles = new Map(roleRows.map((row) => [row.organizationId, row.role]));
  const workspaceLifecycleStates = new Map(
    roleRows.map((row) => [row.organizationId, row.lifecycleState]),
  );
  const visibleWorkspaces = workspaces.filter((workspace) => (
    !isPersonalKnowledgeOrganization(session.user.id, workspace.id)
    && !isPersonalKnowledgeMetadata(workspace.metadata)
    && (
      workspaceLifecycleStates.get(workspace.id) === "active"
      || (
        workspaceLifecycleStates.get(workspace.id) === "deletion_pending"
        && workspaceRoles.get(workspace.id) === "owner"
      )
    )
  ));
  const requestedWorkspace = visibleWorkspaces.find(
    (workspace) => workspace.id === requestedWorkspaceId,
  ) ?? null;
  const sessionWorkspace = visibleWorkspaces.find(
    (workspace) => workspace.id === session.session.activeOrganizationId,
  ) ?? null;
  const activeWorkspace = requestedWorkspace ?? sessionWorkspace ?? visibleWorkspaces[0] ?? null;
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const orderedWorkspaces = activeWorkspaceId
    ? [
        ...visibleWorkspaces.filter((workspace) => workspace.id === activeWorkspaceId),
        ...visibleWorkspaces.filter((workspace) => workspace.id !== activeWorkspaceId),
      ]
    : visibleWorkspaces;
  const activeWorkspaceRole = activeWorkspace
    ? workspaceRoles.get(activeWorkspace.id) ?? "member"
    : null;
  const activeWorkspaceLifecycleState = activeWorkspace
    ? workspaceLifecycleStates.get(activeWorkspace.id) ?? null
    : null;
  const workspaceDeletionPending = activeWorkspaceLifecycleState === "deletion_pending";
  const canDeleteActiveWorkspace = activeWorkspaceRole === "owner";
  const canManageActiveWorkspace = Boolean(
    activeWorkspace
    && ["admin", "owner"].includes(activeWorkspaceRole ?? ""),
  );
  const activeSection: SettingsSection =
    requestedSection === "account"
      ? "account"
      : workspaceDeletionPending
        ? requestedSection === "workspaces" ? "workspaces" : "workspace-settings"
        : requestedSection === "workspaces"
          ? "workspaces"
          : (requestedGcpSetupId || typeof params.provider === "string")
              && canManageActiveWorkspace
            ? "providers"
            : requestedSection === "workspace-settings" && canDeleteActiveWorkspace
              ? "workspace-settings"
              : (requestedSection === "access" || requestedSection === "providers")
                  && canManageActiveWorkspace
                ? requestedSection
                : "workspaces";
  const activeManagementArea: WorkspaceManagementArea | null =
    activeSection === "access"
    || activeSection === "providers"
    || activeSection === "workspace-settings"
      ? activeSection
      : null;
  const activeManagementDetails = activeManagementArea
    ? workspaceManagementAreas.find((item) => item.id === activeManagementArea)
    : null;
  const pageTitle = activeSection === "account"
    ? copy.settings.accountTitle
    : activeSection === "workspaces"
      ? copy.settings.workspacesTitle
      : activeManagementDetails?.label ?? copy.settings.workspacesTitle;
  const pageDescription = activeSection === "account"
    ? copy.settings.accountDescription
    : activeSection === "workspaces"
      ? copy.settings.workspacesDescription
      : activeManagementDetails?.description ?? copy.settings.workspacesDescription;
  const roleLabels = copy.members.roles;
  const localizedRole = (role: string | null | undefined) => (
    role && role in roleLabels
      ? roleLabels[role as keyof typeof roleLabels]
      : role ?? copy.common.notSelected
  );
  const localizedActiveRole = localizedRole(activeWorkspaceRole);

  return (
    <main className="tw:min-h-[100dvh]" id="main-content">
      <header className="tw:sticky tw:top-0 tw:z-20 tw:border-b tw:border-chrome-border tw:bg-chrome tw:text-chrome-foreground">
        <div className="tw:mx-auto tw:flex tw:min-h-16 tw:w-full tw:max-w-[1200px] tw:items-center tw:justify-between tw:gap-5 tw:px-[clamp(20px,4vw,48px)]">
          <Brand tone="inverse" />
          <div className="tw:flex tw:items-center tw:gap-2">
            <LocaleSwitcher tone="inverse" />
            <AccountSwitcher
              currentSessionId={session.session.id}
              currentUser={{
                id: session.user.id,
                name: session.user.name,
                email: session.user.email,
              }}
            />
          </div>
        </div>
        <SettingsNavigation
          activeSection={activeSection}
          workspaceId={activeWorkspaceId}
          gcpSetupId={requestedGcpSetupId}
          canManageWorkspace={canManageActiveWorkspace}
          canDeleteWorkspace={canDeleteActiveWorkspace}
          workspaceDeletionPending={workspaceDeletionPending}
          locale={locale}
        />
      </header>
      <div className="tw:relative tw:mx-auto tw:w-full tw:max-w-[1120px] tw:px-[clamp(20px,4vw,40px)] tw:pt-[clamp(30px,4vw,48px)] tw:pb-24">
        <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-6 tw:border-b tw:border-border tw:pb-6">
          <div className="tw:min-w-0">
            <h1 className="tw:m-0 tw:text-[clamp(30px,4vw,42px)] tw:leading-tight tw:font-semibold tw:tracking-[-0.035em] tw:text-balance">
              {pageTitle}
            </h1>
            <p className="tw:mt-2 tw:mb-0 tw:max-w-[680px] tw:text-sm tw:leading-body tw:text-muted-foreground">
              {pageDescription}
            </p>
          </div>
          {activeWorkspace
          && activeSection !== "account"
          && activeSection !== "workspaces" ? (
            <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-x-3 tw:gap-y-2 tw:text-xs">
              <strong className="tw:max-w-56 tw:truncate tw:font-medium tw:text-foreground">
                {activeWorkspace.name}
              </strong>
              <span className="tw:text-muted-foreground">{localizedActiveRole}</span>
              <a
                className="tw:font-medium tw:text-primary tw:no-underline tw:hover:underline tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring"
                href={localizedWorkspacePath(
                  `/settings?workspace=${encodeURIComponent(activeWorkspace.id)}&section=workspaces`,
                  locale,
                )}
              >
                {copy.settings.changeWorkspace}
              </a>
            </div>
          ) : null}
        </header>
        {activeSection === "providers"
        && params.provider === "planetScale"
        && params.status === "connected" ? (
          <ConsoleNotice>
            {copy.settings.planetScaleConnected}
          </ConsoleNotice>
        ) : null}
        {activeSection === "providers"
        && params.provider === "planetScale"
        && params.status === "failed" ? (
          <ConsoleNotice tone="danger">
            {copy.settings.planetScaleFailed}
          </ConsoleNotice>
        ) : null}
        {activeSection === "providers"
        && params.provider === "gcpCloudSql"
        && params.status === "authorised" ? (
          <ConsoleNotice>
            {copy.settings.gcpConnected}
          </ConsoleNotice>
        ) : null}
        {activeSection === "providers"
        && params.provider === "gcpCloudSql"
        && params.status === "failed" ? (
          <ConsoleNotice tone="danger">
            {copy.settings.gcpFailed}
          </ConsoleNotice>
        ) : null}
        {activeSection === "account" ? (
          <section id="account" className="tw:scroll-mt-28 tw:pt-8">
            <AccountManagementPanel
              currentSessionId={session.session.id}
              user={{ name: session.user.name, email: session.user.email }}
            />
          </section>
        ) : null}

        {activeSection === "workspaces" ? (
          <section id="workspaces" className="tw:scroll-mt-28 tw:pt-8">
            <div className="tw:grid tw:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.62fr)] tw:items-start tw:gap-5 tw:max-[900px]:grid-cols-1">
              <div className="tw:overflow-hidden tw:rounded-surface tw:border tw:border-border tw:bg-surface">
                {orderedWorkspaces.map((workspace) => (
                  <article
                    className="tw:scroll-mt-32 tw:border-b tw:border-border tw:last:border-b-0 tw:data-[focused=true]:bg-selection"
                    data-focused={workspace.id === activeWorkspaceId}
                    id={`workspace-${workspace.id}`}
                    key={workspace.id}
                  >
                    <a
                      className="tw:grid tw:min-h-20 tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:px-4 tw:py-3 tw:transition-colors tw:hover:bg-surface-raised tw:focus-visible:outline-2 tw:focus-visible:outline-offset-[-3px] tw:focus-visible:outline-ring tw:max-[560px]:grid-cols-[auto_minmax(0,1fr)]"
                      href={localizedWorkspacePath(
                        `/settings?workspace=${encodeURIComponent(workspace.id)}&section=${
                          workspaceLifecycleStates.get(workspace.id) === "deletion_pending"
                            ? "workspace-settings"
                            : ["admin", "owner"].includes(workspaceRoles.get(workspace.id) ?? "")
                            ? "access"
                              : "workspaces"
                        }`,
                        locale,
                      )}
                      aria-current={
                        workspace.id === activeWorkspaceId ? "true" : undefined
                      }
                    >
                      <div className="tw:grid tw:size-10 tw:place-items-center tw:rounded-control tw:border tw:border-primary/20 tw:bg-surface-inset tw:font-mono tw:text-2xs tw:font-medium tw:text-primary">
                        {workspace.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="tw:mb-1 tw:text-[15px] tw:font-medium">
                          {workspace.name}
                        </h3>
                        <p className="tw:font-mono tw:text-2xs tw:text-muted-foreground">
                          {workspace.slug}
                        </p>
                      </div>
                      <span className="tw:flex tw:items-center tw:gap-2 tw:font-mono tw:text-2xs tw:text-primary tw:max-[560px]:col-start-2">
                        <i
                          className="tw:size-1.5 tw:rounded-full tw:bg-success tw:data-[pending=true]:bg-danger"
                          data-pending={workspaceLifecycleStates.get(workspace.id) === "deletion_pending"}
                        />
                        {workspaceLifecycleStates.get(workspace.id) === "deletion_pending"
                          ? copy.workspaceLifecycle.deletionPending
                          : workspace.id === activeWorkspaceId
                            ? `${localizedRole(workspaceRoles.get(workspace.id))} · ${copy.settings.currentSuffix}`
                            : localizedRole(workspaceRoles.get(workspace.id))}
                      </span>
                    </a>
                  </article>
                ))}
                {visibleWorkspaces.length === 0 ? (
                  <div className="tw:px-7 tw:py-12 tw:text-center">
                    <span className="tw:mx-auto tw:mb-4 tw:grid tw:size-12 tw:place-items-center tw:rounded-full tw:bg-selection tw:text-primary">＋</span>
                    <strong className="tw:block tw:text-sm tw:font-medium tw:text-foreground">
                      {copy.settings.emptyTitle}
                    </strong>
                    <small className="tw:mt-2 tw:block tw:text-xs tw:text-muted-foreground">
                      {copy.settings.emptyDescription}
                    </small>
                  </div>
                ) : null}
              </div>
              <CreateWorkspaceForm />
            </div>
          </section>
        ) : null}

        {activeManagementArea
        && activeManagementDetails
        && activeWorkspace
        && (activeManagementArea === "workspace-settings"
          ? canDeleteActiveWorkspace
          : canManageActiveWorkspace) ? (
          <section
            className="tw:scroll-mt-28 tw:pt-8"
            id={activeManagementArea}
          >
            <WorkspaceManagementPanel
              workspaceId={activeWorkspace.id}
              gcpSetupId={requestedGcpSetupId}
              initialIntegrationId={requestedIntegrationId}
              initialConnectionId={requestedConnectionId}
              area={activeManagementArea}
            />
          </section>
        ) : null}
      </div>
    </main>
  );
}
