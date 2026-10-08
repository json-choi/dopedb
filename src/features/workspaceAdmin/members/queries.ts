// Members area read. Members and pending invitations arrive in one control-plane
// response, so both lists always describe the same directory snapshot.
import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceAdminScope } from "../domain";
import { workspaceAdminQueryKey } from "../queryKeys";
import { runWorkspaceAdmin } from "../requests";
import { parseMemberDirectory } from "./domain";

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
