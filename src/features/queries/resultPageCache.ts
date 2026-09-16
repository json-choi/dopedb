// Retains bounded SQL stream pages and serves row, decode-failure, and subscription lookups.

import type {
  SqlStreamBatch,
  SqlStreamBatchWire,
  SqlStreamPageRange,
  SqlStreamRowSource,
} from "./domain";
import type { CellDecodeFailure } from "../../ipc/generated/model";

/** Six 512 KiB wire pages plus one in-flight IPC page bounds renderer retention. */
export const SQL_RESULT_CACHE_MAX_PAGES = 6;
const SQL_RESULT_CACHE_MAX_RESULTS = 4;

type ResultPageCache = {
  pages: Map<
    number,
    { rowStart: number; rows: readonly unknown[][] }
  >;
  failures: Map<number, readonly CellDecodeFailure[]>;
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
      failures: new Map(),
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
    oldest[1].failures.clear();
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
  rowStart: number,
  rows: readonly unknown[][],
  failures: readonly CellDecodeFailure[],
) {
  const key = sourceKey(source);
  const cache = cacheFor(source);
  if (!cache || !key) return;
  const range = source.pageRanges[sequence];
  if (
    !range ||
    range.sequence !== sequence ||
    range.rowStart !== rowStart ||
    range.rowCount !== rows.length
  ) {
    return;
  }
  cache.pages.delete(sequence);
  cache.pages.set(sequence, { rowStart, rows });
  cache.failures.set(sequence, failures);
  while (cache.pages.size > SQL_RESULT_CACHE_MAX_PAGES) {
    const oldest = cache.pages.keys().next().value;
    if (oldest === undefined) break;
    cache.pages.delete(oldest);
    cache.failures.delete(oldest);
  }
  cache.error = null;
  trimResultPages(key);
  notify(key);
}

export function retainSqlStreamBatch(
  source: SqlStreamRowSource,
  batch: SqlStreamBatch,
) {
  const range = source.pageRanges[batch.sequence];
  retain(
    source,
    batch.sequence,
    batch.rowStart ?? range?.rowStart ?? -1,
    batch.rows,
    batch.decodeFailures ?? [],
  );
}

function pageRangeIndexForRow(
  source: SqlStreamRowSource,
  rowIndex: number,
) {
  let low = 0;
  let high = source.pageRanges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = source.pageRanges[middle];
    if (rowIndex < range.rowStart) {
      high = middle - 1;
    } else if (rowIndex >= range.rowStart + range.rowCount) {
      low = middle + 1;
    } else {
      return middle;
    }
  }
  return -1;
}

export function sqlResultRangeIsCached(
  source: SqlStreamRowSource,
  start: number,
  end: number,
) {
  const requestedStart = Math.max(0, start);
  const requestedEnd = Math.min(source.rowCount, end);
  if (requestedEnd <= requestedStart) return true;
  const cache = cacheFor(source);
  if (!cache) return false;
  const firstRangeIndex = pageRangeIndexForRow(source, requestedStart);
  if (firstRangeIndex < 0) return false;
  let coveredUntil = requestedStart;
  for (
    let index = firstRangeIndex;
    index < source.pageRanges.length && coveredUntil < requestedEnd;
    index += 1
  ) {
    const range = source.pageRanges[index];
    const page = cache.pages.get(range.sequence);
    if (
      range.rowStart > coveredUntil ||
      !page ||
      page.rowStart !== range.rowStart ||
      page.rows.length !== range.rowCount
    ) {
      return false;
    }
    coveredUntil = Math.min(
      requestedEnd,
      range.rowStart + range.rowCount,
    );
  }
  return coveredUntil === requestedEnd;
}

export function sqlResultDecodeFailureAt(
  source: SqlStreamRowSource,
  rowIndex: number,
  columnIndex: number,
) {
  const cache = cacheFor(source);
  if (!cache) return undefined;
  for (const failures of cache.failures.values()) {
    const match = failures.find(
      (failure) =>
        failure.rowIndex === rowIndex && failure.columnIndex === columnIndex,
    );
    if (match) return match;
  }
  return undefined;
}

export function collectCachedSqlResultDecodeFailures(
  source: SqlStreamRowSource,
): readonly CellDecodeFailure[] {
  const cache = cacheFor(source);
  if (!cache) return [];
  return [...cache.failures.values()].flat();
}

export function sqlResultRowAt(
  source: SqlStreamRowSource,
  index: number,
): readonly unknown[] | undefined {
  if (index < 0 || index >= source.rowCount) return undefined;
  const cache = cacheFor(source);
  if (!cache) return undefined;
  const rangeIndex = pageRangeIndexForRow(source, index);
  if (rangeIndex < 0) return undefined;
  const range = source.pageRanges[rangeIndex];
  const page = cache.pages.get(range.sequence);
  if (!page || page.rowStart !== range.rowStart) return undefined;
  cache.pages.delete(range.sequence);
  cache.pages.set(range.sequence, page);
  return page.rows[index - range.rowStart];
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
  if (source.pageRanges.length > SQL_RESULT_CACHE_MAX_PAGES) {
    return null;
  }
  const cache = cacheFor(source);
  if (!cache) return null;
  const rows: (readonly unknown[])[] = [];
  for (const range of source.pageRanges) {
    const page = cache.pages.get(range.sequence);
    if (
      !page ||
      page.rowStart !== range.rowStart ||
      page.rows.length !== range.rowCount
    ) {
      return null;
    }
    cache.pages.delete(range.sequence);
    cache.pages.set(range.sequence, page);
    rows.push(...page.rows);
  }
  return rows.length === source.rowCount ? rows : null;
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
  const requestedStart = Math.max(0, start);
  const requestedEnd = Math.min(source.rowCount, end);
  const firstRangeIndex = pageRangeIndexForRow(source, requestedStart);
  if (firstRangeIndex < 0 || requestedEnd <= requestedStart) return;
  const ranges: SqlStreamPageRange[] = [];
  for (
    let index = firstRangeIndex;
    index < source.pageRanges.length && ranges.length < SQL_RESULT_CACHE_MAX_PAGES;
    index += 1
  ) {
    const range = source.pageRanges[index];
    if (range.rowStart >= requestedEnd) break;
    ranges.push(range);
  }
  const requests: Promise<void>[] = [];
  for (const range of ranges) {
    const sequence = range.sequence;
    if (cache.pages.has(sequence)) continue;
    let request = cache.loading.get(sequence);
    if (!request) {
      request = readPage(source, sequence)
        .then((batch) => {
          if (
            batch.operationId !== source.operationId ||
            batch.sequence !== sequence ||
            (batch.rowStart ?? range.rowStart) !== range.rowStart ||
            batch.rows.length !== range.rowCount ||
            batch.rows.length > source.pageRows ||
            batch.columns.length !== expectedColumns.length ||
            batch.columns.some(
              (column, index) => column !== expectedColumns[index],
            ) ||
            batch.rows.some((row) => row.length !== batch.columns.length) ||
            (batch.decodeFailures ?? []).some(
              (failure) =>
                failure.rowIndex < range.rowStart ||
                failure.rowIndex >=
                  range.rowStart + batch.rows.length ||
                failure.columnIndex < 0 ||
                failure.columnIndex >= batch.columns.length ||
                batch.rows[failure.rowIndex - range.rowStart]?.[
                  failure.columnIndex
                ] !== null ||
                !failure.databaseType,
            )
          ) {
            throw new Error("SQL result page did not match its artifact");
          }
          retain(
            source,
            sequence,
            range.rowStart,
            batch.rows,
            batch.decodeFailures ?? [],
          );
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
    caches.get(key)?.failures.clear();
    caches.delete(key);
    notify(key);
  } else if (!source) {
    const keys = [...caches.keys()];
    for (const cache of caches.values()) {
      cache.pages.clear();
      cache.failures.clear();
    }
    caches.clear();
    for (const cacheKey of keys) notify(cacheKey);
  }
}
