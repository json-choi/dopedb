<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/catalog

## Purpose

Scope-pinned metadata catalog reads: databases, tables, columns, indexes,
foreign keys, and an overview projection used for Explorer/introspection.
This feature is the reference example for the
domain/application/ports/adapters + `transport.rs` convention documented in
the parent `AGENTS.md` — read it end to end before extending a bigger
feature.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Declares the submodules; `compose(store, connections) -> CatalogFeature` builds `CatalogUseCases<ScopedCatalogGateway>`. |
| `domain.rs` | Catalog wire values and read policy, independent from Tauri, SQLx, connection pools, and the introspection implementation; current IPC values use one exact shape. |
| `application.rs` | Typed catalog use cases (`CatalogUseCases<P: CatalogPort>`). |
| `ports.rs` | Platform contract (`CatalogPort`) required by catalog use cases. |
| `transport.rs` | Tauri transport for catalog use cases. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | Concrete scope-pinned catalog/DDL gateway. |

**`adapters/`**

| File | Description |
|------|-------------|
| `mod.rs` | Declares `local`; re-exports `ScopedCatalogGateway`. |
| `local.rs` | Scope-pinned catalog and DDL adapter (`ScopedCatalogGateway`), the concrete `CatalogPort` implementation. |

## For AI Agents

### Working In This Directory

- Keep `domain.rs` free of Tauri/SQLx/pool types — it is the one exact wire
  shape the current IPC contract relies on; extend it deliberately rather
  than widening it ad hoc.
- New introspection logic belongs in `adapters/local.rs` behind `CatalogPort`,
  never inline in `transport.rs`.
- Desktop reads catalogs only through `load_live_snapshot` (always live; reading
  the configured database also replaces the persisted snapshot so CLI cache-first
  readers stay current). Relation DDL never waits for the snapshot load lock.
- `Store::clear_schema_cache` deletes the connection's cached catalog in every
  workspace account scope and announces `CatalogChanged`. The DDL-committing
  paths call it: Desktop SQL runs, scripts, and SQL import Jobs (after any DDL
  statement committed or reached an unknown commit outcome). Connection edits call
  it too; manual transactions refuse DDL. A new DDL-committing path must call it.
  The transport's process-wide forwarder, started by the first renderer catalog
  read, emits the announcement as `catalog:changed`. A reader's own refresh uses
  the silent, scope-local `Store::discard_catalog_cache` so it never re-triggers
  itself. An import that may run DDL reads with `CatalogReadPolicy::Uncached`, so
  no pre-import snapshot is persisted for its own DDL to make stale.
- `clear_schema_cache` also bumps the connection's in-process schema epoch. A live
  read captures `Store::catalog_epoch` before it introspects and passes it to
  `put_catalog_if_current`; a write whose epoch is older returns `Superseded` and is
  not stored, so a scan that began before a DDL commit cannot re-persist the old
  schema. Callers return such a snapshot uncached; `catalog:changed` reloads views.
- `CATALOG_PRODUCER_REVISION` (`introspect/catalog_v2.rs`) names what a stored
  snapshot means. Bump it whenever introspection changes snapshot contents: store
  bootstrap then retires every row an older producer wrote, so no reader, Desktop
  or an Agent's cache-first read, is served one. Cache-first reads also refuse a
  snapshot older than 15 minutes and reintrospect. A capture time in the future is
  never current (`get_catalog_if_current`) and never fresh.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

### Common Patterns

- `compose(store: Store, connections: ConnectionManager) -> CatalogFeature`
  in `mod.rs` is the canonical composition shape referenced by the parent
  `AGENTS.md`.

## Dependencies

### Internal

- Imports `crate::kernel::{access, identity}`.
- Imported by `crate::features::connections`, `crate::features::jobs`
  (catalog refresh during import/export planning), and
  `crate::features::scripts`.

### External

- `sqlx`, `dopedb-protocol` (`CatalogSnapshot`).
- Frontend adapter: `src/features/catalog/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
