// Preloads read-only Agent prerequisites without creating an ACP process or
// choosing a Project resource grant on the user's behalf.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { knowledgeInventoryQuery } from "../knowledge/inventory";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import { listKnowledgeEnvironmentConnections } from "../knowledge/tauriAdapter";
import {
  agentCliDetectionQuery,
  agentPluginStatusQuery,
} from "./queryOptions";
import { acpSessionStore } from "./sessionStore";

const WARM_INVENTORY_STALE_MS = 60_000;

export function useAgentReadinessWarmup(
  catalogScopeKey: string,
  catalogScopeReady: boolean,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    void Promise.all([
      queryClient.prefetchQuery(agentCliDetectionQuery()),
      queryClient.prefetchQuery(agentPluginStatusQuery()),
    ]);
  }, [queryClient]);

  useEffect(() => {
    if (!catalogScopeReady) return;
    acpSessionStore.activate(catalogScopeKey);
    void Promise.all([
      queryClient.prefetchQuery(
        knowledgeInventoryQuery(catalogScopeKey),
      ),
      queryClient.prefetchQuery({
        queryKey: knowledgeQueryKeys.environmentConnections(
          undefined,
          catalogScopeKey,
        ),
        queryFn: () => listKnowledgeEnvironmentConnections(),
        staleTime: WARM_INVENTORY_STALE_MS,
      }),
    ]);
  }, [catalogScopeKey, catalogScopeReady, queryClient]);
}
