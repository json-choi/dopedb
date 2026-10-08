// Query keys for administration reads. Both roots are outside the shell's
// workspace allowlist, so an account or workspace switch clears them like any
// other private resource.
import type { AccountId } from "../workspaces/domain";
import type { WorkspaceAdminScope } from "./domain";

type KeyPart = string | number | boolean | null;

export function workspaceAdminQueryKey(
  scope: Pick<WorkspaceAdminScope, "accountId" | "workspaceId">,
  area: string,
  ...parts: KeyPart[]
) {
  return ["workspaceAdmin", scope.accountId, scope.workspaceId, area, ...parts] as const;
}

/** Account-level reads (sessions, owned workspaces) that are not tied to one workspace. */
export function accountAdminQueryKey(accountId: AccountId, area: string, ...parts: KeyPart[]) {
  return ["workspaceAccountAdmin", accountId, area, ...parts] as const;
}
