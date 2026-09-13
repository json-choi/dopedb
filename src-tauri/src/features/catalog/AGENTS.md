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
