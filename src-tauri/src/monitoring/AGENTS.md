<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/monitoring

## Purpose

Lightweight, read-mostly database health snapshots for Agent query planning.
The collector deliberately returns aggregates only: no other session's SQL
text, parameters, usernames, or client addresses leave the Rust trust
boundary. PostgreSQL can opt in to its built-in `pg_monitor` role through a
separate, fixed GRANT/REVOKE operation; MySQL and SQLite degrade to basic
coverage without any setup step.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | The health-snapshot collector and its per-engine aggregate-only queries; the `pg_monitor` opt-in path. |

## For AI Agents

### Working In This Directory

- Never widen a snapshot query to return another session's SQL text,
  parameters, username, or client address — the aggregate-only boundary is the
  point of this module.
- The `pg_monitor` GRANT/REVOKE is a narrowly scoped, exact operation; route
  any change to it through `../operations`, not an ad hoc privilege statement.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block here today.

## Dependencies

### Internal

- Exposed to the frontend via `../commands` (`get_monitoring_status`,
  `propose_postgres_monitoring`, `set_postgres_monitoring`); reads through
  `../connection`'s pools.

### External

- `sqlx`, `chrono`, `serde`, `tokio`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
