// Binds a connection created from a Project environment's launch preset to that
// environment exactly once, after its first save, and refreshes the Project reads
// that list environment connections in the background. A failed binding throws to
// the editor, which reports it and lets the person retry by saving again.
import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { ConnectionProfile } from "../connections/domain";
import type { ConnectionLaunchPreset } from "../connections/presets";
import { bindKnowledgeEnvironmentConnectionWithRefresh } from "../knowledge/bindEnvironmentConnection";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";

export function useLaunchPresetBinding(preset: ConnectionLaunchPreset | null) {
  const queryClient = useQueryClient();
  const completed = useRef(new Set<string>());

  return async function bindSavedConnection(profile: ConnectionProfile) {
    const projectEnvironmentId = preset?.projectEnvironmentId;
    if (!projectEnvironmentId) return;
    const bindingKey = `${projectEnvironmentId}:${profile.id}`;
    if (completed.current.has(bindingKey)) return;
    await bindKnowledgeEnvironmentConnectionWithRefresh({
      projectEnvironmentId,
      connectionId: profile.id,
      role: "primary",
      alias: profile.name.trim() || profile.database.trim() || "database",
    });
    completed.current.add(bindingKey);
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.environmentConnections(),
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.agentEnvironments(),
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.inventory(),
        refetchType: "active",
      }),
    ]).catch(() => undefined);
  };
}
