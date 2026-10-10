<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/catalog

## Purpose

Loads and projects the raw catalog snapshot (schemas, tables, views, routines)
returned by the Rust core into the `Catalog`/`CatalogOverview` shapes the rest
of the frontend consumes, plus a table DDL lookup. It does not own Explorer UI
state (`catalogExplorer/` does) — this feature is the IPC + projection layer.

## Key Files

| File | Description |
|------|-------------|
| `tauriAdapter.ts` | `getCatalogOverview`, `listConnectionDatabases`, `getDatabaseCatalogOverview`, the single live read `getDatabaseCatalogSnapshot` (`null` = configured database), `getTableDdl`, plus the projections `catalogFromSnapshot` (memoized per snapshot object; keeps every key constraint and expression index keys), `overviewFromSnapshot` and `navigationTableFromOverview`. |
| `useTableDdl.ts` | `tableDdlQuery`/`useTableDdl` — a `queryOptions()`-based hook for one table's DDL, keyed by connection/database/schema/table. |

## For AI Agents

### Working In This Directory

- `catalogFromSnapshot` is the one place that converts the newer `CatalogSnapshot`
  relation model into the older `Catalog`/`CatalogTable` shape (including its
  `objectKind` mapping of `"routine"` to `"function"`); keep both shapes in sync
  here rather than duplicating the conversion in a caller.
- Consumers needing filtered/scoped catalog data should use
  `src/features/catalogExplorer/scopeFilter.ts` on top of this feature's reads,
  not reimplement filtering here.

### Testing Requirements

- No test file in this directory; not part of `pnpm test` or the 208-test budget.

### Common Patterns

- IPC-adapter functions here return `Promise<T>` directly rather than a
  `queryOptions()` object; query-key wiring for these lives in `src/lib/queries.ts`
  except for `useTableDdl.ts`, which defines its own
  `tableDdlQuery`/`tableDdlQueryKey` locally. One live snapshot entry per exact
  `(connection, database)` (`databaseCatalogSnapshotQuery`) is the cached source;
  `databaseCatalogQuery` selects the `Catalog` projection from that same entry, and
  `refreshConnectionCatalog` is the only refresh path (Explorer refresh, committed
  DDL via `catalog:changed`).

## Dependencies

### Internal

- `src/ipc/types` (`Catalog`, `CatalogObject`, `CatalogOverview`, `CatalogSnapshot`,
  `CatalogTable`, `DatabaseSummary`).
- Rust counterpart: `src-tauri/src/features/catalog/transport.rs` (verified present).

### External

- `@tanstack/react-query` (`queryOptions`, `useQuery`) in `useTableDdl.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
