<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/sql_documents

## Purpose

Persistent SQL document (saved query file) feature: create, rename, move,
and delete SQL documents scoped to a connection, with every mutation going
through one scope-pinned authority guard before the durable change is
persisted.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Persistent SQL document feature composition. |
| `domain.rs` | SQL document domain values and invariants; no knowledge of Tauri, SQLx, the local store, or connection authorization — defines only the data/rules every adapter must preserve. |
| `application.rs` | SQL document use cases; every transport calls this one API, which validates commands, obtains one scope-pinned authority guard, and asks the repository port to perform the durable change. |
| `ports.rs` | Ports required by the SQL document use cases; the application layer depends on these instead of concrete connection, clock, UUID, or SQLite implementations. |
| `adapters.rs` | Concrete SQL document adapters for connection authority, time/identity, and SQLite. |
| `transport.rs` | Tauri transport adapter for SQL document use cases. |

## For AI Agents

### Working In This Directory

- Every mutation must obtain its scope-pinned authority guard through
  `application.rs` before `adapters.rs` persists anything — do not let
  `transport.rs` call the repository directly.
- Keep `domain.rs` free of Tauri/SQLx/store/authorization types.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

## Dependencies

### Internal

- Imports `crate::kernel::{identity, sql_namespace}`.
- No other `features/*` module imports this one.

### External

- `sqlx`.
- Frontend adapter: `src/features/sqlDocuments/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
