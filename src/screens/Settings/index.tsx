// Settings shell for application preferences, the signed-in account, and
// per-connection safety. Workspace administration lives in the separate Workspace
// management dialog, so this dialog stays about this app and its data sources.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConnectionProfile } from "../../features/connections/domain";
import type { SafetySettings } from "../../ipc/types";
import {
  Field,
  SelectInput,
} from "../../design-system/components/FormControls";
import {
  SectionDialog,
  type SectionDialogEntry,
} from "../../design-system/components/SectionDialog";
import { useI18n } from "../../lib/i18n";
import { settingsSearchKeywords, type SettingsSection } from "../../features/settings/domain";
import { workspaceAuthStateQuery } from "../../features/workspaces/queries";
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

type SettingsScope = "application" | "dataSource";

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
  const auth = useQuery(workspaceAuthStateQuery());
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
    return [
      entry("agent-tools", t("settings.agentTools"), "application"),
      entry("advanced", t("settings.advanced"), "application"),
      entry("cli", t("settings.cli"), "application"),
      entry("appearance", t("settings.appearance"), "application"),
      entry("language", t("settings.languageTitle"), "application"),
      entry("privacy", t("settings.privacy"), "application"),
      entry("updates", t("settings.updates"), "application", updateNavigationStatus),
      ...(signedIn ? [entry("account", t("workspaceAdmin.account"), "application")] : []),
      entry(
        "safety",
        `${t("settings.safety")}${connection ? ` · ${connection.name || t("app.unnamed")}` : ""}`,
        "dataSource",
      ),
    ];
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
      {section === "account" && signedIn && <AccountSettings />}
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
    </SectionDialog>
  );
}
