// Query-key factory and shared query options for every cached backend read. Screens
// consume these via useQuery/useQueries so one fetch per (resource, connection) is shared
// app-wide: re-entering a tab repaints from cache and revalidates in the background.
// Invalidation lives in queryClient.tsx; nothing here fetches on its own.
import { useEffect, useState } from "react";
import {
  queryOptions,
  type QueryClient,
  useQuery,
} from "@tanstack/react-query";
import {
  auditVerify,
  getAuditEntry,
  getHistoryEntry,
  listAuditPage,
  listHistoryPage,
} from "../features/activity/tauriAdapter";
import {
  getCatalog,
  getDatabaseCatalog,
  getDatabaseCatalogOverview,
  getDatabaseCatalogSnapshot,
  getCatalogOverview,
  getCatalogSnapshot,
  listConnectionDatabases,
  refreshCatalog,
} from "../features/catalog/tauriAdapter";
import { runDocumentRead } from "../features/documentQueries/tauriAdapter";
import { getMonitoringStatus } from "../features/monitoring/tauriAdapter";
import {
  cliInstallationStatus,
  skillStatus,
} from "../features/skills/tauriAdapter";
import type {
  Catalog,
  CatalogOverview,
  CatalogTable,
  DatabaseSummary,
  Engine,
  HistoryPageRequest,
  QueryResult,
} from "../ipc/types";
import { errMessage } from "../ipc/types";
import { listDrivers } from "../features/connections/tauriAdapter";
import { connectionId as asConnectionId } from "../features/connections/domain";
import { listErdLayouts } from "../features/erd/tauriAdapter";
import { jobConnectionId } from "../features/jobs/domain";
import { listJobs } from "../features/jobs/tauriAdapter";
import { runSqlReadPage } from "../features/queries/tauriAdapter";
import {
  workspaceAuthStateQuery,
  workspaceContextQuery,
} from "../features/workspaces/queries";
import { buildCountQuery, buildPageQuery, type GridSort } from "./sqlBuild";
import { tableKey } from "./tableRef";

const CATALOG_STALE_MS = Infinity;
// Avoid redundant log and row refetches while users switch tabs quickly.
const LOG_STALE_MS = 10_000;
const LOG_GC_MS = 60_000;
export type CatalogScope = {
  key: string;
  ready: boolean;
  workspaceId: string | null;
  accountScope: string | null;
  workspaceKind: "personal" | "team" | null;
  error?: unknown;
  recover?: () => Promise<void>;
};

export function sharedWorkspaceScopeAvailable(
  scope: Pick<CatalogScope, "accountScope" | "workspaceKind">,
): boolean {
  return scope.workspaceKind === "team" && scope.accountScope !== null;
}

/** Surface and recover cold scope failures instead of disabling catalog reads forever. */
export async function readCatalogInScope<T>(
  scope: CatalogScope | undefined,
  read: () => Promise<T>,
): Promise<T> {
  if (scope?.error !== undefined) {
    await scope.recover?.();
    throw scope.error;
  }
  return read();
}

/** Gives catalog reads a settled workspace/account generation without auth-refresh flicker. */
export function useCatalogScope(): CatalogScope {
  const context = useQuery(workspaceContextQuery());
  const auth = useQuery(workspaceAuthStateQuery());
  const workspace = context.data?.active;
  // Even a personal workspace can be used while signed in. Include the concrete
  // account generation so logging out or changing accounts cannot reuse catalog or
  // Knowledge data retained by a previous identity.
  const accountId = auth.data?.user?.id ?? "anonymous";
  const authorityGeneration = auth.data?.authorityGeneration ?? "unresolved";
  const key = workspace
    ? `workspace:${workspace.kind}:${workspace.id}:account:${accountId}:authority:${authorityGeneration}`
    : "workspace:unresolved";
  // Hold one committed render across a scope replacement before enabling new reads.
  const [settledKey, setSettledKey] = useState(key);
  useEffect(() => {
    setSettledKey(key);
  }, [key]);
  // Background errors with cached data must not hide a valid catalog.
  const error = context.data === undefined
    ? context.error ?? undefined
    : auth.data === undefined
      ? auth.error ?? undefined
      : undefined;
  const prerequisiteReady = !!workspace && auth.data !== undefined;
  return {
    key,
    ready: settledKey === key && (prerequisiteReady || error !== undefined),
    workspaceId: workspace?.id ?? null,
    // The cache key still follows login changes, but local resources have no
    // team account owner. Never send a selected account as their storage scope.
    accountScope: workspace?.kind === "team" ? auth.data?.user?.id ?? null : null,
    workspaceKind: workspace?.kind ?? null,
    error,
    recover: error === undefined
      ? undefined
      : async () => {
        const refreshed = context.data === undefined ? await context.refetch() : undefined;
        const active = context.data?.active ?? refreshed?.data?.active;
        if (active && auth.data === undefined) {
          await auth.refetch();
        }
      },
  };
}

const TRANSIENT_ERROR = /connection (refused|reset|closed|aborted)|could not connect|unreachable|broken pipe|network|io error/i;

export function isTransientDbError(e: unknown): boolean {
  return TRANSIENT_ERROR.test(errMessage(e));
}

// Read-only network queries retry; runSql queries never do because they write history.
const transientRetry = {
  retry: (failureCount: number, error: unknown) =>
    failureCount < 3 && isTransientDbError(error),
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8_000),
} as const;

export type TableRowsPage = { result: QueryResult; hasMore: boolean };

export type DocumentRowsArgs = {
  connectionId: string;
  collection: string;
  pageSize: number;
  page: number;
};

export type TableRowsArgs = {
  connectionId: string;
  engine: Engine;
  table: CatalogTable;
  filters: Record<string, string>;
  whereExpression: string;
  orderByExpression: string;
  sort: GridSort | null;
  pageSize: number;
  page: number;
};

export type TableCountArgs = Pick<
  TableRowsArgs,
  "connectionId" | "engine" | "table" | "filters" | "whereExpression"
>;

// Every key starts with a resource segment plus the connection id, so a connection-scoped
// invalidation is a prefix match and never has to enumerate sub-resources.
export const qk = {
  // Keep connection id before scope so existing per-connection invalidation is a
  // prefix match, while a scope transition can never consume an old result.
  catalog: (connectionId: string, scope?: string) =>
    scope === undefined
      ? (["catalog", connectionId] as const)
      : (["catalog", connectionId, scope] as const),
  catalogOverview: (connectionId: string, scope?: string) =>
    scope === undefined
      ? (["catalogOverview", connectionId] as const)
      : (["catalogOverview", connectionId, scope] as const),
  connectionDatabases: (connectionId: string, scope?: string) =>
    scope === undefined
      ? (["connectionDatabases", connectionId] as const)
      : (["connectionDatabases", connectionId, scope] as const),
  databaseCatalog: (
    connectionId: string,
    database: string,
    scope?: string,
  ) =>
    scope === undefined
      ? (["databaseCatalog", connectionId, database] as const)
      : (["databaseCatalog", connectionId, database, scope] as const),
  databaseCatalogOverview: (
    connectionId: string,
    database: string,
    scope?: string,
  ) =>
    scope === undefined
      ? (["databaseCatalogOverview", connectionId, database] as const)
      : (["databaseCatalogOverview", connectionId, database, scope] as const),
  databaseCatalogSnapshot: (
    connectionId: string,
    database: string,
    scope?: string,
  ) =>
    scope === undefined
      ? (["databaseCatalogSnapshot", connectionId, database] as const)
      : (["databaseCatalogSnapshot", connectionId, database, scope] as const),
  catalogSnapshot: (connectionId: string, scope?: string) =>
    scope === undefined
      ? (["catalogSnapshot", connectionId] as const)
      : (["catalogSnapshot", connectionId, scope] as const),
  history: (connectionId: string, request?: Omit<HistoryPageRequest, "connectionId">) =>
    request === undefined
      ? (["history", connectionId] as const)
      : (["history", connectionId, request] as const),
  historyEntry: (connectionId: string, historyId: string) =>
    ["history", connectionId, "entry", historyId] as const,
  audit: (connectionId: string) => ["audit", connectionId] as const,
  auditVerdict: (connectionId: string) => ["audit", connectionId, "verdict"] as const,
  auditPage: (connectionId: string, cursor: { rowId: number } | null) =>
    ["audit", connectionId, "page", cursor] as const,
  auditEntry: (connectionId: string, entryId: string) =>
    ["audit", connectionId, "entry", entryId] as const,
  monitoring: (connectionId: string) => ["monitoring", connectionId] as const,
  manualTransaction: (connectionId: string) =>
    ["manualTransaction", connectionId] as const,
  manualTransactions: () => ["manualTransactions"] as const,
  drivers: () => ["drivers"] as const,
  cliInstallation: () => ["cliInstallation"] as const,
  skillStatus: () => ["skillStatus"] as const,
  tableRows: (args: TableRowsArgs) =>
    [
      "tableRows",
      args.connectionId,
      tableKey(args.table),
      {
        filters: args.filters,
        whereExpression: args.whereExpression,
        orderByExpression: args.orderByExpression,
        sort: args.sort,
        pageSize: args.pageSize,
        page: args.page,
      },
    ] as const,
  tableCount: (args: TableCountArgs) =>
    [
      "tableCount",
      args.connectionId,
      tableKey(args.table),
      { filters: args.filters, whereExpression: args.whereExpression },
    ] as const,
  documentRows: (args: DocumentRowsArgs) =>
    [
      "documentRows",
      args.connectionId,
      args.collection,
      { pageSize: args.pageSize, page: args.page },
    ] as const,
  documentCount: (connectionId: string, collection: string) =>
    ["documentCount", connectionId, collection] as const,
  erdLayouts: (connectionId: string) =>
    ["erdLayouts", connectionId] as const,
  jobs: (connectionId: string) => ["jobs", connectionId] as const,
};

export function driversQuery() {
  return queryOptions({
    queryKey: qk.drivers(),
    staleTime: Infinity,
    queryFn: listDrivers,
  });
}

export function cliInstallationStatusQuery() {
  return queryOptions({
    queryKey: qk.cliInstallation(),
    staleTime: 30_000,
    retry: false,
    queryFn: cliInstallationStatus,
  });
}

export function skillStatusQuery(enabled = true) {
  return queryOptions({
    queryKey: qk.skillStatus(),
    staleTime: 30_000,
    gcTime: Infinity,
    retry: false,
    enabled,
    refetchOnWindowFocus: true,
    // External edits and CLI-managed updates must reach both the startup gate
    // and Settings without requiring a focus round trip. TanStack suspends this
    // bounded check while the document is hidden and tears it down with the
    // final observer.
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
    queryFn: () => skillStatus("all"),
  });
}

export function catalogQuery(connectionId: string, scope?: CatalogScope) {
  return queryOptions({
    queryKey: qk.catalog(connectionId, scope?.key),
    enabled: scope?.ready ?? true,
    staleTime: CATALOG_STALE_MS,
    retry: false,
    queryFn: () => readCatalogInScope(scope, () => getCatalog(connectionId)),
  });
}

export function catalogOverviewQuery(connectionId: string, scope?: CatalogScope) {
  return queryOptions({
    queryKey: qk.catalogOverview(connectionId, scope?.key),
    enabled: scope?.ready ?? true,
    staleTime: CATALOG_STALE_MS,
    retry: false,
    queryFn: (): Promise<CatalogOverview> =>
      readCatalogInScope(scope, () => getCatalogOverview(connectionId)),
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
    retry: false,
    queryFn: (): Promise<DatabaseSummary[]> =>
      readCatalogInScope(scope, () => listConnectionDatabases(connectionId)),
  });
}

export function databaseCatalogQuery(
  connectionId: string,
  database: string,
  scope?: CatalogScope,
) {
  return queryOptions({
    queryKey: qk.databaseCatalog(connectionId, database, scope?.key),
    enabled: scope?.ready ?? true,
    staleTime: CATALOG_STALE_MS,
    retry: false,
    queryFn: () =>
      readCatalogInScope(scope, () =>
        getDatabaseCatalog(connectionId, database)
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
    retry: false,
    queryFn: () =>
      readCatalogInScope(scope, () =>
        getDatabaseCatalogOverview(connectionId, database)
      ),
  });
}

export function catalogSnapshotQuery(
  connectionId: string,
  enabled = true,
  scope?: CatalogScope,
) {
  return queryOptions({
    queryKey: qk.catalogSnapshot(connectionId, scope?.key),
    enabled: enabled && (scope?.ready ?? true),
    staleTime: CATALOG_STALE_MS,
    retry: false,
    queryFn: () => readCatalogInScope(scope, () => getCatalogSnapshot(connectionId)),
  });
}

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
    retry: false,
    queryFn: () =>
      readCatalogInScope(scope, () =>
        getDatabaseCatalogSnapshot(connectionId, database)
      ),
  });
}

export function erdLayoutsQuery(connectionId: string) {
  return queryOptions({
    queryKey: qk.erdLayouts(connectionId),
    staleTime: Infinity,
    queryFn: () => listErdLayouts(asConnectionId(connectionId)),
  });
}

export function jobsQuery(connectionId: string) {
  return queryOptions({
    queryKey: qk.jobs(connectionId),
    staleTime: Infinity,
    queryFn: () => listJobs(jobConnectionId(connectionId)),
  });
}

// Force a live re-introspection. The caller writes the result into qk.catalog(id) so every
// surface reading the catalog updates at once; a CATALOG_STALE_MS of Infinity means this
// is the only way a stale table list gets corrected.
export function fetchFreshCatalog(connectionId: string) {
  return refreshCatalog(connectionId);
}

/** Promotes a manual refresh and retires derived overview/snapshot metadata together. */
export async function replaceFreshCatalog(
  queryClient: QueryClient,
  connectionId: string,
  scopeKey: string,
  catalog: Catalog,
) {
  queryClient.setQueryData(qk.catalog(connectionId, scopeKey), catalog);
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: qk.catalogOverview(connectionId, scopeKey),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: qk.catalogSnapshot(connectionId, scopeKey),
      refetchType: "active",
    }),
  ]);
}

export function historyQuery(request: HistoryPageRequest) {
  const { connectionId, ...scope } = request;
  return queryOptions({
    queryKey: qk.history(connectionId, scope),
    staleTime: LOG_STALE_MS,
    gcTime: LOG_GC_MS,
    queryFn: () => listHistoryPage(request),
  });
}

export function historyEntryQuery(
  connectionId: string,
  historyId: string | null,
) {
  return queryOptions({
    queryKey: qk.historyEntry(connectionId, historyId ?? ""),
    enabled: historyId !== null,
    staleTime: Infinity,
    gcTime: LOG_GC_MS,
    queryFn: () => getHistoryEntry(connectionId, historyId ?? ""),
  });
}

export function monitoringStatusQuery(connectionId: string) {
  return queryOptions({
    queryKey: qk.monitoring(connectionId),
    staleTime: LOG_STALE_MS,
    ...transientRetry,
    queryFn: () => getMonitoringStatus(connectionId),
  });
}

// Verification alone backs the collapsed Activity banner. The bounded metadata page
// stays disabled until the disclosure opens, and exact bodies remain per-row reads.
export function auditVerdictQuery(connectionId: string) {
  return queryOptions({
    queryKey: qk.auditVerdict(connectionId),
    staleTime: LOG_STALE_MS,
    gcTime: LOG_GC_MS,
    queryFn: () => auditVerify(connectionId),
  });
}

export function auditPageQuery(
  connectionId: string,
  cursor: { rowId: number } | null,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: qk.auditPage(connectionId, cursor),
    enabled,
    staleTime: LOG_STALE_MS,
    gcTime: LOG_GC_MS,
    queryFn: () => listAuditPage(connectionId, cursor),
  });
}

export function auditEntryQuery(
  connectionId: string,
  entryId: string | null,
) {
  return queryOptions({
    queryKey: qk.auditEntry(connectionId, entryId ?? ""),
    enabled: entryId !== null,
    staleTime: Infinity,
    gcTime: LOG_GC_MS,
    queryFn: () => getAuditEntry(connectionId, entryId ?? ""),
  });
}

// One page of documents — the MongoDB sibling of tableRowsQuery's page half. The exact
// total is cached separately (documentCountQuery) so paging through a large collection
// doesn't re-run count_documents on every page.
export function documentRowsQuery(args: DocumentRowsArgs) {
  const { connectionId, collection, pageSize, page } = args;
  return queryOptions({
    queryKey: qk.documentRows(args),
    staleTime: LOG_STALE_MS,
    queryFn: () =>
      runDocumentRead(
        connectionId,
        { op: "find", collection, skip: page * pageSize, limit: pageSize },
        "data-view",
      ),
  });
}

// A collection's exact document count, cached independent of page/pageSize so every page
// of the same collection shares one count_documents run.
export function documentCountQuery(connectionId: string, collection: string) {
  return queryOptions({
    queryKey: qk.documentCount(connectionId, collection),
    staleTime: LOG_STALE_MS,
    queryFn: async (): Promise<number | null> => {
      const countOut = await runDocumentRead(
        connectionId,
        { op: "count", collection },
        "data-view",
      );
      const count = (countOut.documents[0] as { count?: number } | undefined)?.count;
      return count == null ? null : Number(count);
    },
  });
}

// One page of table data. Reading one look-ahead row provides exact next-page state
// without putting a potentially table-sized COUNT(*) on the first-paint critical path.
export function tableRowsQuery(args: TableRowsArgs) {
  const {
    connectionId,
    engine,
    table,
    filters,
    whereExpression,
    orderByExpression,
    sort,
    pageSize,
    page,
  } = args;
  return queryOptions({
    queryKey: qk.tableRows(args),
    staleTime: LOG_STALE_MS,
    queryFn: async (): Promise<TableRowsPage> => {
      const pageSql = buildPageQuery(engine, table, {
        filters,
        whereExpression,
        orderByExpression,
        sort,
        limit: pageSize + 1,
        offset: page * pageSize,
      });
      const pageResult = await runSqlReadPage(
        connectionId,
        pageSql,
        "data-view",
        table.database ?? undefined,
      );
      const hasMore = pageResult.rows.length > pageSize || pageResult.truncated;
      const rows = pageResult.rows.slice(0, pageSize);
      return {
        result: { ...pageResult, rows, rowCount: rows.length },
        hasMore,
      };
    },
  });
}

// Exact totals are useful for last-page navigation, but they are secondary metadata.
// Cache them independently so paging never repeats the count and callers can defer it
// until the first visible page has committed.
export function tableCountQuery(args: TableCountArgs) {
  const { connectionId, engine, table, filters, whereExpression } = args;
  return queryOptions({
    queryKey: qk.tableCount(args),
    staleTime: LOG_STALE_MS,
    queryFn: async (): Promise<number | null> => {
      const result = await runSqlReadPage(
        connectionId,
        buildCountQuery(engine, table, filters, whereExpression),
        "data-view-count",
        table.database ?? undefined,
      );
      const count = result.rows[0]?.[0];
      return count == null ? null : Number(count);
    },
  });
}
