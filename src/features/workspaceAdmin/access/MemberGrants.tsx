// Member access list for one shared database: every active member's access level,
// whether team read access granted it, and the level selector. The acting member's
// own row stays read-only; a change is handed to the panel's access commands.
import type { UseQueryResult } from "@tanstack/react-query";
import InfoTip from "../../../components/InfoTip";
import { Button } from "../../../design-system/components/Button";
import { SelectInput } from "../../../design-system/components/FormControls";
import {
  SettingsList,
  SettingsRow,
  SettingsSectionHeader,
} from "../../../design-system/components/SettingsList";
import {
  InlineNotice,
  LoadingLabel,
  StatusBadge,
} from "../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import { queryResultPhase } from "../../../lib/queryResultPhase";
import type { WorkspaceRole } from "../../workspaces/domain";
import type { ConnectionCapability } from "../domain";
import {
  isConnectionCapability,
  type CredentialMode,
  type GrantSnapshot,
  type MemberGrant,
} from "./domain";
import { accessErrorMessage } from "./errors";
import type { AccessBusy } from "./useAccessCommands";

const ROLE_LABELS: Record<WorkspaceRole, I18nKey> = {
  viewer: "workspaceAdmin.roleViewer",
  analyst: "workspaceAdmin.roleAnalyst",
  editor: "workspaceAdmin.roleEditor",
  admin: "workspaceAdmin.roleAdmin",
  owner: "workspaceAdmin.roleOwner",
};

const LEVELS: readonly ConnectionCapability[] = ["view", "read", "use", "manage"];

const MANAGED_LEVEL_LABELS: Record<ConnectionCapability, I18nKey> = {
  view: "workspaceAccess.capabilityView",
  read: "workspaceAccess.capabilityRead",
  use: "workspaceAccess.capabilityUseManaged",
  manage: "workspaceAccess.capabilityManage",
};

const LOCAL_LEVEL_LABELS: Record<ConnectionCapability, I18nKey> = {
  view: "workspaceAccess.capabilityView",
  read: "workspaceAccess.capabilityRead",
  use: "workspaceAccess.capabilityUseLocal",
  manage: "workspaceAccess.capabilityManage",
};

function isWorkspaceRole(role: string): role is WorkspaceRole {
  return role === "viewer"
    || role === "analyst"
    || role === "editor"
    || role === "admin"
    || role === "owner";
}

function MemberGrantRow({
  grant,
  credentialMode,
  actor,
  pending,
  locked,
  onChange,
}: {
  grant: MemberGrant;
  credentialMode: CredentialMode;
  actor: boolean;
  pending: { next: ConnectionCapability | null } | null;
  locked: boolean;
  onChange: (next: ConnectionCapability | null) => void;
}) {
  const { t } = useI18n();
  const levelLabels = credentialMode === "managed" ? MANAGED_LEVEL_LABELS : LOCAL_LEVEL_LABELS;
  const displayName = grant.name.trim() || grant.email;
  const role = t("workspaceAccess.memberRole", {
    role: isWorkspaceRole(grant.role) ? t(ROLE_LABELS[grant.role]) : grant.role,
  });
  const value = pending ? pending.next ?? "" : grant.capability ?? "";
  return (
    <SettingsRow
      identity={
        <span className="tw:grid tw:min-w-0 tw:gap-0.5">
          <span className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-1">
            <strong className="tw:min-w-0 tw:truncate tw:text-ui tw:font-medium tw:text-foreground">
              {displayName}
            </strong>
            {actor ? (
              <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">
                · {t("workspaceAccess.you")}
              </span>
            ) : null}
          </span>
          <span
            className="tw:truncate tw:text-xs tw:text-muted-foreground"
            title={`${grant.email} · ${role}`}
          >
            {grant.email} · {role}
          </span>
        </span>
      }
      details={
        <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
          <span className="tw:min-w-[180px] tw:max-w-[280px] tw:flex-1">
            <SelectInput
              density="compact"
              aria-label={t("workspaceAccess.memberAccessLabel", { name: displayName })}
              value={value}
              disabled={locked || actor}
              onChange={(event) => {
                const next = event.target.value;
                onChange(isConnectionCapability(next) ? next : null);
              }}
            >
              <option value="">{t("workspaceAccess.capabilityNone")}</option>
              {LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(levelLabels[level])}
                </option>
              ))}
            </SelectInput>
          </span>
          {grant.origin === "team" ? (
            <StatusBadge density="compact">{t("workspaceAccess.teamOrigin")}</StatusBadge>
          ) : null}
          {actor ? <InfoTip label={t("workspaceAccess.ownAccessHint")} /> : null}
          {pending ? <LoadingLabel>{t("workspaceAccess.updatingAccess")}</LoadingLabel> : null}
        </span>
      }
    />
  );
}

export default function MemberGrants({
  connectionId,
  credentialMode,
  query,
  busy,
  notice,
  onChange,
}: {
  connectionId: string;
  credentialMode: CredentialMode;
  query: UseQueryResult<GrantSnapshot>;
  busy: AccessBusy | null;
  notice: string | null;
  onChange: (grant: MemberGrant, next: ConnectionCapability | null) => void;
}) {
  const { lang, t } = useI18n();
  const snapshot = query.data;
  const phase = queryResultPhase(snapshot, query.error);
  const retry = (
    <Button size="compact" disabled={query.isFetching} onClick={() => void query.refetch()}>
      {t("workspaceAdmin.retry")}
    </Button>
  );
  const pendingGrant = busy?.kind === "grant" && busy.connectionId === connectionId ? busy : null;
  const teamGranted = snapshot?.grants.some((grant) => grant.origin === "team") ?? false;

  return (
    <section aria-label={t("workspaceAccess.membersTitle")} className="tw:grid tw:min-w-0">
      <SettingsSectionHeader
        title={t("workspaceAccess.membersTitle")}
        info={<InfoTip label={t("workspaceAccess.roleCeilingHint")} />}
      />
      {teamGranted ? (
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t("workspaceAccess.teamOriginHint")}
        </p>
      ) : null}
      {notice ? (
        <div className="tw:mt-2">
          <InlineNotice tone="danger" icon="alert" role="alert">
            {notice}
          </InlineNotice>
        </div>
      ) : null}
      {phase === "coldLoading" ? (
        <div className="tw:py-2 tw:text-sm">
          <LoadingLabel>{t("workspaceAccess.loadingMembers")}</LoadingLabel>
        </div>
      ) : null}
      {phase === "coldError" ? (
        <div className="tw:mt-2">
          <InlineNotice tone="danger" icon="alert" role="alert" action={retry}>
            {accessErrorMessage(query.error, { lang, t }, "workspaceAccess.loadMembersFailed")}
          </InlineNotice>
        </div>
      ) : null}
      {phase === "staleError" ? (
        <div className="tw:mt-2">
          <InlineNotice tone="warning" icon="alert" role="status" action={retry}>
            {t("workspaceAccess.refreshMembersFailed")}
          </InlineNotice>
        </div>
      ) : null}
      {snapshot && snapshot.grants.length === 0 ? (
        <p className="tw:m-0 tw:py-2 tw:text-sm tw:text-muted-foreground">
          {t("workspaceAccess.noMembers")}
        </p>
      ) : null}
      {snapshot && snapshot.grants.length > 0 ? (
        <SettingsList>
          {snapshot.grants.map((grant) => (
            <MemberGrantRow
              key={grant.memberId}
              grant={grant}
              credentialMode={credentialMode}
              actor={grant.memberId === snapshot.actorMemberId}
              pending={pendingGrant?.memberId === grant.memberId ? pendingGrant : null}
              locked={busy !== null}
              onChange={(next) => onChange(grant, next)}
            />
          ))}
        </SettingsList>
      ) : null}
    </section>
  );
}
