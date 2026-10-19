// Settings shell for application preferences, the signed-in account, and
// per-connection safety. Workspace administration lives in the separate Workspace
// management dialog, so this dialog stays about this app and its data sources.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConnectionProfile } from "../../features/connections/domain";
import type { SafetySettings } from "../../ipc/types";
import {
  SectionDialog,
  type SectionDialogEntry,
} from "../../design-system/components/SectionDialog";
import { useI18n } from "../../lib/i18n";
import { settingsSearchKeywords, settingsSections, type SettingsScope, type SettingsSection } from "../../features/settings/domain";
import { workspaceAuthStateQuery } from "../../features/workspaces/queries";
import {
  appUpdaterProgress,
  type AppUpdaterSnapshot,
} from "../../features/updater/controller";
import AccountPanel from "../../features/settings/account/AccountPanel";
import ConnectionSettings from "./Connection";
import { Button } from "../../design-system/components/Button";
import { SettingsGroup } from "../../design-system/components/Settings";
import { SettingsList, SettingsRow } from "../../design-system/components/SettingsList";
import { useWorkspaceAdminScope } from "../../features/workspaceAdmin/scope";
import { workspaceAdminSectionsFor } from "../../features/workspaceAdmin/sections";
import { requestWorkspaceAdmin } from "../../features/workspaceAdmin/navigationRequest";
import AdvancedSettings from "./Advanced";
import Appearance from "./Appearance";
import LanguageSettings from "./Language";
import AgentTools from "./AgentTools";
import CliSettings from "./Cli";
import PrivacySettings from "./Privacy";
import Safety from "./Safety";
import Updates from "./Updates";

export default function Settings({
  connection,
  onClose,
  onConnectionUpdated,
  onSafetySaved,
  onOpenAdminConnection,
  onEditConnection,
  onOpenProjectEnvironment,
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
  onEditConnection: (connection: ConnectionProfile) => void;
  onOpenProjectEnvironment: (environmentId: string) => void;
  // Re-loads the App's per-connection safety so Safety edits apply without reselecting.
  refreshSafety: () => void;
  initialSection?: SettingsSection;
  updater: AppUpdaterSnapshot;
  onUpdateRefresh: () => Promise<void>;
  onUpdateInstall: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(
    initialSection ?? "agent-tools",
  );
  const auth = useQuery(workspaceAuthStateQuery());
  const adminScope = useWorkspaceAdminScope();
  const signedIn = Boolean(auth.data?.user);
  // The account section depends on this read; until it settles, a requested
  // section is not yet known to be unavailable.
  const scopeResolved = auth.data !== undefined;
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

  const entries = useMemo(() => {
    const entry = (
      id: SettingsSection,
      label: string,
      group: SettingsScope,
      status: string | null = null,
    ): SectionDialogEntry<SettingsSection, SettingsScope> => ({
      id,
      label,
      group,
      keywords: settingsSearchKeywords[id],
      status,
    });
    return settingsSections
      .filter((section) => !section.needsAccount || signedIn)
      .map((section) => {
        const label = t(section.label);
        if (section.id === "updates") return entry(section.id, label, section.group, updateNavigationStatus);
        if (section.id === "safety") {
          return entry(section.id, `${label}${connection ? ` · ${connection.name || t("app.unnamed")}` : ""}`, section.group);
        }
        return entry(section.id, label, section.group);
      });
  }, [connection, signedIn, t, updateNavigationStatus]);

  useEffect(() => {
    if (!scopeResolved || entries.some((entry) => entry.id === section)) return;
    setSection(entries[0]?.id ?? "agent-tools");
  }, [entries, scopeResolved, section]);

  // Safety may have changed while this menu was open — refresh App's copy on the way out.
  function close() {
    refreshSafety();
    onClose();
  }

  return (
    <SectionDialog
      title={t("common.settings")}
      titleId="settings-dialog-title"
      groups={[
        { id: "application", label: t("settings.scopeApplication") },
        { id: "agents", label: t("settings.scopeAgents") },
        { id: "account", label: t("settings.scopeAccount") },
        { id: "dataSource", label: t("settings.scopeDataSource") },
      ]}
      entries={entries}
      active={section}
      onSelect={setSection}
      onClose={close}
      doneLabel={t("common.done")}
      selectLabel={t("common.settings")}
      search={{
        placeholder: t("settings.searchPlaceholder"),
        clearLabel: t("common.clearSearch"),
        noResults: t("settings.noSearchResults"),
      }}
    >
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
      {section === "account" && signedIn && <>
        {adminScope?.canManage ? <SettingsGroup title={t("workspaceAdmin.manage")}><SettingsList>
          {workspaceAdminSectionsFor(adminScope).map((entry) => <SettingsRow key={entry.id} identity={t(entry.label)} details={adminScope.workspaceName} actions={<Button size="compact" onClick={() => requestWorkspaceAdmin(entry.id)}>{t("settings.openManagement")}</Button>} />)}
        </SettingsList></SettingsGroup> : null}
        <AccountPanel />
      </>}
      {section === "connection" && (connection ? <ConnectionSettings connection={connection} onEdit={onEditConnection} onOpenProject={onOpenProjectEnvironment} /> : <p>{t("settings.selectConnection")}</p>)}
      {section === "language" && <LanguageSettings />}
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
    </SectionDialog>
  );
}
