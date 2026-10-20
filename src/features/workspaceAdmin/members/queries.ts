// Members area reads. Members and pending invitations arrive in one control-plane
// response, so both lists always describe the same directory snapshot; the per-member
// database grants come from the separate member-grants aggregate.
import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceAdminScope } from "../domain";
import { workspaceAdminQueryKey } from "../queryKeys";
import { runWorkspaceAdmin } from "../requests";
import { parseMemberDirectory } from "./domain";
import { parseMemberGrants } from "./memberGrants";

export function memberDirectoryQuery(
  scope: Pick<WorkspaceAdminScope, "accountId" | "workspaceId">,
) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, "memberDirectory"),
    queryFn: async () =>
      parseMemberDirectory(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listMembers",
          workspaceId: scope.workspaceId,
        }),
        scope.workspaceId,
      ),
  });
}

/** Every member's grant on every team connection, with provisioning status. */
export function memberGrantsQuery(
  scope: Pick<WorkspaceAdminScope, "accountId" | "workspaceId">,
) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, "memberGrants"),
    queryFn: async () =>
      parseMemberGrants(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listMemberGrants",
          workspaceId: scope.workspaceId,
        }),
        scope.workspaceId,
      ),
  });
}
