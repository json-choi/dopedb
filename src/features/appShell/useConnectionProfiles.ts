// Loads scoped connection profiles and identifies changes to runtime connection identity.
// The native core derives each profile's effective environment at read time; here it is
// recomputed from the live Project bindings so a bind or revoke is reflected without a reload.

import { useCallback, useMemo, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { ConnectionProfile } from "../connections/domain";
import {
  connectionQueryKeys,
  connectionsQuery,
} from "../connections/queries";
import { errMessage } from "../../ipc/types";
import { effectiveEnvironment } from "../../lib/environmentKind";
import { useConnectionEnvironmentInventory } from "../connections/useConnectionEnvironmentContext";

function runtimeFingerprint(profile: ConnectionProfile): string {
  return JSON.stringify([
    profile.engine,
    profile.provider,
    profile.driverId,
    profile.host,
    profile.port,
    profile.database,
    profile.username,
    profile.sslmode,
    Object.entries(profile.extraParams).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
    profile.readonlyDefault,
    profile.allowWrites,
    profile.secretRef,
    profile.env,
    profile.workspaceAccess,
    profile.credentialMode,
    profile.providerTarget,
  ]);
}

export function changedConnectionRuntimeIds(
  previous: readonly ConnectionProfile[],
  next: readonly ConnectionProfile[],
): string[] {
  const previousById = new Map(
    previous.map((profile) => [profile.id, runtimeFingerprint(profile)]),
  );
  const nextById = new Map(
    next.map((profile) => [profile.id, runtimeFingerprint(profile)]),
  );
  return [...new Set([...previousById.keys(), ...nextById.keys()])]
    .filter((id) => previousById.get(id) !== nextById.get(id));
}

export function useConnectionProfiles(scopeKey: string) {
  const queryClient = useQueryClient();
  const options = connectionsQuery(scopeKey);
  const query = useQuery(options);
  const environments = useConnectionEnvironmentInventory();
  const connections = useMemo(() => {
    // Without a complete binding projection the native value stays authoritative.
    if (!environments.projects || !environments.bindings) return query.data ?? [];
    return (query.data ?? []).map((profile) => {
      const effectiveEnv = effectiveEnvironment(
        profile.env,
        environments.boundKindsByConnectionId.get(profile.id) ?? [],
      );
      return effectiveEnv === profile.effectiveEnv ? profile : { ...profile, effectiveEnv };
    });
  }, [query.data, environments.projects, environments.bindings, environments.boundKindsByConnectionId]);

  const refresh = useCallback(async (): Promise<ConnectionProfile[] | null> => {
    const result = await queryClient.fetchQuery({
      ...connectionsQuery(scopeKey),
      staleTime: 0,
    });
    return result;
  }, [queryClient, scopeKey]);

  return {
    connections,
    setConnections: useCallback(
      (update: SetStateAction<ConnectionProfile[]>) => {
        queryClient.setQueryData(
          connectionQueryKeys.all(scopeKey),
          (current: ConnectionProfile[] = []) =>
            typeof update === "function" ? update(current) : update,
        );
      },
      [queryClient, scopeKey],
    ),
    loaded: !query.isPending,
    loadError: query.error ? errMessage(query.error) : null,
    refresh,
  };
}
