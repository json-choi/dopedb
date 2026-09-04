// Read-only query options for local Agent CLI and adapter status.
// These keep the feature's Tauri boundary local while sharing TanStack Query cache entries.
import { queryOptions } from "@tanstack/react-query";

import { agentQueryKeys } from "./queryKeys";
import {
  detectAgentClis,
  listAgentAcpPlugins,
} from "./tauriAdapter";

export function agentPluginStatusQuery() {
  return queryOptions({
    queryKey: agentQueryKeys.pluginStatus(),
    staleTime: 15_000,
    queryFn: listAgentAcpPlugins,
  });
}

// Short staleTime keeps an explicit refresh responsive without re-spawning local CLIs on render.
export function agentCliDetectionQuery() {
  return queryOptions({
    queryKey: agentQueryKeys.cliStatus(),
    staleTime: 15_000,
    queryFn: detectAgentClis,
  });
}
