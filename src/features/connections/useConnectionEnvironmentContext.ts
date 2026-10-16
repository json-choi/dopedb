// Shares the authoritative Project environment projection between connection
// properties and Settings. A standalone profile label never overrides a binding.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCatalogScope } from "../../lib/queries";
import { knowledgeInventoryQuery } from "../knowledge/inventory";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import { listKnowledgeEnvironmentConnections } from "../knowledge/tauriAdapter";
import { knowledgeEnvironmentBadge } from "../knowledge/presentation";

export function useConnectionEnvironmentInventory() {
  const scope = useCatalogScope();
  const enabled = scope.ready && (scope.workspaceKind === "personal" || scope.accountScope !== null);
  const inventory = useQuery(knowledgeInventoryQuery(scope.key, enabled));
  const bindings = useQuery({
    queryKey: knowledgeQueryKeys.environmentConnections(undefined, scope.key),
    queryFn: () => listKnowledgeEnvironmentConnections(),
    staleTime: 60_000,
    enabled,
  });
  const markersByConnectionId = useMemo(() => {
    const environments = new Map(inventory.data?.projects.flatMap((project) => project.environments.map((environment) => [environment.id, environment] as const)));
    const markers = new Map<string, Set<string>>();
    for (const binding of bindings.data ?? []) {
      if (!binding.connectionId) continue;
      const environment = environments.get(binding.projectEnvironmentId);
      const current = markers.get(binding.connectionId) ?? new Set<string>();
      if (environment) current.add(knowledgeEnvironmentBadge(environment.riskClass));
      markers.set(binding.connectionId, current);
    }
    return new Map(Array.from(markers, ([id, values]) => [id, Array.from(values).sort().join(" / ") || null]));
  }, [inventory.data, bindings.data]);
  return {
    projects: inventory.data?.projects,
    bindings: bindings.data,
    markersByConnectionId,
    pending: enabled && (inventory.isPending || bindings.isPending),
    error: inventory.error ?? bindings.error,
  };
}

export function useConnectionEnvironmentContext(connectionId: string, presetEnvironmentId?: string) {
  const inventory = useConnectionEnvironmentInventory();
  const bindings = inventory.bindings?.filter((candidate) => candidate.connectionId === connectionId) ?? [];
  const environmentId = presetEnvironmentId ?? (bindings.length === 1 ? bindings[0]?.projectEnvironmentId : undefined);
  const project = inventory.projects?.find((candidate) => candidate.environments.some((environment) => environment.id === environmentId));
  const environment = project?.environments.find((candidate) => candidate.id === environmentId);
  return {
    project,
    environment,
    bound: Boolean(environmentId) || bindings.length > 0,
    marker: environment ? knowledgeEnvironmentBadge(environment.riskClass) : inventory.markersByConnectionId.get(connectionId) ?? null,
    pending: inventory.pending,
    error: inventory.error,
  };
}
