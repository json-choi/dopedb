// Account-level administration reads. Keys live under the account root, so an
// account or workspace switch clears them with every other private resource.
import { queryOptions } from "@tanstack/react-query";
import type { AccountId } from "../../workspaces/domain";
import { accountAdminQueryKey } from "../queryKeys";
import { runWorkspaceAdmin } from "../requests";
import { parseAccountSessions, parseDeletionPendingWorkspaces } from "./domain";

export function accountSessionsQueryKey(accountId: AccountId) {
  return accountAdminQueryKey(accountId, "sessions");
}

export function ownedWorkspacesQueryKey(accountId: AccountId) {
  return accountAdminQueryKey(accountId, "workspaces");
}

/** Every unexpired session of the signed-in account, without token material. */
export function accountSessionsQuery(accountId: AccountId) {
  return queryOptions({
    queryKey: accountSessionsQueryKey(accountId),
    queryFn: async () =>
      parseAccountSessions(
        await runWorkspaceAdmin(accountId, { kind: "listAccountSessions" }),
      ),
  });
}

/** Owned workspaces whose deletion is scheduled and may still be cancelled. */
export function deletionPendingWorkspacesQuery(accountId: AccountId) {
  return queryOptions({
    queryKey: ownedWorkspacesQueryKey(accountId),
    queryFn: async () =>
      parseDeletionPendingWorkspaces(
        await runWorkspaceAdmin(accountId, { kind: "listWorkspaces" }),
      ),
  });
}
