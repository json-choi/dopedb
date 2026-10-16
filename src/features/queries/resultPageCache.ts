// Retains bounded SQL stream pages and serves row, decode-failure, and subscription lookups.
// A page that fails to load is retried a bounded number of times with backoff and then
// reported as a classified error the result surface can explain and recover from.

import type {
  SqlStreamBatch,
  SqlStreamBatchWire,
  SqlStreamPageRange,
  SqlStreamRowSource,
} from "./domain";
import type { CellDecodeFailure } from "../../ipc/generated/model";

/**
 * Failure-metadata type of a cell the backend shortened so its row fits one
 * result page (`dopedb.truncated:<original bytes>`). Unlike a decode failure,
 * the cell keeps a text preview; copy and export still refuse it.
 */
const TRUNCATED_CELL_TYPE_PREFIX = "dopedb.truncated:";

export function truncatedCellBytes(
  failure: Pick<CellDecodeFailure, "databaseType">,
): number | null {
  if (!failure.databaseType.startsWith(TRUNCATED_CELL_TYPE_PREFIX)) return null;
  const bytes = Number(failure.databaseType.slice(TRUNCATED_CELL_TYPE_PREFIX.length));
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

/** A failed cell is null; a shortened cell keeps its string preview. */
export function decodeFailureCellIsConsistent(
  failure: CellDecodeFailure,
  value: unknown,
) {
  return truncatedCellBytes(failure) === null
    ? value === null
    : typeof value === "string";
}

/** Six 512 KiB wire pages plus one in-flight IPC page bounds renderer retention. */
export const SQL_RESULT_CACHE_MAX_PAGES = 6;
const SQL_RESULT_CACHE_MAX_RESULTS = 4;
/** Automatic attempts per page before the surface asks for an explicit retry. */
const SQL_RESULT_PAGE_MAX_ATTEMPTS = 3;
const SQL_RESULT_PAGE_RETRY_BASE_MS = 1_000;

/**
 * Why stored rows could not be read back. `authorityChanged`: the connection was
 * edited or access changed since the run; `expired`: the local result artifact
 * left retention; `unavailable`: anything else (corrupt or unreadable page).
 */
export type SqlResultPageErrorKind = "authorityChanged" | "expired" | "unavailable";

export type SqlResultPageError = {
  kind: SqlResultPageErrorKind;
  /** True while a bounded automatic retry is still scheduled. */
  retrying: boolean;
};

type PageFailure = { attempts: number; retryAt: number; kind: SqlResultPageErrorKind };

type ResultPageCache = {
  pages: Map<
    number,
    { rowStart: number; rows: readonly unknown[][] }
  >;
  failures: Map<number, readonly CellDecodeFailure[]>;
  loading: Map<number, Promise<void>>;
  pageFailures: Map<number, PageFailure>;
  retryTimer: ReturnType<typeof setTimeout> | null;
  error: SqlResultPageError | null;
};

export function classifySqlResultPageError(error: unknown): SqlResultPageErrorKind {
  const shaped = error && typeof error === "object"
    ? (error as { kind?: unknown; message?: unknown })
    : {};
  const message = typeof shaped.message === "string" ? shaped.message : "";
  if (shaped.kind === "blocked" && message.includes("authority changed")) {
    return "authorityChanged";
  }
  if (
    shaped.kind === "notFound" ||
    (shaped.kind === "io" && /no such file|not found|cannot find/i.test(message))
  ) {
    return "expired";
  }
  return "unavailable";
}

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
      pageFailures: new Map(),
      retryTimer: null,
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
    clearPageFailures(oldest[1]);
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

function clearPageFailures(cache: ResultPageCache) {
  if (cache.retryTimer !== null) clearTimeout(cache.retryTimer);
  cache.retryTimer = null;
  cache.pageFailures.clear();
  cache.error = null;
}

/** Explicit recovery: forget failed attempts so the next render reads again. */
export function retrySqlResultPages(source: SqlStreamRowSource) {
  const key = sourceKey(source);
  const cache = key ? caches.get(key) : undefined;
  if (!cache || !key) return;
  clearPageFailures(cache);
  notify(key);
}

function recordPageFailure(
  key: string,
  cache: ResultPageCache,
  sequence: number,
  error: unknown,
) {
  const previous = cache.pageFailures.get(sequence);
  const attempts = (previous?.attempts ?? 0) + 1;
  const kind = classifySqlResultPageError(error);
  // A changed authority or an expired artifact cannot heal by itself.
  const retrying =
    kind === "unavailable" && attempts < SQL_RESULT_PAGE_MAX_ATTEMPTS;
  const delay = SQL_RESULT_PAGE_RETRY_BASE_MS * 4 ** (attempts - 1);
  cache.pageFailures.set(sequence, {
    attempts: retrying ? attempts : SQL_RESULT_PAGE_MAX_ATTEMPTS,
    retryAt: Date.now() + delay,
    kind,
  });
  cache.error = { kind, retrying };
  if (retrying && cache.retryTimer === null) {
    cache.retryTimer = setTimeout(() => {
      cache.retryTimer = null;
      notify(key);
    }, delay);
  }
  notify(key);
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
  cache.pageFailures.delete(sequence);
  while (cache.pages.size > SQL_RESULT_CACHE_MAX_PAGES) {
    const oldest = cache.pages.keys().next().value;
    if (oldest === undefined) break;
    cache.pages.delete(oldest);
    cache.failures.delete(oldest);
  }
  if (cache.pageFailures.size === 0) cache.error = null;
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

export function sqlResultPageError(
  source: SqlStreamRowSource,
): SqlResultPageError | null {
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

/** Iterates only retained pages, including partial streams, without flattening or fetching. */
export function* iterateCachedSqlResultRows(source: SqlStreamRowSource) {
  const cache = cacheFor(source);
  if (!cache) return;
  for (const page of cache.pages.values()) {
    for (let offset = 0; offset < page.rows.length; offset += 1) {
      yield [page.rowStart + offset, page.rows[offset]] as const;
    }
  }
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
  const now = Date.now();
  for (const range of ranges) {
    const sequence = range.sequence;
    if (cache.pages.has(sequence)) continue;
    const failure = cache.pageFailures.get(sequence);
    // Re-rendering after a failure must not re-request the page: only the
    // bounded backoff timer or an explicit retry starts another attempt.
    if (
      failure &&
      (failure.attempts >= SQL_RESULT_PAGE_MAX_ATTEMPTS || now < failure.retryAt)
    ) {
      continue;
    }
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
                !failure.databaseType ||
                !decodeFailureCellIsConsistent(
                  failure,
                  batch.rows[failure.rowIndex - range.rowStart]?.[
                    failure.columnIndex
                  ],
                ),
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
          recordPageFailure(key, current, sequence, error);
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
    const cache = caches.get(key);
    cache?.pages.clear();
    cache?.failures.clear();
    if (cache) clearPageFailures(cache);
    caches.delete(key);
    notify(key);
  } else if (!source) {
    const keys = [...caches.keys()];
    for (const cache of caches.values()) {
      cache.pages.clear();
      cache.failures.clear();
      clearPageFailures(cache);
    }
    caches.clear();
    for (const cacheKey of keys) notify(cacheKey);
  }
}
