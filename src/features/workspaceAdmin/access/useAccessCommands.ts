// Owns every Database access change made from the open panel: one command at a
// time, the inline notice a refusal leaves behind, and the cache refresh that shows
// the server's confirmed state afterwards. Components render this state and call
// the commands; none of them writes grant, policy or conflict state directly.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../../components/Toast";
import { useI18n, type I18nKey } from "../../../lib/i18n";
import { useCatalogScope } from "../../../lib/queries";
import { refreshDesktopConnections } from "../desktopConnections";
import type { ConnectionCapability, WorkspaceAdminScope } from "../domain";
import { runWorkspaceAdmin } from "../requests";
import {
  applyCandidateResolution,
  candidateTemplate,
  keepCurrentResolution,
  planGrantChange,
  type ConnectionConflict,
  type MemberGrant,
} from "./domain";
import { accessErrorMessage } from "./errors";
import { AccessResponseError, parseTeamReadResult } from "./parsers";
import {
  accessQueryRoot,
  connectionConflictsQuery,
  databaseGrantsQuery,
} from "./queries";

export type AccessBusy =
  | {
      kind: "grant";
      connectionId: string;
      memberId: string;
      next: ConnectionCapability | null;
    }
  | { kind: "teamRead"; connectionId: string }
  | { kind: "conflict"; conflictId: string; action: "keep" | "apply" };

export type AccessNotice =
  | { area: "grants" | "teamRead"; connectionId: string; message: string }
  | { area: "conflict"; conflictId: string; connectionName: string; message: string };

export type AccessCommands = ReturnType<typeof useAccessCommands>;

export function useAccessCommands(scope: WorkspaceAdminScope) {
  const queryClient = useQueryClient();
  const { lang, t } = useI18n();
  const toast = useToast();
  const catalogScope = useCatalogScope();
  const [busy, setBusy] = useState<AccessBusy | null>(null);
  const [notice, setNotice] = useState<AccessNotice | null>(null);
  const running = useRef(false);

  function begin(next: AccessBusy) {
    if (running.current) return false;
    running.current = true;
    setBusy(next);
    setNotice(null);
    return true;
  }

  async function finish(refresh: Promise<unknown>) {
    await refresh.catch(() => undefined);
    running.current = false;
    setBusy(null);
  }

  function refusal(error: unknown, fallback: I18nKey) {
    return accessErrorMessage(error, { lang, t }, fallback);
  }

  // A refusal may mean the database, its grants or its conflicts moved on, so it
  // re-reads the whole area; a confirmed change refreshes only what it touched.
  const refreshArea = () => queryClient.invalidateQueries({ queryKey: accessQueryRoot(scope) });
  const refreshGrants = (connectionId: string) =>
    queryClient.invalidateQueries({ queryKey: databaseGrantsQuery(scope, connectionId).queryKey });
  const refreshConflicts = () =>
    queryClient.invalidateQueries({ queryKey: connectionConflictsQuery(scope).queryKey });

  async function changeGrant(
    connectionId: string,
    grant: MemberGrant,
    next: ConnectionCapability | null,
  ) {
    const plan = planGrantChange(grant.capability, next);
    if (!plan) return;
    if (!begin({ kind: "grant", connectionId, memberId: grant.memberId, next })) return;
    let removed = false;
    let failed = false;
    try {
      if (plan.remove) {
        await runWorkspaceAdmin(scope.accountId, {
          kind: "removeConnectionAccess",
          workspaceId: scope.workspaceId,
          connectionId,
          memberId: grant.memberId,
        });
        removed = true;
      }
      if (plan.grant) {
        await runWorkspaceAdmin(scope.accountId, {
          kind: "grantConnectionAccess",
          workspaceId: scope.workspaceId,
          connectionId,
          memberId: grant.memberId,
          capability: plan.grant,
        });
      }
    } catch (error) {
      failed = true;
      setNotice({
        area: "grants",
        connectionId,
        message: removed && plan.grant
          ? t("workspaceAccess.grantLowerPartial")
          : refusal(error, "workspaceAccess.grantFailed"),
      });
    } finally {
      await finish(failed ? refreshArea() : refreshGrants(connectionId));
    }
  }

  async function setTeamRead(connectionId: string, enabled: boolean) {
    if (!begin({ kind: "teamRead", connectionId })) return;
    let failed = false;
    try {
      const confirmed = parseTeamReadResult(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "setTeamReadAccess",
          workspaceId: scope.workspaceId,
          connectionId,
          enabled,
        }),
      );
      if (confirmed !== enabled) throw new AccessResponseError("team read access");
    } catch (error) {
      failed = true;
      setNotice({
        area: "teamRead",
        connectionId,
        message: refusal(error, "workspaceAccess.teamReadFailed"),
      });
    } finally {
      await finish(failed ? refreshArea() : refreshGrants(connectionId));
    }
  }

  function conflictNotice(conflict: ConnectionConflict, message: string): AccessNotice {
    return {
      area: "conflict",
      conflictId: conflict.id,
      connectionName: conflict.connectionName,
      message,
    };
  }

  async function keepCurrent(conflict: ConnectionConflict) {
    if (!begin({ kind: "conflict", conflictId: conflict.id, action: "keep" })) return;
    let failed = false;
    try {
      await runWorkspaceAdmin(scope.accountId, {
        kind: "resolveConnectionConflict",
        workspaceId: scope.workspaceId,
        conflictId: conflict.id,
        resolution: keepCurrentResolution(conflict),
      });
      toast(t("workspaceAccess.keptCurrent", { name: conflict.connectionName }));
    } catch (error) {
      failed = true;
      setNotice(conflictNotice(conflict, refusal(error, "workspaceAccess.conflictFailed")));
    } finally {
      await finish(failed ? refreshArea() : refreshConflicts());
    }
  }

  async function applyCandidate(conflict: ConnectionConflict) {
    if (!begin({ kind: "conflict", conflictId: conflict.id, action: "apply" })) return;
    const deletion = conflict.candidate.payload.deleted;
    let templateChanged = false;
    try {
      // The candidate becomes current through the normal guarded mutation path;
      // a current version that already equals it only needs the decision.
      if (!conflict.currentMatchesCandidate) {
        try {
          await runWorkspaceAdmin(
            scope.accountId,
            deletion
              ? {
                  kind: "deleteSharedConnection",
                  workspaceId: scope.workspaceId,
                  connectionId: conflict.connectionId,
                  expectedRevision: conflict.current.revision,
                }
              : {
                  kind: "applyConnectionCandidate",
                  workspaceId: scope.workspaceId,
                  connectionId: conflict.connectionId,
                  expectedRevision: conflict.current.revision,
                  payload: candidateTemplate(conflict.candidate.payload),
                },
          );
          templateChanged = true;
        } catch (error) {
          setNotice(conflictNotice(conflict, refusal(error, "workspaceAccess.applyFailed")));
          return;
        }
      }
      await runWorkspaceAdmin(scope.accountId, {
        kind: "resolveConnectionConflict",
        workspaceId: scope.workspaceId,
        conflictId: conflict.id,
        resolution: applyCandidateResolution(conflict),
      });
      toast(
        t(deletion ? "workspaceAccess.appliedDeletion" : "workspaceAccess.appliedCandidate", {
          name: conflict.connectionName,
        }),
      );
    } catch (error) {
      setNotice(conflictNotice(conflict, refusal(error, "workspaceAccess.conflictFailed")));
    } finally {
      // Applying may rename or remove a database, so the whole area is re-read.
      await finish(refreshArea());
      if (templateChanged) {
        // Best effort and not part of the command: the shared template already
        // changed, and the next workspace refresh converges the Explorer if this
        // pull cannot complete now.
        void refreshDesktopConnections(queryClient, catalogScope.key, [conflict.connectionId])
          .catch(() => undefined);
      }
    }
  }

  return {
    busy,
    notice,
    changeGrant,
    setTeamRead,
    keepCurrent,
    applyCandidate,
  };
}
