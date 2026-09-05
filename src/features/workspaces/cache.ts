/**
 * Workspace Query cache ownership.
 *
 * Components and transport adapters never mutate shared workspace state directly.
 * Every authoritative replacement and scope transition passes through this module.
 */

import { notifyManager, type QueryClient } from "@tanstack/react-query";

import {
  cancelWorkspaceResourceQueries,
  resetWorkspaceResourceQueries,
} from "../../lib/queryClient";
import type { WorkspaceAuthState } from "./domain";
import {
  readWorkspaceContext,
  workspaceContextQuery,
  workspaceQueryKeys,
  type WorkspaceContextState,
} from "./queries";
import { workspaceAuthState } from "./tauriAdapter";

export function replaceWorkspaceAuth(
  queryClient: QueryClient,
  state: WorkspaceAuthState,
) {
  queryClient.setQueryData(workspaceQueryKeys.auth(), state);
}

export function replaceWorkspaceContext(
  queryClient: QueryClient,
  state: WorkspaceContextState,
) {
  queryClient.setQueryData(workspaceQueryKeys.context(), state);
}

/** Publish one native authority snapshot without exposing a mixed account/workspace. */
export async function synchronizeWorkspaceScope(queryClient: QueryClient) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: workspaceQueryKeys.auth(), exact: true }),
    queryClient.cancelQueries({ queryKey: workspaceQueryKeys.context(), exact: true }),
  ]);
  const auth = await workspaceAuthState();
  const context = await readWorkspaceContext();
  notifyManager.batch(() => {
    replaceWorkspaceAuth(queryClient, auth);
    replaceWorkspaceContext(queryClient, context);
  });
}

function workspaceAuthorityKey(
  auth: WorkspaceAuthState | undefined,
  context: WorkspaceContextState | undefined,
) {
  if (!auth && !context) return null;
  const activeWorkspace = context?.active;
  const activeUserId = auth?.user?.id;
  const activeRole = activeWorkspace?.kind === "personal"
    ? "personal"
    : auth?.accounts
        .find((account) => account.user.id === activeUserId)
        ?.memberships.find(
          (membership) => membership.workspaceId === activeWorkspace?.id,
        )?.role ?? "missing";
  return [
    activeWorkspace?.kind ?? "unresolved",
    activeWorkspace?.id ?? "unresolved",
    activeUserId ?? "anonymous",
    activeRole,
    auth?.authorityGeneration ?? "unresolved",
  ].join(":");
}

function workspaceResourceQueryScopeKey(
  auth: WorkspaceAuthState | undefined,
  context: WorkspaceContextState | undefined,
) {
  const activeWorkspace = context?.active;
  return [
    activeWorkspace?.kind ?? "unresolved",
    activeWorkspace?.id ?? "unresolved",
    auth?.user?.id ?? "anonymous",
    auth?.authorityGeneration ?? "unresolved",
  ].join(":");
}

/** Detect identity or active membership-role changes before private cache reuse. */
export function workspaceAuthorityChanged(
  previousAuth: WorkspaceAuthState | undefined,
  previousContext: WorkspaceContextState | undefined,
  nextAuth: WorkspaceAuthState,
  nextContext: WorkspaceContextState,
) {
  return workspaceAuthorityKey(previousAuth, previousContext) !==
    workspaceAuthorityKey(nextAuth, nextContext);
}

/** Tell role-only authority changes from transitions that move observers to new keys. */
export function workspaceResourceQueryScopeChanged(
  previousAuth: WorkspaceAuthState | undefined,
  previousContext: WorkspaceContextState | undefined,
  nextAuth: WorkspaceAuthState,
  nextContext: WorkspaceContextState,
) {
  return workspaceResourceQueryScopeKey(previousAuth, previousContext) !==
    workspaceResourceQueryScopeKey(nextAuth, nextContext);
}

export async function invalidateWorkspaceAuth(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.auth() });
}

export async function invalidateWorkspaceContext(
  queryClient: QueryClient,
  refetchType: "active" | "none" = "active",
) {
  await queryClient.invalidateQueries({
    queryKey: workspaceQueryKeys.context(),
    refetchType,
  });
}

export async function invalidateWorkspaceState(queryClient: QueryClient) {
  await Promise.all([
    invalidateWorkspaceAuth(queryClient),
    invalidateWorkspaceContext(queryClient),
  ]);
}

export async function fetchWorkspaceContext(queryClient: QueryClient) {
  return queryClient.fetchQuery(workspaceContextQuery());
}

export async function resetWorkspaceScope(
  queryClient: QueryClient,
  refetchType: "active" | "none" = "active",
) {
  await resetWorkspaceResourceQueries(queryClient);
  await invalidateWorkspaceContext(queryClient, refetchType);
}

/**
 * Cross the native workspace authority boundary without letting old-scope reads
 * finish under the new identity. A failed synchronization also drops anything
 * that may have been fetched after the native mutation committed.
 */
export async function runWorkspaceAuthorityTransition(
  queryClient: QueryClient,
  mutateNativeAuthority: () => Promise<unknown>,
  synchronizeScope: () => Promise<unknown>,
) {
  await cancelWorkspaceResourceQueries(queryClient);
  try {
    await mutateNativeAuthority();
    await resetWorkspaceScope(queryClient, "none");
    await synchronizeScope();
  } catch (error) {
    await resetWorkspaceScope(queryClient, "none");
    await invalidateWorkspaceState(queryClient);
    throw error;
  }
}
