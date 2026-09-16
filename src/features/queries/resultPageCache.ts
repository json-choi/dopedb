// Module-level LRU of decoded result pages shared by every grid reading one
// stream. Retention is bounded in both pages and results, and subscriptions are
// held apart from pages so eviction never strands a live grid on an orphan cache.
import type {
  SqlStreamBatch,
  SqlStreamBatchWire,
  SqlStreamRowSource,
} from "./domain";
import type { UnreadableCell } from "../../ipc/types";

/** Columns of one page row the backend could not decode, keyed by column index. */
type RowUnreadableColumns = ReadonlyMap<number, string>;

/** One retained page: decoded rows plus the cells that are not values at all. */
type CachedResultPage = {
  rows: readonly unknown[][];
  unreadable: ReadonlyMap<number, RowUnreadableColumns>;
};

function indexPageUnreadable(cells: readonly UnreadableCell[] | undefined) {
  const rows = new Map<number, Map<number, string>>();
  for (const cell of cells ?? []) {
    let columns = rows.get(cell.row);
    if (!columns) {
      columns = new Map();
      rows.set(cell.row, columns);
    }
    columns.set(cell.column, cell.typeName);
  }
  return rows;
}

/** Six 512 KiB wire pages plus one in-flight IPC page bounds renderer retention. */
export const SQL_RESULT_CACHE_MAX_PAGES = 6;
const SQL_RESULT_CACHE_MAX_RESULTS = 4;

type ResultPageCache = {
  pages: Map<number, CachedResultPage>;
  loading: Map<number, Promise<void>>;
  error: string | null;
};

const caches = new Map<string, ResultPageCache>();
// Subscriptions outlive page-cache eviction. Keeping them separate prevents an
// active grid from remaining attached to an orphaned cache after global LRU
// pressure clears its rows.
const listeners = new Map<string, Set<() => void>>();

function sourceKey(source: SqlStreamRowSource) {
  return source.operationId && source.capability
    ? `${source.operationId}:${source.capability}`
    : null;
}

function cacheFor(source: SqlStreamRowSource) {
  const key = sourceKey(source);
  if (!key) return null;
  let cache = caches.get(key);
  if (!cache) {
    cache = {
      pages: new Map(),
      loading: new Map(),
      error: null,
    };
    caches.set(key, cache);
  }
  caches.delete(key);
  caches.set(key, cache);
  return cache;
}

function notify(key: string) {
  for (const listener of listeners.get(key) ?? []) listener();
}

function trimResultPages(protectedKey: string) {
  while (
    [...caches.values()].filter((cache) => cache.pages.size > 0).length >
    SQL_RESULT_CACHE_MAX_RESULTS
  ) {
    const oldest = [...caches.entries()].find(
      ([key, cache]) => key !== protectedKey && cache.pages.size > 0,
    );
    if (!oldest) break;
    caches.delete(oldest[0]);
    oldest[1].pages.clear();
    oldest[1].error = null;
    notify(oldest[0]);
  }

  // Empty metadata is cheap while mounted, but should not accumulate after
  // tabs leave. Page-bearing entries remain governed by the strict bound above.
  for (const [key, cache] of caches) {
    if (caches.size <= SQL_RESULT_CACHE_MAX_RESULTS) break;
    if (key === protectedKey) continue;
    if (
      cache.pages.size === 0 &&
      cache.loading.size === 0 &&
      !listeners.has(key)
    ) {
      caches.delete(key);
    }
  }
}

function retain(
  source: SqlStreamRowSource,
  sequence: number,
  rows: readonly unknown[][],
  unreadable: readonly UnreadableCell[] | undefined,
) {
  const key = sourceKey(source);
  const cache = cacheFor(source);
  if (!cache || !key) return;
  cache.pages.delete(sequence);
  cache.pages.set(sequence, {
    rows,
    unreadable: indexPageUnreadable(unreadable),
  });
  while (cache.pages.size > SQL_RESULT_CACHE_MAX_PAGES) {
    const oldest = cache.pages.keys().next().value;
    if (oldest === undefined) break;
    cache.pages.delete(oldest);
  }
  cache.error = null;
  trimResultPages(key);
  notify(key);
}

export function retainSqlStreamBatch(
  source: SqlStreamRowSource,
  batch: SqlStreamBatch,
) {
  retain(source, batch.sequence, batch.rows, batch.unreadable);
}

export function sqlResultRowAt(
  source: SqlStreamRowSource,
  index: number,
): readonly unknown[] | undefined {
  if (index < 0 || index >= source.rowCount) return undefined;
  const cache = cacheFor(source);
  if (!cache) return undefined;
  const sequence = Math.floor(index / source.pageRows);
  const page = cache.pages.get(sequence);
  if (!page) return undefined;
  cache.pages.delete(sequence);
  cache.pages.set(sequence, page);
  return page.rows[index - sequence * source.pageRows];
}

/**
 * Columns of one loaded row the backend could not decode. An absent entry means
 * the page is not loaded, not that the row is readable — callers that must be
 * certain use the stream receipt's whole-result failure count.
 */
export function sqlResultRowUnreadable(
  source: SqlStreamRowSource,
  index: number,
): RowUnreadableColumns | undefined {
  if (index < 0 || index >= source.rowCount) return undefined;
  const cache = cacheFor(source);
  if (!cache) return undefined;
  const sequence = Math.floor(index / source.pageRows);
  const page = cache.pages.get(sequence);
  if (!page) return undefined;
  return page.unreadable.get(index - sequence * source.pageRows);
}

export function subscribeSqlResultPages(
  source: SqlStreamRowSource,
  listener: () => void,
) {
  const key = sourceKey(source);
  if (!key) return () => undefined;
  cacheFor(source);
  let sourceListeners = listeners.get(key);
  if (!sourceListeners) {
    sourceListeners = new Set();
    listeners.set(key, sourceListeners);
  }
  sourceListeners.add(listener);
  return () => {
    sourceListeners?.delete(listener);
    if (sourceListeners?.size === 0) listeners.delete(key);
  };
}

export function sqlResultPageError(source: SqlStreamRowSource) {
  return cacheFor(source)?.error ?? null;
}

export function collectCachedSqlResultRows(
  source: SqlStreamRowSource,
): readonly (readonly unknown[])[] | null {
  if (source.rowCount > source.pageRows * SQL_RESULT_CACHE_MAX_PAGES) {
    return null;
  }
  const cache = cacheFor(source);
  if (!cache) return null;
  const rows: (readonly unknown[])[] = [];
  const pageCount = Math.ceil(source.rowCount / source.pageRows);
  for (let sequence = 0; sequence < pageCount; sequence += 1) {
    const page = cache.pages.get(sequence);
    if (!page) return null;
    cache.pages.delete(sequence);
    cache.pages.set(sequence, page);
    rows.push(...page.rows);
  }
  return rows.length === source.rowCount ? rows : null;
}

/**
 * Read failures across every cached page, re-addressed to whole-result row
 * indices. Returns null under the same bound as `collectCachedSqlResultRows`, so
 * a caller never mistakes an unloaded page for a page without failures.
 */
export function collectCachedSqlResultUnreadable(
  source: SqlStreamRowSource,
): UnreadableCell[] | null {
  if (source.rowCount > source.pageRows * SQL_RESULT_CACHE_MAX_PAGES) {
    return null;
  }
  const cache = cacheFor(source);
  if (!cache) return null;
  const cells: UnreadableCell[] = [];
  const pageCount = Math.ceil(source.rowCount / source.pageRows);
  for (let sequence = 0; sequence < pageCount; sequence += 1) {
    const page = cache.pages.get(sequence);
    if (!page) return null;
    for (const [row, columns] of page.unreadable) {
      for (const [column, typeName] of columns) {
        cells.push({ row: sequence * source.pageRows + row, column, typeName });
      }
    }
  }
  return cells;
}

export async function ensureSqlResultRange(
  source: SqlStreamRowSource,
  start: number,
  end: number,
  expectedColumns: readonly string[],
  readPage: (
    source: SqlStreamRowSource,
    sequence: number,
  ) => Promise<SqlStreamBatchWire>,
) {
  if (!source.complete || source.rowCount === 0 || end <= start) return;
  const cache = cacheFor(source);
  const key = sourceKey(source);
  if (!cache || !key) return;
  const first = Math.floor(Math.max(0, start) / source.pageRows);
  const requestedLast = Math.floor(
    Math.max(0, Math.min(source.rowCount, end) - 1) / source.pageRows,
  );
  const last = Math.min(
    requestedLast,
    first + SQL_RESULT_CACHE_MAX_PAGES - 1,
  );
  const requests: Promise<void>[] = [];
  for (let sequence = first; sequence <= last; sequence += 1) {
    if (cache.pages.has(sequence)) continue;
    let request = cache.loading.get(sequence);
    if (!request) {
      request = readPage(source, sequence)
        .then((batch) => {
          if (
            batch.operationId !== source.operationId ||
            batch.sequence !== sequence ||
            batch.rows.length > source.pageRows ||
            batch.columns.length !== expectedColumns.length ||
            batch.columns.some(
              (column, index) => column !== expectedColumns[index],
            ) ||
            batch.rows.some((row) => row.length !== batch.columns.length) ||
            !Array.isArray(batch.unreadable) ||
            batch.unreadable.some(
              (cell) =>
                cell.row >= batch.rows.length ||
                cell.column >= batch.columns.length,
            )
          ) {
            throw new Error("SQL result page did not match its artifact");
          }
          retain(source, sequence, batch.rows, batch.unreadable);
        })
        .catch((error) => {
          const current = cacheFor(source);
          if (!current) return;
          current.error =
            error instanceof Error
              ? error.message
              : "SQL result page is unavailable";
          notify(key);
        })
        .finally(() => cache.loading.delete(sequence));
      cache.loading.set(sequence, request);
    }
    requests.push(request);
  }
  await Promise.all(requests);
}

export function clearSqlResultPageCache(source?: SqlStreamRowSource) {
  const key = source ? sourceKey(source) : null;
  if (key) {
    caches.get(key)?.pages.clear();
    caches.delete(key);
    notify(key);
  } else if (!source) {
    const keys = [...caches.keys()];
    for (const cache of caches.values()) cache.pages.clear();
    caches.clear();
    for (const cacheKey of keys) notify(cacheKey);
  }
}
