// Re-reads every provider projection in this section after a provider account
// change. Desktop's own connection list is pulled by ../../desktopConnections.
import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceAdminScope } from "../../domain";
import { workspaceAdminQueryKey } from "../../queryKeys";
import { gcpSetupsQuery } from "../gcp/queries";
import { providerQueryRoots } from "../queries";

export function invalidateProviderReads(queryClient: QueryClient, scope: WorkspaceAdminScope) {
  return Promise.all([
    ...Object.values(providerQueryRoots).map((root) =>
      queryClient.invalidateQueries({ queryKey: workspaceAdminQueryKey(scope, root) })),
    queryClient.invalidateQueries({ queryKey: gcpSetupsQuery(scope).queryKey }),
  ]);
}
