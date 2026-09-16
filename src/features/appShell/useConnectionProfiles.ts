// Loads scoped connection profiles and identifies changes to runtime connection identity.

import { useCallback, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { ConnectionProfile } from "../connections/domain";
import {
  connectionQueryKeys,
  connectionsQuery,
} from "../connections/queries";
import { errMessage } from "../../ipc/types";

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

  const refresh = useCallback(async (): Promise<ConnectionProfile[] | null> => {
    const result = await queryClient.fetchQuery({
      ...connectionsQuery(scopeKey),
      staleTime: 0,
    });
    return result;
  }, [queryClient, scopeKey]);

  return {
    connections: query.data ?? [],
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
