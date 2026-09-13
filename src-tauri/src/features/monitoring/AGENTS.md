<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/monitoring

## Purpose

Scope-aware database monitoring status and fixed PostgreSQL role changes
(e.g. enabling monitoring roles/extensions with an exact, pre-defined SQL
shape rather than accepting arbitrary DDL from the caller).

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Feature root (scope-aware status + fixed role changes). |
| `application.rs` | Monitoring use cases independent of concrete storage, pool, and operation adapters. |
| `ports.rs` | Platform contract required by Monitoring use cases. |
| `adapters.rs` | Concrete local Monitoring adapter for authority, SQL, audit, and operation I/O. |
| `recording.rs` | Monitoring role SQL projection and audit/history recording. |

## For AI Agents

### Working In This Directory

- Role/extension changes must stay fixed-shape SQL generated in
  `recording.rs`, not free-form statements assembled from caller input.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

## Dependencies

### Internal

- Imports `crate::kernel::access`.
- No other `features/*` module imports this one.

### External

- `sqlx`.
- Frontend adapter: `src/features/monitoring/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
