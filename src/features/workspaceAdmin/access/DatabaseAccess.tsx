// One selected shared database: how members receive credentials, the workspace
// write ceiling (status only), team read access, and the member access list. Grants
// are read for this database alone; every change is handed to the access commands.
import { useQuery } from "@tanstack/react-query";
import InfoTip from "../../../components/InfoTip";
import { Button } from "../../../design-system/components/Button";
import {
  SettingsList,
  SettingsRow,
  SettingsSectionHeader,
} from "../../../design-system/components/SettingsList";
import { StatusBadge } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import type { WorkspaceAdminScope } from "../domain";
import type { WorkspaceAdminPanelProps } from "../navigationRequest";
import type { SharedDatabase } from "./domain";
import MemberGrants from "./MemberGrants";
import { databaseGrantsQuery } from "./queries";
import TeamReadAccess from "./TeamReadAccess";
import type { AccessCommands } from "./useAccessCommands";

export default function DatabaseAccess({
  scope,
  database,
  commands,
  onNavigate,
}: {
  scope: WorkspaceAdminScope;
  database: SharedDatabase;
  commands: AccessCommands;
  onNavigate: WorkspaceAdminPanelProps["onNavigate"];
}) {
  const { t } = useI18n();
  const grantsQuery = useQuery(databaseGrantsQuery(scope, database.id));
  const { busy, notice } = commands;
  const managed = database.credentialMode === "managed";
  const writesEnabled = database.allowWrites && database.writeAvailable;
  const noticeFor = (area: "grants" | "teamRead") =>
    notice?.area === area && notice.connectionId === database.id ? notice.message : null;

  return (
    <div className="tw:grid tw:min-w-0 tw:gap-5">
      <section aria-label={t("workspaceAccess.policyTitle")} className="tw:grid tw:min-w-0">
        <SettingsSectionHeader title={t("workspaceAccess.policyTitle")} />
        <SettingsList>
          <SettingsRow
            identity={<strong className="tw:text-ui tw:font-medium">{t("workspaceAccess.credentials")}</strong>}
            details={
              <StatusBadge>
                {t(managed ? "workspaceAccess.credentialManaged" : "workspaceAccess.credentialLocal")}
              </StatusBadge>
            }
          >
            <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
              {t(managed ? "workspaceAccess.managedDescription" : "workspaceAccess.localDescription")}
            </p>
          </SettingsRow>
          <SettingsRow
            identity={<strong className="tw:text-ui tw:font-medium">{t("workspaceAccess.writeCeiling")}</strong>}
            details={
              <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                <StatusBadge tone={writesEnabled ? "warning" : "neutral"}>
                  {t(writesEnabled ? "workspaceAccess.writesAllowed" : "workspaceAccess.readOnly")}
                </StatusBadge>
                {managed ? null : <InfoTip label={t("workspaceAccess.writeCeilingLocalHint")} />}
              </span>
            }
          >
            {managed && !database.writeAvailable ? (
              <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
                <p className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-xs tw:leading-body tw:text-muted-foreground">
                  {t("workspaceAccess.noWriteIdentity")}
                </p>
                <Button size="compact" variant="ghost" onClick={() => onNavigate("workspace-providers")}>
                  {t("workspaceAccess.openProviders")}
                </Button>
              </div>
            ) : managed ? (
              <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
                {t("workspaceAccess.writeCeilingHint")}
              </p>
            ) : null}
          </SettingsRow>
          {managed ? (
            <TeamReadAccess
              scope={scope}
              snapshot={grantsQuery.data}
              loadFailed={grantsQuery.isError}
              locked={busy !== null}
              saving={busy?.kind === "teamRead" && busy.connectionId === database.id}
              notice={noticeFor("teamRead")}
              onChange={(enabled) => void commands.setTeamRead(database.id, enabled)}
            />
          ) : null}
        </SettingsList>
      </section>
      <MemberGrants
        connectionId={database.id}
        credentialMode={database.credentialMode}
        query={grantsQuery}
        busy={busy}
        notice={noticeFor("grants")}
        onChange={(grant, next) => void commands.changeGrant(database.id, grant, next)}
      />
    </div>
  );
}
