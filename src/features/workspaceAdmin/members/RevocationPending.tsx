// Revocations waiting for an administrator device: who loses or keeps what on which
// database, the change that was queued and since when. An item can be cancelled (the
// cap on that member's access is lifted) or applied now — through this device's own
// credential, or by entering the credential, using the shared access-lowering flow.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { connectionId as toConnectionId } from "../../connections/domain";
import { useToast } from "../../../components/Toast";
import { Button } from "../../../design-system/components/Button";
import { SettingsList, SettingsRow } from "../../../design-system/components/SettingsList";
import { InlineNotice, LoadingLabel } from "../../../design-system/components/Status";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import { directFailureCodeOf, type DirectRevocationEntry, type DirectRevocationKind } from "../../directAccess/domain";
import { DIRECT_FAILURE_KEYS } from "../../directAccess/messages";
import { directRevocationsQuery, directStatusQuery } from "../../directAccess/queries";
import { cancelDirectRevocation, syncDirectDatabaseNow } from "../../directAccess/tauriAdapter";
import type { AccessLowering } from "../accessLowering/useAccessLowering";
import type { WorkspaceAdminOperation, WorkspaceAdminScope } from "../domain";
import { formatMemberDate } from "./domain";

const KIND_KEYS: Record<DirectRevocationKind, I18nKey> = {
  member_removed: "workspaceMembers.pendingKindRemoved",
  grant_lowered: "workspaceMembers.pendingKindGrant",
  role_lowered: "workspaceMembers.pendingKindRole",
  team_read_off: "workspaceMembers.pendingKindTeamRead",
  db_deleted: "workspaceMembers.pendingKindDeleted",
  self_leave: "workspaceMembers.pendingKindLeft",
  account_deleted: "workspaceMembers.pendingKindAccountDeleted",
};

/** The workspace change an item queued, when the item alone determines it. */
function queuedMutation(
  entry: DirectRevocationEntry,
  workspaceId: WorkspaceAdminScope["workspaceId"],
): WorkspaceAdminOperation | null {
  if (entry.kind === "member_removed") {
    return { kind: "removeMember", workspaceId, memberId: entry.memberId };
  }
  if (entry.kind === "grant_lowered" && entry.targetLevel === "none") {
    return {
      kind: "removeConnectionAccess",
      workspaceId,
      connectionId: entry.connectionId,
      memberId: entry.memberId,
    };
  }
  return null;
}

export default function RevocationPending({
  scope,
  lowering,
  memberName,
  busy,
}: {
  scope: WorkspaceAdminScope;
  lowering: AccessLowering;
  memberName: (memberId: string) => string;
  /** Another members command is running. */
  busy: boolean;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const revocations = useQuery(directRevocationsQuery(scope));
  const [working, setWorking] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const items = (revocations.data ?? []).filter((entry) => entry.state === "pending");
  if (items.length === 0) return null;
  const locked = busy || working !== null || lowering.incomplete !== null;

  // A finished item changes grants, members and the pending list alike.
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["workspaceAdmin", scope.accountId, scope.workspaceId] });

  async function applyNow(entry: DirectRevocationEntry) {
    setWorking(entry.id);
    setFailure(null);
    const connection = {
      accountId: scope.accountId,
      workspaceId: scope.workspaceId,
      connectionId: toConnectionId(entry.connectionId),
    };
    try {
      const status = await queryClient.fetchQuery({ ...directStatusQuery(connection), staleTime: 0 });
      if (status.adminCredentialOnDevice) {
        const report = await syncDirectDatabaseNow(connection);
        if (report.failureCode) {
          setFailure({ id: entry.id, message: t(DIRECT_FAILURE_KEYS[report.failureCode]) });
        } else if (report.skipped) {
          setFailure({ id: entry.id, message: t("workspaceMembers.pendingSkipped") });
        } else {
          toast(t("workspaceMembers.pendingSynced", {
            applied: report.revocationsApplied,
            pending: report.revocationsPending,
          }));
        }
      } else {
        const mutation = queuedMutation(entry, scope.workspaceId);
        if (!mutation) {
          setFailure({ id: entry.id, message: t("workspaceMembers.pendingRepeat") });
        } else {
          await lowering.run({
            kind: entry.kind,
            targetLevel: entry.targetLevel === "read" ? "read" : "none",
            targets: [{ connectionId: connection.connectionId, memberIds: [entry.memberId] }],
            mutation,
          });
        }
      }
    } catch (error) {
      const code = directFailureCodeOf(error);
      setFailure({
        id: entry.id,
        message: t(code ? DIRECT_FAILURE_KEYS[code] : "workspaceMembers.pendingApplyFailed"),
      });
    } finally {
      setWorking(null);
      void refresh();
    }
  }

  async function cancel(entry: DirectRevocationEntry) {
    setWorking(entry.id);
    setFailure(null);
    try {
      await cancelDirectRevocation(scope.accountId, scope.workspaceId, entry.id);
    } catch {
      setFailure({ id: entry.id, message: t("workspaceMembers.pendingCancelFailed") });
    } finally {
      setWorking(null);
      void refresh();
    }
  }

  return (
    <section
      aria-label={t("workspaceMembers.pendingTitle")}
      className="tw:grid tw:min-w-0 tw:content-start tw:gap-2"
    >
      <InlineNotice tone="warning" icon="alert" role="status">
        <strong className="tw:font-semibold">{t("workspaceMembers.pendingTitle")}</strong>
        {" · "}
        {t("workspaceMembers.pendingHint")}
      </InlineNotice>
      <SettingsList>
        {items.map((entry) => (
          <SettingsRow
            key={entry.id}
            identity={
              <strong className="tw:block tw:min-w-0 tw:text-ui tw:[overflow-wrap:anywhere]">
                {memberName(entry.memberId)}
              </strong>
            }
            details={
              <span className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
                <span className="tw:text-ui tw:text-foreground">
                  {lowering.databaseName(entry.connectionId)}
                </span>
                <span>
                  {t(KIND_KEYS[entry.kind])} · {t(entry.targetLevel === "read"
                    ? "workspaceMembers.pendingToRead"
                    : "workspaceMembers.pendingToNone")}
                </span>
                <span>{t("workspaceMembers.pendingSince", { date: formatMemberDate(entry.createdAt, lang, true) })}</span>
              </span>
            }
          >
            <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <Button size="compact" disabled={locked} onClick={() => void applyNow(entry)}>
                {t("workspaceMembers.pendingApply")}
              </Button>
              <Button size="compact" variant="ghost" disabled={locked} onClick={() => void cancel(entry)}>
                {t("common.cancel")}
              </Button>
              {working === entry.id ? (
                <LoadingLabel>{t("workspaceMembers.pendingWorking")}</LoadingLabel>
              ) : null}
              {failure?.id === entry.id ? (
                <span role="alert" className="tw:text-xs tw:text-danger">{failure.message}</span>
              ) : null}
            </div>
          </SettingsRow>
        ))}
      </SettingsList>
    </section>
  );
}
