// Resolves the exact team workspace, signed-in account and role that every
// administration surface is scoped to. Personal workspaces and signed-out states
// have no administration scope; the control plane still authorizes each request.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceAuthState } from "../workspaces/domain";
import {
  workspaceAuthStateQuery,
  workspaceContextQuery,
  type WorkspaceContextState,
} from "../workspaces/queries";
import type { WorkspaceAdminScope } from "./domain";

export function workspaceAdminScope(
  auth: WorkspaceAuthState | undefined,
  context: WorkspaceContextState | undefined,
): WorkspaceAdminScope | null {
  const user = auth?.user;
  const active = context?.active;
  if (!user || !active || active.kind !== "team" || !context?.feature.enabled) {
    return null;
  }
  const membership = auth.accounts
    .find((account) => account.user.id === user.id)
    ?.memberships.find((item) => item.workspaceId === active.id);
  if (!membership) return null;
  return {
    accountId: user.id,
    workspaceId: active.id,
    workspaceName: active.name,
    role: membership.role,
    canManage: membership.role === "admin" || membership.role === "owner",
    isOwner: membership.role === "owner",
  };
}

export function useWorkspaceAdminScope(): WorkspaceAdminScope | null {
  const auth = useQuery(workspaceAuthStateQuery());
  const context = useQuery(workspaceContextQuery());
  return useMemo(
    () => workspaceAdminScope(auth.data, context.data),
    [auth.data, context.data],
  );
}
