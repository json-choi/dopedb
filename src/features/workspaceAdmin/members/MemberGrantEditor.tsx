// The expanded part of a member row: every team connection the administrator manages
// with a none / read / write selector for this member, the provisioning status of a
// direct connection account, and the reason a level is unavailable. Rendering only; a
// change is reported to the members command controller.
import InfoTip from "../../../components/InfoTip";
import { SelectInput } from "../../../design-system/components/FormControls";
import { LoadingLabel, StatusBadge, type StatusTone } from "../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import type { DirectProvisioningState } from "../../directAccess/domain";
import { DIRECT_FAILURE_KEYS, DIRECT_STATE_KEYS } from "../../directAccess/messages";
import type { SharedDatabase } from "../access/domain";
import type { ConnectionCapability } from "../domain";
import {
  capabilityOf,
  grantLevelOf,
  WRITE_BLOCK_KEYS,
  writeBlock,
  type MemberGrantEntry,
  type MemberGrantsRow,
} from "./memberGrants";
import type { WorkspaceMember } from "./domain";

const STATE_TONES: Record<DirectProvisioningState, StatusTone> = {
  not_requested: "neutral",
  requested: "warning",
  applying: "warning",
  ready: "success",
  failed: "danger",
  drop_pending: "neutral",
  dropped: "neutral",
};

function writeLabel(database: SharedDatabase): I18nKey {
  if (database.provisioned) return "workspaceMembers.levelWriteDirect";
  return database.credentialMode === "managed"
    ? "workspaceAccess.capabilityUseManaged"
    : "workspaceAccess.capabilityUseLocal";
}

function DatabaseGrantRow({
  member,
  memberName,
  database,
  entry,
  locked,
  selfLocked,
  pendingNext,
  onChange,
}: {
  member: WorkspaceMember;
  memberName: string;
  database: SharedDatabase;
  entry: MemberGrantEntry | undefined;
  locked: boolean;
  selfLocked: boolean;
  /** The capability being applied to this exact cell, or undefined when idle. */
  pendingNext: ConnectionCapability | null | undefined;
  onChange: (next: ConnectionCapability | null) => void;
}) {
  const { t } = useI18n();
  const current = entry?.capability ?? null;
  const shown = grantLevelOf(pendingNext === undefined ? current : pendingNext);
  const block = writeBlock(database, member.role);
  const offersManage = current === "manage" || member.role === "admin" || member.role === "owner";
  const provisioning = entry?.provisioning ?? null;
  return (
    <li className="tw:grid tw:min-w-0 tw:gap-1 tw:py-2">
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1.5">
        <span className="tw:flex tw:min-w-[140px] tw:flex-1 tw:items-baseline tw:gap-2">
          <strong className="tw:min-w-0 tw:truncate tw:text-ui tw:font-medium" title={database.name}>
            {database.name}
          </strong>
          <span className="tw:shrink-0 tw:font-mono tw:text-2xs tw:uppercase tw:tracking-[0.05em] tw:text-muted-foreground">
            {database.engine}
          </span>
        </span>
        {database.provisioned ? (
          <StatusBadge density="compact">{t("directAccess.badge")}</StatusBadge>
        ) : null}
        {provisioning ? (
          <StatusBadge
            density="compact"
            tone={STATE_TONES[provisioning.state]}
            title={provisioning.failureCode ? t(DIRECT_FAILURE_KEYS[provisioning.failureCode]) : undefined}
          >
            {t(DIRECT_STATE_KEYS[provisioning.state])}
          </StatusBadge>
        ) : null}
        {entry?.origin === "team" ? (
          <StatusBadge density="compact">{t("workspaceAccess.teamOrigin")}</StatusBadge>
        ) : null}
        <span className="tw:w-[220px] tw:max-w-full">
          <SelectInput
            density="compact"
            aria-label={t("workspaceMembers.accessTo", { database: database.name, member: memberName })}
            value={shown}
            disabled={locked || selfLocked}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "none" || value === "read" || value === "write" || value === "manage") {
                onChange(capabilityOf(value));
              }
            }}
          >
            <option value="none">{t("workspaceAccess.capabilityNone")}</option>
            {shown === "view" ? (
              <option value="view" disabled>{t("workspaceAccess.capabilityView")}</option>
            ) : null}
            <option value="read">{t("workspaceAccess.capabilityRead")}</option>
            <option value="write" disabled={block !== null}>{t(writeLabel(database))}</option>
            {offersManage ? (
              <option value="manage">{t("workspaceAccess.capabilityManage")}</option>
            ) : null}
          </SelectInput>
        </span>
        {selfLocked ? <InfoTip label={t("workspaceAccess.ownAccessHint")} /> : null}
        {pendingNext !== undefined ? <LoadingLabel>{t("workspaceAccess.updatingAccess")}</LoadingLabel> : null}
      </div>
      {block ? (
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {t(WRITE_BLOCK_KEYS[block])}
        </p>
      ) : null}
      {provisioning?.failureCode ? (
        <p role="status" className="tw:m-0 tw:text-xs tw:leading-body tw:text-danger">
          {t(DIRECT_FAILURE_KEYS[provisioning.failureCode])}
        </p>
      ) : null}
    </li>
  );
}

export default function MemberGrantEditor({
  member,
  memberName,
  row,
  databases,
  locked,
  self,
  pending,
  onChange,
}: {
  member: WorkspaceMember;
  memberName: string;
  row: MemberGrantsRow | undefined;
  /** The team connections the acting administrator manages. */
  databases: readonly SharedDatabase[];
  /** Another command is running. */
  locked: boolean;
  /** The acting administrator's own row, which the server keeps unchanged. */
  self: boolean;
  /** The grant command running for this member, with the exact cell it targets. */
  pending: { connectionId: string; next: ConnectionCapability | null } | null;
  onChange: (database: SharedDatabase, next: ConnectionCapability | null) => void;
}) {
  const { t } = useI18n();
  if (databases.length === 0) {
    return (
      <p className="tw:m-0 tw:py-2 tw:text-xs tw:text-muted-foreground">
        {t("workspaceMembers.noManagedDatabases")}
      </p>
    );
  }
  return (
    <ul
      aria-label={t("workspaceMembers.databaseAccessFor", { member: memberName })}
      className="tw:m-0 tw:grid tw:list-none tw:divide-y tw:divide-border-subtle tw:border-t tw:border-border-subtle tw:p-0"
    >
      {databases.map((database) => (
        <DatabaseGrantRow
          key={database.id}
          member={member}
          memberName={memberName}
          database={database}
          entry={row?.grants.find((grant) => grant.connectionId === database.id)}
          locked={locked}
          selfLocked={self}
          pendingNext={pending?.connectionId === database.id ? pending.next : undefined}
          onChange={(next) => onChange(database, next)}
        />
      ))}
    </ul>
  );
}
