// Shared provider reads for the Providers section. Account state and the managed
// connection inventory load separately, so an inventory failure never hides which
// provider accounts are connected.
import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceAdminScope } from "../domain";
import { workspaceAdminQueryKey } from "../queryKeys";
import { runWorkspaceAdmin } from "../requests";
import type {
  Integration,
  ManagedConnection,
  Provider,
  SharedConnection,
} from "./domain";

export type ProviderAccessSnapshot = {
  providers: Provider[];
  integrations: Integration[];
  managedConnections: ManagedConnection[] | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseProviderAccessSnapshot(
  value: unknown,
  includeManagedConnections: boolean,
): ProviderAccessSnapshot {
  const body = record(value);
  if (
    !body
    || !Array.isArray(body.providers)
    || !Array.isArray(body.integrations)
    || (includeManagedConnections && !Array.isArray(body.managedConnections))
  ) {
    throw new Error("The workspace service returned an incompatible provider list.");
  }
  return {
    providers: body.providers as Provider[],
    integrations: body.integrations as Integration[],
    managedConnections: includeManagedConnections
      ? body.managedConnections as ManagedConnection[]
      : null,
  };
}

export function parseSharedConnections(value: unknown): SharedConnection[] {
  const body = record(value);
  if (!body || !Array.isArray(body.connections)) {
    throw new Error("The workspace service returned an incompatible database list.");
  }
  return body.connections as SharedConnection[];
}

export const providerQueryRoots = {
  accounts: "providerAccounts",
  inventory: "providerInventory",
  sharedConnections: "sharedConnections",
} as const;

/** Provider catalog and connected accounts only. */
export function providerAccountsQuery(scope: WorkspaceAdminScope) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, providerQueryRoots.accounts),
    queryFn: async () =>
      parseProviderAccessSnapshot(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listProviderIntegrations",
          workspaceId: scope.workspaceId,
          includeManagedConnections: false,
        }),
        false,
      ),
  });
}

/** Accounts plus the managed connection each provider resource backs. */
export function providerInventoryQuery(scope: WorkspaceAdminScope) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, providerQueryRoots.inventory),
    queryFn: async () =>
      parseProviderAccessSnapshot(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listProviderIntegrations",
          workspaceId: scope.workspaceId,
          includeManagedConnections: true,
        }),
        true,
      ),
  });
}

/** Shared database templates visible to the acting member. */
export function sharedConnectionsQuery(scope: WorkspaceAdminScope) {
  return queryOptions({
    queryKey: workspaceAdminQueryKey(scope, providerQueryRoots.sharedConnections),
    queryFn: async () =>
      parseSharedConnections(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listConnections",
          workspaceId: scope.workspaceId,
        }),
      ),
  });
}
