// The one place that decides how an access-lowering admin change reaches the control
// plane. A change that touches a provisioned (direct connection) database goes through
// `applyDirectRevocation`, which revokes the member accounts on the database before the
// workspace mutation commits; any other change just runs its plain operation. A change
// that cannot finish (this device lacks the administrator credential, a database step
// failed, another device holds the claim) is kept as `incomplete` state that the
// prompt renders, with the credential retry and "leave pending" actions owned here.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { connectionId as toConnectionId } from "../../connections/domain";
import { useToast } from "../../../components/Toast";
import { useI18n } from "../../../lib/i18n";
import {
  directFailureCodeOf,
  type DirectInlineCredential,
  type DirectRevocationKind,
  type DirectRevocationOutcome,
  type DirectRevocationTarget,
} from "../../directAccess/domain";
import { DIRECT_FAILURE_KEYS } from "../../directAccess/messages";
import { invalidateDirectRevocations } from "../../directAccess/queries";
import { applyDirectRevocation } from "../../directAccess/tauriAdapter";
import { sharedDatabasesQuery } from "../access/queries";
import { memberGrantsQuery } from "../members/queries";
import type { WorkspaceAdminOperation, WorkspaceAdminScope } from "../domain";
import { runWorkspaceAdmin } from "../requests";

export interface LoweringChange {
  kind: DirectRevocationKind;
  /**
   * Every database/level/member set the change affects, each revoked to its own target
   * level first; non-provisioned databases are ignored.
   */
  targets: DirectRevocationTarget[];
  /** The change the screen would have sent, committed after the revocation. */
  mutation: WorkspaceAdminOperation;
}

export interface IncompleteLowering {
  change: LoweringChange;
  outcome: DirectRevocationOutcome;
  credentialsOpen: boolean;
  retrying: boolean;
  error: string | null;
}

export type AccessLowering = ReturnType<typeof useAccessLowering>;

export function useAccessLowering(
  scope: WorkspaceAdminScope,
  /** Runs when a retry with a typed credential finishes the change after `run` returned. */
  onDeferredDone?: (change: LoweringChange) => void,
) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const databases = useQuery(sharedDatabasesQuery(scope));
  const [incomplete, setIncomplete] = useState<IncompleteLowering | null>(null);
  // The last revocation could not end already-open sessions (admin account lacks the right).
  const [sessionsMayPersist, setSessionsMayPersist] = useState(false);
  const known = databases.data ?? [];
  const provisioned = new Set(known.filter((database) => database.provisioned).map((d) => d.id));

  function refresh() {
    void invalidateDirectRevocations(queryClient, scope);
    return queryClient.invalidateQueries({
      queryKey: ["workspaceAdmin", scope.accountId, scope.workspaceId],
    });
  }

  function settle(change: LoweringChange, outcome: DirectRevocationOutcome) {
    setSessionsMayPersist(outcome.openSessionsMayPersist);
    if (outcome.mutation === "done") {
      setIncomplete(null);
      return "done" as const;
    }
    setIncomplete({ change, outcome, credentialsOpen: false, retrying: false, error: null });
    void refresh();
    return "incomplete" as const;
  }

  function request(change: LoweringChange, credentials?: DirectInlineCredential[]) {
    return applyDirectRevocation({
      accountId: scope.accountId,
      workspaceId: scope.workspaceId,
      kind: change.kind,
      targets: change.targets,
      mutation: change.mutation,
      ...(credentials ? { credentials } : {}),
    });
  }

  /**
   * Runs the change. Resolves "done" once it is committed, or "incomplete" when it was
   * recorded as pending instead; rejects when a plain operation or the IPC is refused.
   */
  async function run(change: LoweringChange): Promise<"done" | "incomplete"> {
    const targets = change.targets.filter(
      (target) => provisioned.has(target.connectionId) && target.memberIds.length > 0,
    );
    setIncomplete(null);
    setSessionsMayPersist(false);
    if (targets.length === 0) {
      await runWorkspaceAdmin(scope.accountId, change.mutation);
      return "done";
    }
    const scoped = { ...change, targets };
    return settle(scoped, await request(scoped));
  }

  /**
   * Deletes a team connection. A provisioned one first revokes the account of every
   * member who holds a grant on it, all-or-nothing, before the deletion commits.
   */
  async function runDeletion(connectionId: string, mutation: WorkspaceAdminOperation) {
    let targets: DirectRevocationTarget[] = [];
    if (provisioned.has(connectionId)) {
      const rows = await queryClient.fetchQuery({ ...memberGrantsQuery(scope), staleTime: 0 });
      const memberIds = rows
        .filter((row) => row.grants.some((grant) => grant.connectionId === connectionId))
        .map((row) => row.memberId);
      targets = [{ connectionId: toConnectionId(connectionId), targetLevel: "none", memberIds }];
    }
    return run({ kind: "db_deleted", targets, mutation });
  }

  async function submitCredentials(credentials: DirectInlineCredential[]) {
    if (!incomplete) return;
    const { change } = incomplete;
    setIncomplete({ ...incomplete, retrying: true, error: null });
    try {
      const outcome = await request(change, credentials);
      const result = settle(change, outcome);
      void refresh();
      if (result === "done") onDeferredDone?.(change);
    } catch (error) {
      const code = directFailureCodeOf(error);
      setIncomplete((current) =>
        current
          ? {
              ...current,
              retrying: false,
              error: t(code ? DIRECT_FAILURE_KEYS[code] : "directAccess.lowering.retryFailed"),
            }
          : current,
      );
    }
  }

  function setCredentialsOpen(open: boolean) {
    setIncomplete((current) => (current ? { ...current, credentialsOpen: open, error: null } : current));
  }

  function leavePending() {
    setIncomplete(null);
    toast(t("directAccess.lowering.leftPending"));
  }

  return {
    run,
    runDeletion,
    incomplete,
    sessionsMayPersist,
    databaseName: (connectionId: string) =>
      known.find((database) => database.id === connectionId)?.name ?? connectionId,
    submitCredentials,
    openCredentials: () => setCredentialsOpen(true),
    closeCredentials: () => setCredentialsOpen(false),
    leavePending,
    dismiss: () => {
      setIncomplete(null);
      setSessionsMayPersist(false);
    },
  };
}
