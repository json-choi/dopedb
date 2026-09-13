<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/introspect

## Purpose

Schema introspection into a serde `Catalog`. Always reads through the
connection's read-only pool. The catalog backs schema snapshots, table DDL
reconstruction, and the local CLI's catalog commands. Covers `pg/` inline.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Entry point (`introspect`, `overview`) dispatching a live connection to the matching per-engine module (Postgres/MySQL/SQLite via the read-only pool, BigQuery via its own connection, MongoDB via `../mongo::introspect`). The `Catalog`/`Table`/`Column` shapes it returns are owned by `../features/catalog`, not defined here. |
| `catalog_v2.rs` | Canonical catalog snapshot cache adapter (the versioned cache format persisted via `../store/repositories/catalog.rs`). |
| `pg.rs` | PostgreSQL introspection through bounded `pg_catalog` scans. |
| `pg_ddl.rs` | Synthesizes `CREATE TABLE`/`CREATE INDEX` from the introspected catalog. This is a best-effort reconstruction (types come from `information_schema`, composite foreign keys emit one line per column) — explicitly **not** a `pg_dump`-exact dump. |
| `pg_timeout.rs` | Bounded scan budgets for Postgres introspection: a fixed ceiling for the core relation tree, separate from target-connection establishment and workspace authorization (which complete before this module runs and keep their own error semantics), and one shared budget for detailed metadata so a large schema cannot turn several individually-valid statements into an unbounded foreground operation. |
| `mysql.rs` | MySQL/MariaDB introspection via `information_schema`. On PlanetScale/Vitess, foreign-key metadata is unreliable under sharding, so `skip_fk` drops it rather than reporting it incorrectly. |
| `sqlite.rs` | SQLite introspection via `sqlite_master` plus metadata-only `PRAGMA`s. `PRAGMA` arguments cannot be bound, so table names are interpolated with `"`-quoting; identifiers come from `sqlite_master` rather than user input, but are still quoted defensively. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `pg/` | PostgreSQL-only introspection statements (see `queries.rs` below; no separate `AGENTS.md` — documented here per the assignment). |

`pg/queries.rs`: Version-aware PostgreSQL object metadata statements (queries
vary by server version) consumed by `pg.rs`.

## For AI Agents

### Working In This Directory

- Introspection must always run through the connection's read-only pool —
  never the read-write pool, even though it is metadata-only.
- `pg_ddl.rs`'s reconstructed DDL is best-effort; do not present it to users
  as byte-for-byte equivalent to `pg_dump` output, and do not silently drop
  the composite-foreign-key caveat when extending it.
- Any new Postgres scan must respect `pg_timeout.rs`'s bounded budgets rather
  than adding an unbounded metadata query — a large schema must not be able to
  turn introspection into an unbounded foreground operation.
- `mysql.rs`'s `skip_fk` behavior on sharded backends (PlanetScale/Vitess) must
  stay a deliberate omission, not silently-wrong FK data.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block here today.

## Dependencies

### Internal

- Reads through `../connection`'s read-only pools; returns the `Catalog`/
  `Table`/`Column` types owned by `../features/catalog`; caches snapshots via
  `../store/repositories/catalog.rs`; consumed by `../ddl`.

### External

- `sqlparser`, `sqlx`, `chrono`, `dopedb-protocol` (shared `Constraint`,
  `IndexKey`, `ObjectRef`, and catalog-v2 cache wire types).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
