// TanStack reads for Neon branch administration. Keys carry the account, workspace,
// integration generation and the shared-connection digest the server's answer
// depends on, so a reconnect or a database added or moved elsewhere in Settings
// refetches. Every response is validated against that exact integration and project.
import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query";
import type { WorkspaceAdminScope } from "../../domain";
import { workspaceAdminQueryKey } from "../../queryKeys";
import { runWorkspaceAdmin } from "../../requests";
import { requireNeonBranchInventory } from "./branchInventory";
import { requireNeonBranchOperations } from "./branchOperations";
import type { NeonIntegrationRef } from "./domain";

export const neonBranchQueryRoots = {
  inventory: "neonBranches",
  operations: "neonBranchOperations",
} as const;

type AdminScope = Pick<WorkspaceAdminScope, "accountId" | "workspaceId">;

/** Durable plan, approval and execution history of one Neon integration. */
export function neonBranchOperationsQuery(
  scope: AdminScope,
  integration: NeonIntegrationRef,
  references: string,
) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(
      scope,
      neonBranchQueryRoots.operations,
      integration.id,
      integration.generation,
      references,
    ),
    queryFn: async () => requireNeonBranchOperations(
      await runWorkspaceAdmin(scope.accountId, {
        kind: "listNeonBranchOperations",
        workspaceId: scope.workspaceId,
        integrationId: integration.id,
      }),
      { id: integration.id, generation: integration.generation },
    ),
    // A changed reference digest keeps showing the same integration's last answer.
    placeholderData: keepPreviousData,
  });
}

/** Live branch tree of one Neon project with the shared connections pinned to it. */
export function neonBranchInventoryQuery(
  scope: AdminScope,
  integration: NeonIntegrationRef,
  projectId: string,
  references: string,
) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(
      scope,
      neonBranchQueryRoots.inventory,
      integration.id,
      projectId,
      integration.generation,
      references,
    ),
    queryFn: async () => requireNeonBranchInventory(
      await runWorkspaceAdmin(scope.accountId, {
        kind: "listNeonBranches",
        workspaceId: scope.workspaceId,
        integrationId: integration.id,
        projectId,
      }),
      { id: integration.id, generation: integration.generation },
      projectId,
    ),
    placeholderData: keepPreviousData,
  });
}

/**
 * Refetches Neon branch state. Other Settings flows that change Neon access (for
 * example a least-privilege bootstrap) can call this without knowing the key shape.
 */
export function invalidateNeonBranchQueries(
  queryClient: QueryClient,
  scope: AdminScope,
  integrationId?: string,
) {
  const parts = integrationId ? [integrationId] : [];
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: workspaceAdminQueryKey(scope, neonBranchQueryRoots.inventory, ...parts),
    }),
    queryClient.invalidateQueries({
      queryKey: workspaceAdminQueryKey(scope, neonBranchQueryRoots.operations, ...parts),
    }),
  ]);
}
