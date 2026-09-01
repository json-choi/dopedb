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
import {
  ConsoleNotice,
  ConsoleSectionHeading,
} from "../components/Console";
import { IdentityEyebrow } from "../components/Identity";
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
    article?: string | string[];
    connection?: string | string[];
    block?: string | string[];
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
  const requestedArticleId =
    typeof params.article === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(params.article)
      ? params.article
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
  const activeSection: SettingsSection =
    workspaceDeletionPending
      && requestedSection !== "account"
      && requestedSection !== "workspaces"
      ? "lifecycle"
      : requestedGcpSetupId || typeof params.provider === "string"
      ? "cloud-accounts"
      : requestedSection;
  const activeManagementArea: WorkspaceManagementArea | null =
    activeSection === "members"
    || activeSection === "database-access"
    || activeSection === "cloud-accounts"
    || activeSection === "databases"
    || activeSection === "analyses"
    || activeSection === "lifecycle"
      ? activeSection
      : null;
  const canManageActiveWorkspace = Boolean(
    activeWorkspace
    && ["admin", "owner"].includes(activeWorkspaceRole ?? ""),
  );
  const canEditActiveWorkspace = Boolean(
    activeWorkspace
    && ["editor", "admin", "owner"].includes(activeWorkspaceRole ?? ""),
  );
  const activeManagementDetails = activeManagementArea
    ? workspaceManagementAreas.find((item) => item.id === activeManagementArea)
    : null;
  const pageIndex = activeSection === "account"
    ? "08"
    : activeSection === "workspaces"
      ? "01"
      : activeManagementDetails?.index ?? "01";
  const pageTitle = activeSection === "account"
    ? copy.settings.accountTitle
    : activeSection === "workspaces"
      ? copy.settings.workspacesTitle
      : activeManagementDetails?.label ?? copy.settings.workspacesTitle;
  const pageDescription = activeSection === "account"
    ? copy.settings.accountDescription
    : activeSection === "workspaces"
      ? copy.settings.workspacesDescription
      : activeManagementDetails?.description ?? copy.settings.sharedBoundaryDescription;
  const activeRole = activeWorkspace
    ? activeWorkspaceRole ?? "member"
    : copy.common.notSelected;
  const roleLabels = copy.members.roles;
  const localizedActiveRole = activeWorkspace && activeRole in roleLabels
    ? roleLabels[activeRole as keyof typeof roleLabels]
    : activeRole;

  return (
    <main className="tw:min-h-[100dvh]" id="main-content">
      <header className="tw:sticky tw:top-0 tw:z-20 tw:border-b tw:border-chrome-border tw:bg-chrome tw:text-chrome-foreground tw:shadow-[0_14px_40px_color-mix(in_srgb,var(--ds-chrome)_20%,transparent)]">
        <div className="tw:mx-auto tw:flex tw:min-h-[74px] tw:w-full tw:max-w-[1480px] tw:items-center tw:justify-between tw:gap-5 tw:px-[clamp(20px,4vw,64px)]">
          <Brand tone="inverse" />
          <span className="tw:flex tw:items-center tw:gap-2 tw:font-mono tw:text-2xs tw:text-chrome-muted tw:max-[860px]:hidden">
            <i className="tw:size-1.5 tw:rounded-full tw:bg-signal" />
            {copy.settings.headerStatus}
          </span>
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
      <div className="tw:relative tw:mx-auto tw:w-full tw:max-w-[1480px] tw:px-[clamp(22px,5vw,76px)] tw:pt-[clamp(48px,7vw,88px)] tw:pb-[110px]">
        <header className="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(300px,0.54fr)] tw:items-end tw:gap-[clamp(36px,7vw,100px)] tw:border-b tw:border-border tw:pb-[clamp(38px,5vw,64px)] tw:max-[820px]:grid-cols-1">
          <div>
            <IdentityEyebrow>CONTROL PLANE / {pageIndex}</IdentityEyebrow>
            <h1 className="tw:mt-4 tw:font-serif tw:text-[clamp(46px,6vw,76px)] tw:leading-[0.98] tw:font-normal tw:tracking-[-0.055em] tw:text-balance">
              {pageTitle}
            </h1>
            <p className="tw:mt-5 tw:max-w-[680px] tw:text-[15px] tw:leading-[1.75] tw:text-muted-foreground">
              {pageDescription}
            </p>
          </div>
          <dl className="tw:m-0 tw:grid tw:overflow-hidden tw:rounded-surface tw:border tw:border-border tw:bg-surface/85 tw:shadow-[0_16px_50px_color-mix(in_srgb,var(--ds-text)_6%,transparent)] tw:backdrop-blur">
            <div className="tw:grid tw:grid-cols-[110px_minmax(0,1fr)] tw:items-center tw:border-b tw:border-border tw:px-4 tw:py-3.5">
              <dt className="tw:font-mono tw:text-2xs tw:font-medium tw:text-muted-foreground">{activeSection === "account" ? copy.settings.summaryAccount : copy.settings.summaryWorkspace}</dt>
              <dd className="tw:m-0 tw:truncate tw:text-right tw:text-xs tw:font-medium tw:text-foreground">
                {activeSection === "account"
                  ? session.user.name
                  : activeWorkspace?.name ?? copy.common.notSelected}
              </dd>
            </div>
            <div className="tw:grid tw:grid-cols-[110px_minmax(0,1fr)] tw:items-center tw:px-4 tw:py-3.5">
              <dt className="tw:font-mono tw:text-2xs tw:font-medium tw:text-muted-foreground">{activeSection === "account" ? copy.settings.summaryIdentity : copy.settings.summaryAccess}</dt>
              <dd className="tw:m-0 tw:truncate tw:text-right tw:text-xs tw:text-primary">
                {activeSection === "account" ? session.user.email : localizedActiveRole}
              </dd>
            </div>
          </dl>
        </header>
        {activeSection === "cloud-accounts"
        && params.provider === "planetScale"
        && params.status === "connected" ? (
          <ConsoleNotice>
            {copy.settings.planetScaleConnected}
          </ConsoleNotice>
        ) : null}
        {activeSection === "cloud-accounts"
        && params.provider === "planetScale"
        && params.status === "failed" ? (
          <ConsoleNotice tone="danger">
            {copy.settings.planetScaleFailed}
          </ConsoleNotice>
        ) : null}
        {activeSection === "cloud-accounts"
        && params.provider === "gcpCloudSql"
        && params.status === "authorised" ? (
          <ConsoleNotice>
            {copy.settings.gcpConnected}
          </ConsoleNotice>
        ) : null}
        {activeSection === "cloud-accounts"
        && params.provider === "gcpCloudSql"
        && params.status === "failed" ? (
          <ConsoleNotice tone="danger">
            {copy.settings.gcpFailed}
          </ConsoleNotice>
        ) : null}
        {activeSection === "account" ? (
          <section id="account" className="tw:scroll-mt-32 tw:pt-[clamp(56px,7vw,88px)]">
            <ConsoleSectionHeading index="10" title={copy.settings.accountManagementTitle}>
              {copy.settings.accountManagementDescription}
            </ConsoleSectionHeading>
            <AccountManagementPanel
              currentSessionId={session.session.id}
              user={{ name: session.user.name, email: session.user.email }}
            />
          </section>
        ) : null}

        {activeSection === "workspaces" ? (
          <section id="workspaces" className="tw:scroll-mt-32 tw:pt-[clamp(56px,7vw,88px)]">
            <ConsoleSectionHeading index="01" title={copy.settings.workspacesTitle}>
              {copy.settings.workspaceSectionDescription}
            </ConsoleSectionHeading>
            <div className="tw:grid tw:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.62fr)] tw:items-start tw:gap-6 tw:max-[980px]:grid-cols-1">
              <div className="tw:overflow-hidden tw:rounded-panel tw:border tw:border-border tw:bg-surface tw:shadow-panel">
                {orderedWorkspaces.map((workspace) => (
                  <article
                    className="tw:scroll-mt-32 tw:border-b tw:border-border tw:last:border-b-0 tw:data-[focused=true]:bg-selection"
                    data-focused={workspace.id === activeWorkspaceId}
                    id={`workspace-${workspace.id}`}
                    key={workspace.id}
                  >
                    <a
                      className="tw:grid tw:min-h-[106px] tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:px-5 tw:py-4 tw:transition-colors tw:hover:bg-surface-raised tw:focus-visible:outline-2 tw:focus-visible:outline-offset-[-3px] tw:focus-visible:outline-ring tw:max-[560px]:grid-cols-[auto_minmax(0,1fr)]"
                      href={localizedWorkspacePath(
                        `/settings?workspace=${encodeURIComponent(workspace.id)}&section=${
                          workspaceLifecycleStates.get(workspace.id) === "deletion_pending"
                            ? "lifecycle"
                            : ["admin", "owner"].includes(workspaceRoles.get(workspace.id) ?? "")
                            ? "members"
                            : workspaceRoles.get(workspace.id) === "editor"
                              ? "analyses"
                              : "workspaces"
                        }`,
                        locale,
                      )}
                      aria-current={
                        workspace.id === activeWorkspaceId ? "true" : undefined
                      }
                    >
                      <div className="tw:grid tw:size-12 tw:place-items-center tw:rounded-surface tw:border tw:border-primary/20 tw:bg-surface-inset tw:font-mono tw:text-xs tw:font-medium tw:text-primary">
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
                            ? `${workspaceRoles.get(workspace.id)} · ${copy.settings.currentSuffix}`
                            : workspaceRoles.get(workspace.id)}
                      </span>
                    </a>
                  </article>
                ))}
                {visibleWorkspaces.length === 0 ? (
                  <div className="tw:px-7 tw:py-16 tw:text-center">
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
        && (activeManagementArea === "lifecycle"
          ? canDeleteActiveWorkspace
          : activeManagementArea === "analyses"
            ? true
            : canManageActiveWorkspace) ? (
          <section
            className="tw:scroll-mt-32 tw:pt-[clamp(56px,7vw,88px)]"
            id="workspace-settings"
          >
            <ConsoleSectionHeading
              index={activeManagementDetails.index}
              title={activeManagementDetails.label}
            >
              {activeWorkspace.name} · {activeManagementDetails.description}
            </ConsoleSectionHeading>
            <WorkspaceManagementPanel
              workspaceId={activeWorkspace.id}
              workspaceName={activeWorkspace.name}
              workspaceSlug={activeWorkspace.slug}
              gcpSetupId={requestedGcpSetupId}
              initialIntegrationId={requestedIntegrationId}
              initialArticleId={requestedArticleId}
              initialConnectionId={requestedConnectionId}
              area={activeManagementArea}
              canEditWorkspace={canEditActiveWorkspace}
              locale={locale}
            />
          </section>
        ) : null}
      </div>
    </main>
  );
}
