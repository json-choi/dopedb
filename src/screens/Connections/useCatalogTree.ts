// Coordinates per-database catalog reads and exposes their loading and recovery state.
// Full metadata shares the live snapshot entry that tables, SQL and Schema Diff observe.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";

import type {
  Catalog,
  CatalogOverview,
  DatabaseSummary,
} from "../../ipc/types";
import {
  catalogLoadIssue,
  type CatalogLoadIssue,
} from "../../features/catalogExplorer/catalogDomain";
import { persistedCatalogCapturedAt } from "../../features/catalog/tauriAdapter";
import { qk, type CatalogScope } from "../../lib/queries";
import {
  connectionDatabasesQuery,
  databaseCatalogOverviewQuery,
  databaseCatalogQuery,
} from "../../lib/catalogQueries";

export function shouldLoadCatalogDetails(
  scopeReady: boolean,
  overviewReady: boolean,
  explicitlyRequested: boolean,
) {
  return scopeReady && overviewReady && explicitlyRequested;
}

export function databaseCatalogKey(
  connectionId: string,
  database: string,
) {
  return `${connectionId}\u0000${database}`;
}

function isDatabaseTargetName(database: string) {
  return (
    database.length > 0 &&
    new TextEncoder().encode(database).length <= 255 &&
    ![...database].some((character) => /\p{Cc}/u.test(character))
  );
}

type DatabaseTarget = {
  connectionId: string;
  database: string;
  isDefault: boolean;
};

/**
 * Discovers the databases visible through each server connection, then paints one
 * bounded relation tree per database. Full metadata remains opt-in per exact
 * `(connection, database)` target.
 */
export function useCatalogTree(
  connectionIds: string[],
  scope: CatalogScope,
) {
  const queryClient = useQueryClient();
  const [detailTargets, setDetailTargets] = useState<Set<string>>(new Set());
  const [overviewTargets, setOverviewTargets] = useState<Set<string>>(
    new Set(),
  );
  const [suppressedDefaultTargets, setSuppressedDefaultTargets] = useState<
    Set<string>
  >(new Set());
  useEffect(() => {
    setDetailTargets(new Set());
    setOverviewTargets(new Set());
    setSuppressedDefaultTargets(new Set());
  }, [scope.key]);

  // Stable combine callbacks keep the projected records referentially stable until a
  // result changes; inline callbacks would rebuild every record on every render.
  const combineDatabases = useCallback(
    (results: Array<{ data?: DatabaseSummary[]; error: unknown }>) => {
      const databasesByConnection: Record<string, DatabaseSummary[]> = {};
      const databaseErrs: Record<string, CatalogLoadIssue> = {};
      results.forEach((result, index) => {
        const id = connectionIds[index];
        if (result.data) databasesByConnection[id] = result.data;
        // A failed re-read keeps the last list on screen and still reports the failure.
        if (result.error) databaseErrs[id] = catalogLoadIssue(result.error);
      });
      return { databasesByConnection, databaseErrs };
    },
    [connectionIds],
  );
  const { databasesByConnection, databaseErrs } = useQueries({
    queries: connectionIds.map((id) => connectionDatabasesQuery(id, scope)),
    combine: combineDatabases,
  });

  const targets = useMemo(
    () =>
      connectionIds.flatMap((connectionId) =>
        (databasesByConnection[connectionId] ?? []).flatMap((database) =>
          isDatabaseTargetName(database.name)
            ? [{
                connectionId,
                database: database.name,
                isDefault: database.isDefault,
              } satisfies DatabaseTarget]
            : [],
        ),
      ),
    [connectionIds, databasesByConnection],
  );

  const requestDetails = useCallback(
    (connectionId: string, database: string) => {
      const key = databaseCatalogKey(connectionId, database);
      setOverviewTargets((targets) =>
        targets.has(key) ? targets : new Set(targets).add(key),
      );
      setSuppressedDefaultTargets((targets) => {
        if (!targets.has(key)) return targets;
        const next = new Set(targets);
        next.delete(key);
        return next;
      });
      setDetailTargets((targets) =>
        targets.has(key) ? targets : new Set(targets).add(key)
      );
      const snapshotKey = qk.databaseCatalogSnapshot(
        connectionId,
        database,
        scope.key,
      );
      if (queryClient.getQueryState(snapshotKey)?.status === "error") {
        void queryClient.refetchQueries({ queryKey: snapshotKey, exact: true });
      }
    },
    [queryClient, scope.key],
  );

  const requestOverview = useCallback(
    (connectionId: string, database: string) => {
      const key = databaseCatalogKey(connectionId, database);
      setSuppressedDefaultTargets((targets) => {
        if (!targets.has(key)) return targets;
        const next = new Set(targets);
        next.delete(key);
        return next;
      });
      setOverviewTargets((targets) =>
        targets.has(key) ? targets : new Set(targets).add(key),
      );
      if (
        queryClient.getQueryState(
          qk.databaseCatalogOverview(connectionId, database, scope.key),
        )?.status === "error"
      ) {
        void queryClient.refetchQueries({
          queryKey: qk.databaseCatalogOverview(
            connectionId,
            database,
            scope.key,
          ),
          exact: true,
          type: "all",
        });
      }
    },
    [queryClient, scope.key],
  );

  // Collapsing drops only this tree's targets. The database list, overview and live
  // snapshot entries are shared with open tables, the SQL editor and Schema, and a
  // cancel never stops the server-side read: an in-flight read finishes and fills the
  // cache instead. Only scope changes and authority resets cancel catalog reads.
  const forgetOverview = useCallback(
    (connectionId: string, database: string) => {
      const key = databaseCatalogKey(connectionId, database);
      setOverviewTargets((targets) => {
        if (!targets.has(key)) return targets;
        const next = new Set(targets);
        next.delete(key);
        return next;
      });
      setDetailTargets((targets) => {
        if (!targets.has(key)) return targets;
        const next = new Set(targets);
        next.delete(key);
        return next;
      });
      setSuppressedDefaultTargets((targets) =>
        targets.has(key) ? targets : new Set(targets).add(key),
      );
    },
    [],
  );

  const forgetConnection = useCallback(
    (connectionId: string) => {
      const belongsToConnection = (target: string) =>
        target.startsWith(`${connectionId}\u0000`);
      const withoutConnection = (targets: Set<string>) => {
        const next = new Set(
          [...targets].filter((target) => !belongsToConnection(target)),
        );
        return next.size === targets.size ? targets : next;
      };
      setOverviewTargets(withoutConnection);
      setDetailTargets(withoutConnection);
      setSuppressedDefaultTargets(withoutConnection);
    },
    [],
  );

  const combineOverviews = useCallback(
    (results: Array<{ data?: CatalogOverview; error: unknown }>) => {
      const databaseOverviews: Record<string, CatalogOverview> = {};
      const overviewErrsByDatabase: Record<string, CatalogLoadIssue> = {};
      results.forEach((result, index) => {
        const target = targets[index];
        const key = databaseCatalogKey(
          target.connectionId,
          target.database,
        );
        if (result.data) databaseOverviews[key] = result.data;
        // A failed refresh keeps the previous tree visible but is never silent.
        if (result.error) {
          overviewErrsByDatabase[key] = catalogLoadIssue(result.error);
        }
      });
      return { databaseOverviews, overviewErrsByDatabase };
    },
    [targets],
  );
  const { databaseOverviews, overviewErrsByDatabase } = useQueries({
    queries: targets.map((target) => {
      const key = databaseCatalogKey(
        target.connectionId,
        target.database,
      );
      return {
        ...databaseCatalogOverviewQuery(
          target.connectionId,
          target.database,
          scope,
        ),
        enabled:
          scope.ready &&
          ((target.isDefault && !suppressedDefaultTargets.has(key)) ||
            overviewTargets.has(key)),
      };
    }),
    combine: combineOverviews,
  });

  const combineCatalogs = useCallback(
    (results: Array<{ data?: Catalog; error: unknown }>) => {
      const databaseCatalogs: Record<string, Catalog> = {};
      const detailErrsByDatabase: Record<string, CatalogLoadIssue> = {};
      results.forEach((result, index) => {
        const target = targets[index];
        const key = databaseCatalogKey(
          target.connectionId,
          target.database,
        );
        if (result.data) databaseCatalogs[key] = result.data;
        if (result.error) {
          detailErrsByDatabase[key] = catalogLoadIssue(result.error);
        }
      });
      return { databaseCatalogs, detailErrsByDatabase };
    },
    [targets],
  );
  const { databaseCatalogs, detailErrsByDatabase } = useQueries({
    queries: targets.map((target) => {
      const key = databaseCatalogKey(
        target.connectionId,
        target.database,
      );
      return {
        ...databaseCatalogQuery(
          target.connectionId,
          target.database,
          scope,
        ),
        enabled: shouldLoadCatalogDetails(
          scope.ready,
          databaseOverviews[key] !== undefined,
          detailTargets.has(key),
        ),
      };
    }),
    combine: combineCatalogs,
  });

  // Schema comparison remains connection-level and uses the configured database.
  // Secondary databases are independent targets, never accidental schema siblings.
  // Stable references let schema-diff memoization survive unrelated renders.
  const {
    overviews,
    overviewErrs,
    catalogs,
    comparisonCatalogs,
    detailErrs,
  } = useMemo(() => {
    const overviews: Record<string, CatalogOverview> = {};
    const overviewErrs: Record<string, CatalogLoadIssue> = { ...databaseErrs };
    const catalogs: Record<string, Catalog> = {};
    // Schema comparison chips never judge a persisted snapshot shown while revalidating.
    const comparisonCatalogs: Record<string, Catalog> = {};
    const detailErrs: Record<string, CatalogLoadIssue> = {};
    for (const target of targets) {
      if (!target.isDefault) continue;
      const key = databaseCatalogKey(target.connectionId, target.database);
      if (databaseOverviews[key]) {
        overviews[target.connectionId] = databaseOverviews[key];
      }
      if (overviewErrsByDatabase[key]) {
        overviewErrs[target.connectionId] = overviewErrsByDatabase[key];
      }
      if (databaseCatalogs[key]) {
        catalogs[target.connectionId] = databaseCatalogs[key];
        if (persistedCatalogCapturedAt(databaseCatalogs[key]) === null) {
          comparisonCatalogs[target.connectionId] = databaseCatalogs[key];
        }
      }
      if (detailErrsByDatabase[key]) {
        detailErrs[target.connectionId] = detailErrsByDatabase[key];
      }
    }
    return { overviews, overviewErrs, catalogs, comparisonCatalogs, detailErrs };
  }, [
    databaseCatalogs,
    databaseErrs,
    databaseOverviews,
    detailErrsByDatabase,
    overviewErrsByDatabase,
    targets,
  ]);

  return {
    databasesByConnection,
    databaseOverviews,
    overviewErrsByDatabase,
    databaseCatalogs,
    detailErrsByDatabase,
    overviews,
    overviewErrs,
    catalogs,
    comparisonCatalogs,
    detailErrs,
    requestOverview,
    requestDetails,
    forgetOverview,
    forgetConnection,
  };
}
