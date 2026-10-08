// Provider resource discovery for the add-database flow. Each level is its own read
// keyed by the exact parent selection, so a level is requested only after the user
// picks the level above it. Lists carry five-minute selection proofs, so cached
// results are reused for at most four minutes and dropped when the flow closes.
import { queryOptions } from "@tanstack/react-query";
import type { ProviderSelectionKey, WorkspaceAdminScope } from "../../domain";
import { workspaceAdminQueryKey } from "../../queryKeys";
import { runWorkspaceAdmin } from "../../requests";
import { PROOF_REUSE_MS, parseProviderResources, type BrowsableLevel } from "./model";

export const PROVIDER_RESOURCES_AREA = "providerResources";

export function providerResourcesQuery(
  scope: WorkspaceAdminScope,
  integrationId: string,
  level: BrowsableLevel | null,
  selection: Partial<Record<ProviderSelectionKey, string>> | null,
  enabled: boolean,
) {
  const parents: string[] = [];
  for (const [key, value] of Object.entries(selection ?? {})) {
    if (typeof value === "string") parents.push(key, value);
  }
  return queryOptions({
    queryKey: workspaceAdminQueryKey(
      scope,
      PROVIDER_RESOURCES_AREA,
      integrationId,
      level?.key ?? null,
      level?.kind ?? null,
      ...parents,
    ),
    queryFn: async () => {
      if (!level || !selection) throw new Error("A provider level and its parent selection are required.");
      return parseProviderResources(
        await runWorkspaceAdmin(scope.accountId, {
          kind: "listProviderResources",
          workspaceId: scope.workspaceId,
          integrationId,
          resourceKind: level.kind,
          selection,
        }),
      );
    },
    enabled: enabled && integrationId !== "" && level !== null && selection !== null,
    staleTime: PROOF_REUSE_MS,
    gcTime: PROOF_REUSE_MS,
  });
}
