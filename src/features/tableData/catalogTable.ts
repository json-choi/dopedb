// Loads full catalog metadata for a navigation-only relation reference in the active scope.

import { useQuery } from "@tanstack/react-query";
import type { Catalog, CatalogSnapshot, CatalogTable } from "../../ipc/types";
import {
  catalogFromSnapshot,
  isPersistedSnapshot,
  persistedCatalogCapturedAt,
} from "../catalog/tauriAdapter";
import { useCatalogScope } from "../../lib/queries";
import {
  catalogQuery,
  catalogSnapshotQuery,
  databaseCatalogQuery,
  databaseCatalogSnapshotQuery,
} from "../../lib/catalogQueries";

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

// Row edits are planned from these metadata (primary keys, columns), so a persisted
// snapshot shown while the live read runs never reaches the table surface.
const liveCatalog = (snapshot: CatalogSnapshot) =>
  isPersistedSnapshot(snapshot) ? undefined : catalogFromSnapshot(snapshot);
const liveSnapshot = (snapshot: CatalogSnapshot) =>
  isPersistedSnapshot(snapshot) ? undefined : snapshot;
const liveConfiguredCatalog = (catalog: Catalog) =>
  persistedCatalogCapturedAt(catalog) === null ? catalog : undefined;

/**
 * Upgrades a navigation-only relation from the shared catalog entry. The `Catalog`
 * projection and the raw snapshot observe one cached live read, so opening a table
 * whose database the Explorer already loaded starts no further introspection.
 */
export function useCatalogTableMetadata(
  connectionId: string,
  requested: CatalogTable,
  enabled = true,
) {
  const scope = useCatalogScope();
  const database = requested.database ?? null;
  const selected = enabled && database !== null;
  const configured = enabled && database === null;
  const selectedCatalogQuery = useQuery({
    ...databaseCatalogQuery(connectionId, database ?? "", scope),
    enabled: selected && scope.ready,
    select: liveCatalog,
  });
  const configuredCatalogQuery = useQuery({
    ...catalogQuery(connectionId, scope),
    enabled: configured && scope.ready,
    select: liveConfiguredCatalog,
  });
  const selectedSnapshotQuery = useQuery({
    ...databaseCatalogSnapshotQuery(connectionId, database ?? "", selected, scope),
    select: liveSnapshot,
  });
  const configuredSnapshotQuery = useQuery({
    ...catalogSnapshotQuery(connectionId, configured, scope),
    select: liveSnapshot,
  });
  const catalogQueryResult = database !== null
    ? selectedCatalogQuery
    : configuredCatalogQuery;
  const snapshotQuery = database !== null
    ? selectedSnapshotQuery
    : configuredSnapshotQuery;
  const table = resolveCatalogTable(catalogQueryResult.data, requested);
  return { table, catalogQuery: catalogQueryResult, snapshotQuery };
}
