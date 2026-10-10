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
| `pg.rs` | PostgreSQL introspection through bounded `pg_catalog` scans in one `REPEATABLE READ READ ONLY` snapshot. Each stage sends its savepoint, timeout and catalog query as one simple-protocol message (one network round trip, text-format rows), and a read-only scan ends by dropping its transaction instead of waiting for a COMMIT. A scan that raced a concurrent DROP (`AppError::is_concurrent_catalog_drop`: a lookup helper opened an object the snapshot still lists) is rescanned once in a fresh transaction; timeouts, cancels, authentication and network errors are not. |
| `pg_ddl.rs` | Reads ONE relation by oid and arranges server-rendered fragments (`format_type`, `pg_get_expr`, `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_viewdef`, partition key/bound) under an empty `search_path` into `CREATE [UNLOGGED|FOREIGN] TABLE` (columns with DEFAULT/identity/generated/collation, constraints in key order, `INHERITS`, `PARTITION BY`/`PARTITION OF`), `CREATE [MATERIALIZED] VIEW`, standalone indexes, `NOT VALID` constraints and comments. A reconstruction for review — explicitly **not** a `pg_dump`-exact dump (no ownership, grants, triggers, policies, sequence options or per-partition column overrides). |
| `pg_timeout.rs` | Bounded scan budgets for Postgres introspection: a fixed ceiling for the core relation tree, separate from target-connection establishment and workspace authorization (which complete before this module runs and keep their own error semantics), and one shared budget for detailed metadata so a large schema cannot turn several individually-valid statements into an unbounded foreground operation. |
| `mysql.rs` | MySQL/MariaDB introspection via `information_schema`. On PlanetScale/Vitess, foreign-key metadata is unreliable under sharding, so `skip_fk` drops it rather than reporting it incorrectly. Relations carry no schema, so a foreign key names its referenced database only when it points outside the current one. |
| `sqlite.rs` | SQLite introspection via `sqlite_master` plus metadata-only `PRAGMA`s. `PRAGMA` arguments cannot be bound, so table names are interpolated with `"`-quoting; identifiers come from `sqlite_master` rather than user input, but are still quoted defensively. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `pg/` | PostgreSQL-only introspection statements (see `queries.rs` below; no separate `AGENTS.md` — documented here per the assignment). |

`pg/queries.rs`: Version-aware PostgreSQL metadata statements consumed by
`pg.rs`: columns (identity 10+, generated 12+), foreign keys (11+ skips the
per-partition rows derived for a key referencing a partitioned table), index key
parts (11+ separates INCLUDE columns via `indnkeyatts`), and routines, sequences,
triggers plus enum/domain types (`kind = "type"`). Materialized views are
relations, not objects.

## For AI Agents

### Working In This Directory

- Introspection must always run through the connection's read-only pool —
  never the read-write pool, even though it is metadata-only.
- `pg_ddl.rs`'s reconstructed DDL is a review aid; do not present it to users
  as byte-for-byte equivalent to `pg_dump` output, keep its header comment, and
  keep reading a single relation by oid — never a full catalog scan per DDL view.
- Catalog statements sent through the simple protocol decode text-format values:
  return names, text, integers, booleans or JSON text, never SQL arrays (their
  text form cannot distinguish a NULL element from the string `NULL`).
- Every PostgreSQL statement skips temporary relations/schemas
  (`relpersistence <> 't'`, `pg_temp_N`): another session's temp objects are
  unreadable here and disappear with that session.
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
