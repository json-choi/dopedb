// Settings shell for application preferences, the signed-in account, workspace
// administration, and per-connection safety. Kept outside the data tabs so
// navigation remains focused on the selected database.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConnectionProfile } from "../../features/connections/domain";
import type { SafetySettings } from "../../ipc/types";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import {
  Field,
  SelectInput,
} from "../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import { TreeSearch } from "../../design-system/components/TreeControls";
import { useI18n } from "../../lib/i18n";
import { settingsSearchKeywords, type SettingsSection } from "../../features/settings/domain";
import { useWorkspaceAdminScope } from "../../features/workspaceAdmin/scope";
import {
  workspaceAuthStateQuery,
  workspaceContextQuery,
} from "../../features/workspaces/queries";
import {
  appUpdaterProgress,
  type AppUpdaterSnapshot,
} from "../../features/updater/controller";
import AccountSettings from "./Account";
import AdvancedSettings from "./Advanced";
import Appearance from "./Appearance";
import AgentTools from "./AgentTools";
import CliSettings from "./Cli";
import PrivacySettings from "./Privacy";
import Safety from "./Safety";
import Updates from "./Updates";
import WorkspaceAccessSettings from "./WorkspaceAccess";
import WorkspaceLifecycleSettings from "./WorkspaceLifecycle";
import WorkspaceMembersSettings from "./WorkspaceMembers";
import WorkspaceProvidersSettings from "./WorkspaceProviders";

type SettingsScope = "application" | "workspace" | "dataSource";
const SETTINGS_SCOPES = ["application", "workspace", "dataSource"] as const;

export default function Settings({
  connection,
  onClose,
  onConnectionUpdated,
  onSafetySaved,
  onOpenAdminConnection,
  refreshSafety,
  initialSection,
  updater,
  onUpdateRefresh,
  onUpdateInstall,
}: {
  connection: ConnectionProfile | null;
  onClose: () => void;
  onConnectionUpdated: (connection: ConnectionProfile) => void;
  onSafetySaved: (connectionId: string, settings: SafetySettings) => void;
  onOpenAdminConnection: (connection: ConnectionProfile) => void;
  // Re-loads the App's per-connection safety so Safety edits apply without reselecting.
  refreshSafety: () => void;
  initialSection?: SettingsSection;
  updater: AppUpdaterSnapshot;
  onUpdateRefresh: () => Promise<void>;
  onUpdateInstall: () => Promise<void>;
}) {
  const { langPreference, setLang, t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(
    initialSection ?? "agent-tools",
  );
  const [filter, setFilter] = useState("");
  const auth = useQuery(workspaceAuthStateQuery());
  const workspaceContext = useQuery(workspaceContextQuery());
  const signedIn = Boolean(auth.data?.user);
  const adminScope = useWorkspaceAdminScope();
  // Account and workspace sections depend on these reads; until both settle, a
  // requested section is not yet known to be unavailable.
  const scopeResolved = auth.data !== undefined && workspaceContext.data !== undefined;
  const settingsEntries = useMemo(
    () =>
      [
        {
          id: "agent-tools",
          label: t("settings.agentTools"),
          scope: "application",
          disabled: false,
          keywords: settingsSearchKeywords["agent-tools"],
        },
        {
          id: "advanced",
          label: t("settings.advanced"),
          scope: "application",
          disabled: false,
          keywords: settingsSearchKeywords.advanced,
        },
        {
          id: "cli",
          label: t("settings.cli"),
          scope: "application",
          disabled: false,
          keywords: settingsSearchKeywords.cli,
        },
        {
          id: "appearance",
          label: t("settings.appearance"),
          scope: "application",
          disabled: false,
          keywords: settingsSearchKeywords.appearance,
        },
        {
          id: "language",
          label: t("settings.languageTitle"),
          scope: "application",
          disabled: false,
          keywords: settingsSearchKeywords.language,
        },
        {
          id: "privacy",
          label: t("settings.privacy"),
          scope: "application",
          disabled: false,
          keywords: settingsSearchKeywords.privacy,
        },
        {
          id: "updates",
          label: t("settings.updates"),
          scope: "application",
          disabled: false,
          keywords: settingsSearchKeywords.updates,
        },
        ...(signedIn
          ? [
              {
                id: "account",
                label: t("workspaceAdmin.account"),
                scope: "application",
                disabled: false,
                keywords: settingsSearchKeywords.account,
              } as const,
            ]
          : []),
        // Administration sections exist only for the exact role that may use them;
        // other members see no placeholder for commands they cannot run.
        ...(adminScope?.canManage
          ? [
              {
                id: "workspace-members",
                label: t("workspaceAdmin.members"),
                scope: "workspace",
                disabled: false,
                keywords: settingsSearchKeywords["workspace-members"],
              } as const,
              {
                id: "workspace-access",
                label: t("workspaceAdmin.access"),
                scope: "workspace",
                disabled: false,
                keywords: settingsSearchKeywords["workspace-access"],
              } as const,
              {
                id: "workspace-providers",
                label: t("workspaceAdmin.providers"),
                scope: "workspace",
                disabled: false,
                keywords: settingsSearchKeywords["workspace-providers"],
              } as const,
            ]
          : []),
        ...(adminScope?.isOwner
          ? [
              {
                id: "workspace-lifecycle",
                label: t("workspaceAdmin.lifecycle"),
                scope: "workspace",
                disabled: false,
                keywords: settingsSearchKeywords["workspace-lifecycle"],
              } as const,
            ]
          : []),
        {
          id: "safety",
          label: `${t("settings.safety")}${
            connection
              ? ` · ${connection.name || t("app.unnamed")}`
              : ""
          }`,
          scope: "dataSource",
          disabled: false,
          keywords: settingsSearchKeywords.safety,
        },
      ] satisfies ReadonlyArray<{
        id: SettingsSection;
        label: string;
        scope: SettingsScope;
        disabled: boolean;
        keywords: string;
      }>,
    [adminScope?.canManage, adminScope?.isOwner, connection, signedIn, t],
  );
  const filteredEntries = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase().normalize("NFKC");
    if (!query) return settingsEntries;
    return settingsEntries.filter((entry) =>
      `${entry.label} ${entry.keywords}`
        .toLocaleLowerCase()
        .normalize("NFKC")
        .includes(query),
    );
  }, [filter, settingsEntries]);
  const filteredIds = filteredEntries
    .map((entry) => entry.id)
    .join(":");

  useEffect(() => {
    if (!filter || filteredEntries.some((entry) => entry.id === section)) {
      return;
    }
    const next = filteredEntries.find((entry) => !entry.disabled);
    if (next) setSection(next.id);
  }, [filter, filteredEntries, filteredIds, section]);

  useEffect(() => {
    if (!scopeResolved || settingsEntries.some((entry) => entry.id === section)) return;
    setSection(settingsEntries[0]?.id ?? "agent-tools");
  }, [scopeResolved, section, settingsEntries]);

  // Safety may have changed while this menu was open — refresh App's copy on the way out.
  function close() {
    refreshSafety();
    onClose();
  }

  const activeEntry =
    settingsEntries.find((entry) => entry.id === section) ??
    settingsEntries[0];
  function scopeLabel(scope: SettingsScope) {
    if (scope === "workspace") {
      return adminScope
        ? `${t("workspaceAdmin.scope")} · ${adminScope.workspaceName}`
        : t("workspaceAdmin.scope");
    }
    return t(
      scope === "application"
        ? "settings.scopeApplication"
        : "settings.scopeDataSource",
    );
  }
  const updateProgress = appUpdaterProgress(updater);
  const updateNavigationStatus =
    updater.phase === "downloading" && updateProgress !== null
      ? `${updateProgress}%`
      : updater.phase === "installing"
        ? t("updates.installing")
        : updater.phase === "checking"
          ? t("updates.checking")
          : updater.phase === "error"
            ? t("updates.error")
            : updater.phase === "ready"
              ? t("updates.relaunching")
              : updater.phase === "available"
                ? t("updates.available")
                : null;

  return (
    <ModalBackdrop>
      <ModalSurface
        size="settings"
        aria-labelledby="settings-dialog-title"
        onRequestClose={close}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            (event.target as HTMLElement).closest("input, textarea, select")
          ) {
            event.preventDefault();
          }
        }}
      >
        <div
          data-settings
          className="tw:flex tw:h-full tw:min-h-0 tw:flex-col tw:bg-background"
        >
          <ModalHeader
            title={t("common.settings")}
            titleId="settings-dialog-title"
          />

          <div className="tw:grid tw:min-h-0 tw:flex-1 tw:grid-cols-[202px_minmax(0,1fr)] tw:@max-[700px]:grid-cols-1">
            <aside className="tw:flex tw:min-h-0 tw:flex-col tw:border-r tw:border-border-subtle tw:bg-card tw:@max-[700px]:hidden">
              <div className="tw:p-2">
                <TreeSearch
                  value={filter}
                  autoFocus
                  placeholder={t("settings.searchPlaceholder")}
                  clearLabel={t("common.clearSearch")}
                  onChange={setFilter}
                  onEscape={() => {
                    if (filter) setFilter("");
                    else close();
                  }}
                />
              </div>
              <nav className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto">
                {SETTINGS_SCOPES.map((scope) => {
                  const entries = filteredEntries.filter(
                    (entry) => entry.scope === scope,
                  );
                  if (entries.length === 0) return null;
                  return (
                    <section
                      key={scope}
                      className="tw:grid tw:gap-0.5 tw:pb-2"
                    >
                      <div className="tw:flex tw:min-h-[var(--ds-tree-row-height)] tw:items-center tw:gap-1 tw:px-2 tw:text-ui tw:font-semibold">
                        <Icon
                          name="chevronDown"
                          className="tw:text-muted-foreground"
                        />
                        <span className="tw:min-w-0 tw:truncate" title={scopeLabel(scope)}>
                          {scopeLabel(scope)}
                        </span>
                      </div>
                      {entries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          data-active={section === entry.id}
                          aria-current={
                            section === entry.id ? "page" : undefined
                          }
                          className="tw:flex tw:min-h-[var(--ds-tree-row-height)] tw:cursor-pointer tw:items-center tw:justify-between tw:gap-2 tw:rounded-none tw:border-0 tw:bg-transparent tw:pr-3 tw:pl-12 tw:font-sans tw:text-left tw:text-ui tw:text-foreground tw:data-[active=true]:bg-selection tw:data-[active=true]:text-selection-foreground tw:disabled:cursor-default tw:disabled:opacity-50 tw:not-disabled:hover:bg-muted"
                          onClick={() => setSection(entry.id)}
                          disabled={entry.disabled}
                        >
                          <span className="tw:min-w-0 tw:truncate">
                            {entry.label}
                          </span>
                          {entry.id === "updates" && updateNavigationStatus ? (
                            <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">
                              {updateNavigationStatus}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </section>
                  );
                })}
                {filteredEntries.length === 0 ? (
                  <p className="tw:m-0 tw:px-3 tw:py-4 tw:text-sm tw:text-muted-foreground">
                    {t("settings.noSearchResults")}
                  </p>
                ) : null}
              </nav>
            </aside>

            <section className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col">
              <div className="tw:hidden tw:h-title-toolbar tw:shrink-0 tw:items-center tw:border-b tw:border-border-subtle tw:bg-background tw:px-3 tw:@max-[700px]:flex">
                <SelectInput
                  density="compact"
                  aria-label={t("common.settings")}
                  value={section}
                  onChange={(event) => {
                    setFilter("");
                    setSection(event.target.value as SettingsSection);
                  }}
                >
                  {SETTINGS_SCOPES.filter((scope) =>
                    settingsEntries.some((entry) => entry.scope === scope),
                  ).map((scope) => (
                    <optgroup key={scope} label={scopeLabel(scope)}>
                      {settingsEntries
                        .filter((entry) => entry.scope === scope)
                        .map((entry) => (
                          <option
                            key={entry.id}
                            value={entry.id}
                            disabled={entry.disabled}
                          >
                            {entry.label}
                            {entry.id === "updates" && updateNavigationStatus
                              ? ` · ${updateNavigationStatus}`
                              : ""}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </SelectInput>
              </div>
              <div className="tw:flex tw:h-[42px] tw:min-h-[42px] tw:shrink-0 tw:items-center tw:gap-2 tw:bg-background tw:px-4 tw:text-ui tw:font-semibold tw:@max-[700px]:hidden">
                <span className="tw:text-muted-foreground">
                  {scopeLabel(activeEntry?.scope ?? "application")}
                </span>
                <Icon
                  name="chevronRight"
                  className="tw:text-muted-foreground"
                />
                <span>{activeEntry?.label}</span>
              </div>
              <div className="tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-auto tw:p-[var(--ds-pane-pad)] tw:[container-name:settings-body] tw:[container-type:inline-size] tw:@max-[700px]:p-3">
                {section === "agent-tools" && <AgentTools />}
                {section === "advanced" && <AdvancedSettings />}
                {section === "cli" && <CliSettings connection={connection} />}
                {section === "privacy" && <PrivacySettings />}
                {section === "updates" && (
                  <Updates
                    snapshot={updater}
                    onRefresh={onUpdateRefresh}
                    onInstall={onUpdateInstall}
                  />
                )}
                {section === "appearance" && <Appearance />}
                {section === "account" && signedIn && <AccountSettings />}
                {adminScope?.canManage ? (
                  <Fragment key={`${adminScope.accountId}:${adminScope.workspaceId}`}>
                    {section === "workspace-members" && (
                      <WorkspaceMembersSettings scope={adminScope} onNavigate={setSection} />
                    )}
                    {section === "workspace-access" && (
                      <WorkspaceAccessSettings scope={adminScope} onNavigate={setSection} />
                    )}
                    {section === "workspace-providers" && (
                      <WorkspaceProvidersSettings scope={adminScope} onNavigate={setSection} />
                    )}
                    {section === "workspace-lifecycle" && adminScope.isOwner && (
                      <WorkspaceLifecycleSettings scope={adminScope} onNavigate={setSection} />
                    )}
                  </Fragment>
                ) : null}
                {section === "language" && (
                  <div className="tw:grid tw:max-w-[560px] tw:gap-4 tw:p-4">
                    <Field label={t("language.label")}>
                      <SelectInput
                        value={langPreference}
                        onChange={(e) =>
                          setLang(e.target.value as typeof langPreference)
                        }
                      >
                        <option value="system">{t("language.system")}</option>
                        <option value="ko">{t("language.korean")}</option>
                        <option value="en">{t("language.english")}</option>
                      </SelectInput>
                    </Field>
                  </div>
                )}
                {section === "safety" &&
                  (connection ? (
                    <Safety
                      connection={connection}
                      onConnectionUpdated={onConnectionUpdated}
                      onSaved={onSafetySaved}
                      onOpenAdminConnection={() => onOpenAdminConnection(connection)}
                    />
                  ) : (
                    <div className="tw:text-muted-foreground">
                      {t("settings.selectConnection")}
                    </div>
                  ))}
              </div>
            </section>
          </div>

          <ModalFooter>
            <Button
              size="compact"
              variant="primary"
              onClick={close}
            >
              {t("common.done")}
            </Button>
          </ModalFooter>
        </div>
      </ModalSurface>
    </ModalBackdrop>
  );
}
