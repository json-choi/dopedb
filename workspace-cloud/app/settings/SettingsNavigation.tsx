import type { WorkspaceManagementArea } from "./WorkspaceManagementPanel";
import { localizedWorkspacePath, type WorkspaceLocale } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";

export type SettingsSection =
  | "account"
  | "workspaces"
  | WorkspaceManagementArea;

const workspaceSections: Array<{
  id: SettingsSection;
}> = [
  { id: "workspaces" },
  { id: "access" },
  { id: "providers" },
  { id: "workspace-settings" },
];

export function settingsSection(value: unknown): SettingsSection {
  return typeof value === "string"
      && [...workspaceSections.map((item) => item.id), "account"].includes(value)
    ? value as SettingsSection
    : "workspaces";
}

export function SettingsNavigation({
  activeSection,
  workspaceId,
  gcpSetupId,
  canManageWorkspace,
  canDeleteWorkspace,
  workspaceDeletionPending,
  locale,
}: {
  activeSection: SettingsSection;
  workspaceId: string | null;
  gcpSetupId: string | null;
  canManageWorkspace: boolean;
  canDeleteWorkspace: boolean;
  workspaceDeletionPending: boolean;
  locale: WorkspaceLocale;
}) {
  const copy = workspaceMessages[locale];
  const workspaceQuery = workspaceId
    ? `workspace=${encodeURIComponent(workspaceId)}&`
    : "";

  return (
    <nav
      className="tw:mx-auto tw:flex tw:w-full tw:max-w-[1200px] tw:overflow-x-auto tw:border-t tw:border-chrome-border tw:px-[clamp(20px,4vw,48px)] tw:[scrollbar-width:none]"
      aria-label={copy.common.settings}
    >
      {workspaceSections.map((item) => {
        if (
          workspaceDeletionPending
          && item.id !== "workspaces"
          && item.id !== "workspace-settings"
        ) return null;
        if (item.id === "workspace-settings" && !canDeleteWorkspace) return null;
        if (
          item.id !== "workspaces"
          && item.id !== "workspace-settings"
          && !canManageWorkspace
        ) {
          return null;
        }
        const setupQuery = item.id === "providers" && gcpSetupId
          ? `&gcpSetup=${encodeURIComponent(gcpSetupId)}`
          : "";
        const label = item.id === "workspaces"
          ? copy.settings.workspacesTitle
          : item.id === "access"
            ? copy.settings.areas.access.label
            : item.id === "providers"
              ? copy.settings.areas.providers.label
              : copy.settings.areas.workspaceSettings.label;
        return (
          <a
            className="tw:flex tw:min-h-[46px] tw:min-w-max tw:items-center tw:border-b-2 tw:border-transparent tw:px-4 tw:text-xs tw:font-medium tw:text-chrome-muted tw:transition-colors tw:hover:bg-chrome-foreground/5 tw:hover:text-chrome-foreground tw:data-[active=true]:border-signal tw:data-[active=true]:text-chrome-foreground"
            data-active={activeSection === item.id}
            href={localizedWorkspacePath(
              `/settings?${workspaceQuery}section=${item.id}${setupQuery}`,
              locale,
            )}
            aria-current={activeSection === item.id ? "page" : undefined}
            key={item.id}
          >
            {label}
          </a>
        );
      })}
      <a
        className="tw:ml-auto tw:flex tw:min-h-[46px] tw:min-w-max tw:items-center tw:border-b-2 tw:border-transparent tw:px-4 tw:text-xs tw:font-medium tw:text-chrome-muted tw:transition-colors tw:before:mr-4 tw:before:h-4 tw:before:w-px tw:before:bg-chrome-border tw:before:content-[''] tw:hover:bg-chrome-foreground/5 tw:hover:text-chrome-foreground tw:data-[active=true]:border-signal tw:data-[active=true]:text-chrome-foreground tw:max-[700px]:ml-0"
        data-active={activeSection === "account"}
        href={localizedWorkspacePath("/settings?section=account", locale)}
        aria-current={activeSection === "account" ? "page" : undefined}
      >
        {copy.settings.accountTitle}
      </a>
    </nav>
  );
}
