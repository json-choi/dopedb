// Catalog reads shared by every Desktop surface: one live snapshot per exact
// (connection, database) and scope, the `Catalog` projection selected from it, a
// persisted snapshot shown only while the first live read runs, and the one refresh
// path used by Explorer refresh, committed DDL and recovery.
import {
  queryOptions,
  replaceEqualDeep,
  type QueryClient,
} from "@tanstack/react-query";

import {
  catalogFromSnapshot,
  getCatalogOverview,
  getDatabaseCatalogOverview,
  getDatabaseCatalogSnapshot,
  getPersistedCatalogSnapshot,
  listConnectionDatabases,
  isPersistedSnapshot,
  markPersistedSnapshot,
  overviewFromSnapshot,
} from "../features/catalog/tauriAdapter";
import {
  readWithCatalogIssue,
  retryCatalogScanIssue,
} from "../features/catalogExplorer/catalogDomain";
import type { ConnectionProfile } from "../features/connections/domain";
import { connectionQueryKeys } from "../features/connections/queries";
import type {
  Catalog,
  CatalogOverview,
  CatalogSnapshot,
  DatabaseSummary,
} from "../ipc/types";
import { qk, readCatalogInScope, type CatalogScope } from "./queries";

// A catalog changes only through a refresh, committed DDL, or a connection edit, all of
// which invalidate these entries explicitly.
const CATALOG_STALE_MS = Infinity;

/**
 * Structural sharing keeps the previous value whenever the next one is deep-equal, so
 * the seed of a snapshot whose live read returns the same capture would keep its
 * identity, and its persisted marker, after that read landed. A seed is always replaced.
 */
function replacePersistedSeed(previous: unknown, next: unknown): unknown {
  return isPersistedSnapshot(previous) ? next : replaceEqualDeep(previous, next);
}

function readLiveSnapshot(
  connectionId: string,
  database: string | null,
  scope?: CatalogScope,
): Promise<CatalogSnapshot> {
  return readWithCatalogIssue(
    () => readCatalogInScope(scope, () =>
      getDatabaseCatalogSnapshot(connectionId, database)
    ),
  );
}

/** The configured database from the loaded profiles; never a stale snapshot guess. */
function configuredDatabase(
  client: QueryClient,
  connectionId: string,
  scopeKey: string | undefined,
): string | undefined {
  if (scopeKey === undefined) return undefined;
  const database = client
    .getQueryData<ConnectionProfile[]>(connectionQueryKeys.all(scopeKey))
    ?.find((profile) => profile.id === connectionId)
    ?.database;
  return database && database.trim().length > 0 ? database : undefined;
}

const persistedReads = new Map<string, Promise<CatalogSnapshot | null>>();

/**
 * Stale-while-revalidate for the configured database. While a first live read is in
 * flight, the persisted snapshot (marked, with its capture time) fills the entries that
 * are still empty. Only in-flight entries are seeded, so the persisted value can never
 * outlive the live read that replaces it, and an entry that already has data keeps it.
 *
 * The seed is a plain state update, not `setQueryData`: a manual success would become
 * the entry's revert point, so cancelling the first read (scope transition, shared
 * connection resync) would commit the persisted snapshot as current data that is never
 * refetched. A state update keeps the pre-fetch revert point, so a cancelled read
 * returns the entry to pending and the next read replaces the seed.
 *
 * A refresh that restarts the first read (`cancelRefetch`) still records the shown seed
 * as the new read's revert point. The seed is therefore invalidated (any observer that
 * mounts re-reads it), and the workspace resume step re-reads an active entry that a
 * revert left holding a seed (`resumePendingWorkspaceResourceQueries`).
 */
async function seedPersistedSnapshot(
  client: QueryClient,
  connectionId: string,
  scope?: CatalogScope,
) {
  const readKey = `${connectionId}\u0000${scope?.key ?? ""}`;
  let read = persistedReads.get(readKey);
  if (!read) {
    read = readCatalogInScope(scope, () => getPersistedCatalogSnapshot(connectionId))
      .catch(() => null)
      .finally(() => persistedReads.delete(readKey));
    persistedReads.set(readKey, read);
  }
  const persisted = await read;
  if (!persisted) return;
  markPersistedSnapshot(persisted);
  const capturedAt = Date.parse(persisted.capturedAt);
  const seed = (key: readonly unknown[], data: () => unknown) => {
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    if (
      !query
      || query.state.data !== undefined
      || query.state.fetchStatus !== "fetching"
    ) {
      return;
    }
    query.setState({
      data: data(),
      dataUpdatedAt: Number.isFinite(capturedAt) ? capturedAt : 0,
      status: "success",
      isInvalidated: true,
    });
  };
  seed(
    qk.databaseCatalogSnapshot(connectionId, persisted.database, scope?.key),
    () => persisted,
  );
  seed(qk.catalogSnapshot(connectionId, scope?.key), () => persisted);
  seed(qk.catalog(connectionId, scope?.key), () => catalogFromSnapshot(persisted));
}

/**
 * Publishes a newer live snapshot to every cached view derived from the same
 * (connection, database): the Explorer relation tree and the connection-only
 * entries of the configured database. Views that were never loaded stay absent.
 */
function publishSnapshot(
  client: QueryClient,
  connectionId: string,
  scopeKey: string | undefined,
  snapshot: CatalogSnapshot,
) {
  const mirrorOverview = (key: readonly unknown[]) => {
    const previous = client.getQueryData<CatalogOverview>(key);
    if (!previous || previous.database !== snapshot.database) return;
    client.setQueryData(key, overviewFromSnapshot(snapshot, previous.namespaces));
  };
  mirrorOverview(
    qk.databaseCatalogOverview(connectionId, snapshot.database, scopeKey),
  );
  mirrorOverview(qk.catalogOverview(connectionId, scopeKey));
  const configuredKey = qk.catalogSnapshot(connectionId, scopeKey);
  const configured = client.getQueryData<CatalogSnapshot>(configuredKey);
  if (
    !configured
    || configured === snapshot
    || configured.database !== snapshot.database
  ) {
    return;
  }
  client.setQueryData(configuredKey, snapshot);
  const catalogKey = qk.catalog(connectionId, scopeKey);
  if (client.getQueryData(catalogKey) !== undefined) {
    client.setQueryData(catalogKey, catalogFromSnapshot(snapshot));
  }
}

/**
 * The one cached catalog source: a live snapshot of one exact (connection,
 * database) in the active scope. Explorer, tables, SQL, Schema and Schema Diff all
 * observe this entry, so a database is introspected once until it is refreshed.
 */
export function databaseCatalogSnapshotQuery(
  connectionId: string,
  database: string,
  enabled = true,
  scope?: CatalogScope,
) {
  return queryOptions({
    queryKey: qk.databaseCatalogSnapshot(
      connectionId,
      database,
      scope?.key,
    ),
    enabled: enabled && (scope?.ready ?? true),
    staleTime: CATALOG_STALE_MS,
    retry: retryCatalogScanIssue,
    structuralSharing: replacePersistedSeed,
    queryFn: async ({ client, queryKey }): Promise<CatalogSnapshot> => {
      const live = readLiveSnapshot(connectionId, database, scope);
      const configured = configuredDatabase(client, connectionId, scope?.key);
      if (
        client.getQueryData(queryKey) === undefined
        && (configured === undefined || configured === database)
      ) {
        void seedPersistedSnapshot(client, connectionId, scope);
      }
      const snapshot = await live;
      publishSnapshot(client, connectionId, scope?.key, snapshot);
      return snapshot;
    },
  });
}

/** The same entry projected to the flat `Catalog` shape (memoized per snapshot). */
export function databaseCatalogQuery(
  connectionId: string,
  database: string,
  scope?: CatalogScope,
) {
  return queryOptions({
    ...databaseCatalogSnapshotQuery(connectionId, database, true, scope),
    select: catalogFromSnapshot,
  });
}

/**
 * Connection-only callers read the configured database through the shared entry.
 * Before profiles load, one live read resolves the configured database and seeds it.
 */
export function catalogSnapshotQuery(
  connectionId: string,
  enabled = true,
  scope?: CatalogScope,
) {
  return queryOptions({
    queryKey: qk.catalogSnapshot(connectionId, scope?.key),
    enabled: enabled && (scope?.ready ?? true),
    staleTime: CATALOG_STALE_MS,
    // The shared snapshot read owns transient retries; never multiply them here.
    retry: false,
    structuralSharing: replacePersistedSeed,
    queryFn: async ({ client, queryKey }): Promise<CatalogSnapshot> => {
      if (client.getQueryData(queryKey) === undefined) {
        void seedPersistedSnapshot(client, connectionId, scope);
      }
      const database = configuredDatabase(client, connectionId, scope?.key);
      if (database !== undefined) {
        const shared = databaseCatalogSnapshotQuery(
          connectionId,
          database,
          true,
          scope,
        );
        const snapshot = await client.fetchQuery(shared);
        // A seed shown while the shared entry revalidates is never committed as this
        // entry's result: wait for that in-flight live read instead.
        return isPersistedSnapshot(snapshot)
          ? client.fetchQuery({ ...shared, staleTime: 0 })
          : snapshot;
      }
      const snapshot = await readLiveSnapshot(connectionId, null, scope);
      const shared = qk.databaseCatalogSnapshot(
        connectionId,
        snapshot.database,
        scope?.key,
      );
      if (client.getQueryData(shared) === undefined) {
        client.setQueryData(shared, snapshot);
      }
      return snapshot;
    },
  });
}

/** `Catalog` for connection-only callers, including imperative `fetchQuery` users. */
export function catalogQuery(connectionId: string, scope?: CatalogScope) {
  return queryOptions({
    queryKey: qk.catalog(connectionId, scope?.key),
    enabled: scope?.ready ?? true,
    staleTime: CATALOG_STALE_MS,
    retry: false,
    queryFn: async ({ client }): Promise<Catalog> => {
      const configured = catalogSnapshotQuery(connectionId, true, scope);
      const snapshot = await client.fetchQuery(configured);
      return catalogFromSnapshot(
        isPersistedSnapshot(snapshot)
          ? await client.fetchQuery({ ...configured, staleTime: 0 })
          : snapshot,
      );
    },
  });
}

export function catalogOverviewQuery(connectionId: string, scope?: CatalogScope) {
  return queryOptions({
    queryKey: qk.catalogOverview(connectionId, scope?.key),
    enabled: scope?.ready ?? true,
    staleTime: CATALOG_STALE_MS,
    retry: retryCatalogScanIssue,
    queryFn: (): Promise<CatalogOverview> =>
      readWithCatalogIssue(
        () => readCatalogInScope(scope, () => getCatalogOverview(connectionId)),
      ),
  });
}

export function connectionDatabasesQuery(
  connectionId: string,
  scope?: CatalogScope,
) {
  return queryOptions({
    queryKey: qk.connectionDatabases(connectionId, scope?.key),
    enabled: scope?.ready ?? true,
    staleTime: CATALOG_STALE_MS,
    retry: retryCatalogScanIssue,
    queryFn: (): Promise<DatabaseSummary[]> =>
      readWithCatalogIssue(
        () => readCatalogInScope(scope, () => listConnectionDatabases(connectionId)),
      ),
  });
}

export function databaseCatalogOverviewQuery(
  connectionId: string,
  database: string,
  scope?: CatalogScope,
) {
  return queryOptions({
    queryKey: qk.databaseCatalogOverview(
      connectionId,
      database,
      scope?.key,
    ),
    enabled: scope?.ready ?? true,
    staleTime: CATALOG_STALE_MS,
    retry: retryCatalogScanIssue,
    queryFn: () => readWithCatalogIssue(
      () => readCatalogInScope(scope, () =>
        getDatabaseCatalogOverview(connectionId, database)
      ),
    ),
  });
}

// Read after the live snapshots: derived projections, the bounded relation trees,
// database discovery and relation DDL all describe the same refreshed schema.
const CATALOG_DEPENDENT_ROOTS = [
  "catalogSnapshot",
  "catalog",
  "catalogOverview",
  "connectionDatabases",
  "databaseCatalogOverview",
  "tableDdl",
] as const;

/**
 * The one catalog refresh path (Explorer refresh, committed DDL, recovery). Each
 * active live snapshot of the connection introspects exactly once, then every
 * dependent catalog root follows it. `null` resynchronizes every connection.
 */
export async function refreshConnectionCatalog(
  queryClient: QueryClient,
  connectionId: string | null,
  options: { throwOnError?: boolean } = {},
) {
  const filter = (root: string) => ({
    queryKey: connectionId === null ? [root] : [root, connectionId],
    refetchType: "active" as const,
  });
  const refetch = { throwOnError: options.throwOnError ?? false };
  let failure: unknown;
  try {
    await queryClient.invalidateQueries(
      filter("databaseCatalogSnapshot"),
      refetch,
    );
  } catch (error) {
    failure = error;
  }
  const dependents = await Promise.allSettled(
    CATALOG_DEPENDENT_ROOTS.map((root) =>
      queryClient.invalidateQueries(filter(root), refetch),
    ),
  );
  failure ??= dependents.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )?.reason;
  if (failure !== undefined) throw failure;
}
