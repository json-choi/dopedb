// Bridges a navigation-only relation to its full catalog entry, choosing the
// connection-wide or per-database query from whether a database is named. The
// snapshot read waits on the catalog, so the grid never blocks on both at once.
import { useQuery } from "@tanstack/react-query";
import type { Catalog, CatalogTable } from "../../ipc/types";
import {
  catalogQuery,
  catalogSnapshotQuery,
  databaseCatalogQuery,
  databaseCatalogSnapshotQuery,
  useCatalogScope,
} from "../../lib/queries";

/** Upgrades a navigation-only relation when its full catalog entry is available. */
export function resolveCatalogTable(
  catalog: Catalog | undefined,
  requested: CatalogTable,
): CatalogTable {
  return catalog?.tables.find(
    (candidate) =>
      candidate.name === requested.name
      && candidate.database === requested.database
      && candidate.schema === requested.schema
      && candidate.kind === requested.kind
      && (
        !candidate.nativeId
        || !requested.nativeId
        || candidate.nativeId === requested.nativeId
      ),
  ) ?? requested;
}

/** Shares the full-catalog upgrade and delayed snapshot read used by editable SQL tables. */
export function useCatalogTableMetadata(
  connectionId: string,
  requested: CatalogTable,
  enabled = true,
) {
  const scope = useCatalogScope();
  const database = requested.database ?? "";
  const defaultCatalogQuery = useQuery({
    ...catalogQuery(connectionId, scope),
    enabled: enabled && !requested.database && scope.ready,
  });
  const selectedCatalogQuery = useQuery({
    ...databaseCatalogQuery(connectionId, database, scope),
    enabled: enabled && !!requested.database && scope.ready,
  });
  const catalogQueryResult = requested.database
    ? selectedCatalogQuery
    : defaultCatalogQuery;
  const table = resolveCatalogTable(catalogQueryResult.data, requested);
  const defaultSnapshotQuery = useQuery({
    ...catalogSnapshotQuery(
      connectionId,
      catalogQueryResult.data !== undefined,
      scope,
    ),
    enabled:
      enabled
      && !requested.database
      && catalogQueryResult.data !== undefined
      && scope.ready,
  });
  const selectedSnapshotQuery = useQuery({
    ...databaseCatalogSnapshotQuery(
      connectionId,
      database,
      catalogQueryResult.data !== undefined,
      scope,
    ),
    enabled:
      enabled
      && !!requested.database
      && catalogQueryResult.data !== undefined
      && scope.ready,
  });
  const snapshotQuery = requested.database
    ? selectedSnapshotQuery
    : defaultSnapshotQuery;
  return { table, catalogQuery: catalogQueryResult, snapshotQuery };
}
