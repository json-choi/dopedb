import { useEffect, useReducer } from "react";
import type { QueryClient } from "@tanstack/react-query";

import type { ConnectionId } from "../connections/domain";
import type { CatalogOverview } from "../../ipc/types";

export interface CachedCatalogOverview {
  connectionId: ConnectionId;
  database: string;
  overview: CatalogOverview;
}

type SearchConnection = Readonly<{
  id: ConnectionId;
  database: string;
}>;

const SEARCHABLE_CATALOG_ROOTS = new Set([
  "catalogOverview",
  "databaseCatalogOverview",
]);

function cachedCatalogOverviews(
  queryClient: QueryClient,
  connections: readonly SearchConnection[],
  scopeKey: string,
): CachedCatalogOverview[] {
  const connectionById = new Map<string, SearchConnection>(
    connections.map((connection) => [connection.id, connection]),
  );
  const indexed = new Map<string, CachedCatalogOverview>();

  for (const [queryKey, overview] of queryClient.getQueriesData<CatalogOverview>(
    { queryKey: ["databaseCatalogOverview"] },
  )) {
    const [, rawConnectionId, rawDatabase, rawScope] = queryKey;
    const connectionId = String(rawConnectionId ?? "");
    const database = String(rawDatabase ?? "");
    const connection = connectionById.get(connectionId);
    if (
      !overview ||
      rawScope !== scopeKey ||
      !connection ||
      !database
    ) {
      continue;
    }
    indexed.set(`${connectionId}\u0000${database}`, {
      connectionId: connection.id,
      database,
      overview,
    });
  }

  // Keep the configured-database overview searchable when another surface has
  // already loaded it. Database-scoped Explorer data wins when both exist.
  for (const [queryKey, overview] of queryClient.getQueriesData<CatalogOverview>(
    { queryKey: ["catalogOverview"] },
  )) {
    const [, rawConnectionId, rawScope] = queryKey;
    const connectionId = String(rawConnectionId ?? "");
    const connection = connectionById.get(connectionId);
    if (!overview || rawScope !== scopeKey || !connection) continue;
    const database = overview.database;
    const key = `${connectionId}\u0000${database}`;
    if (!indexed.has(key)) {
      indexed.set(key, {
        connectionId: connection.id,
        database,
        overview,
      });
    }
  }

  return [...indexed.values()];
}

/**
 * Reads only already-cached Explorer metadata. Opening Action Search never
 * creates a catalog observer or starts live database introspection.
 */
export function useCachedCatalogOverviews(
  queryClient: QueryClient,
  connections: readonly SearchConnection[],
  scopeKey: string,
  enabled: boolean,
) {
  const [, bumpRevision] = useReducer(
    (revision) => revision + 1,
    0,
  );
  useEffect(() => {
    if (!enabled) return;
    return queryClient.getQueryCache().subscribe((event) => {
      const root = String(event.query.queryKey[0] ?? "");
      if (SEARCHABLE_CATALOG_ROOTS.has(root)) bumpRevision();
    });
  }, [enabled, queryClient, scopeKey]);

  return enabled
    ? cachedCatalogOverviews(queryClient, connections, scopeKey)
    : [];
}
