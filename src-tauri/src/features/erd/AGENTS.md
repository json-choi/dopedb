<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/erd

## Purpose

Workspace-scoped ERD (entity relationship diagram) canvas-layout
persistence. Physical relationships remain catalog facts; this feature
persists only canvas presentation and explicitly virtual relations, so it
cannot mutate a database schema as a side effect of opening, saving, or
sharing an ERD.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Workspace-scoped ERD persistence vertical slice. |
| `domain.rs` | ERD presentation values and invariants (see Purpose — no schema mutation). |
| `application.rs` | Typed ERD persistence use cases. |
| `ports.rs` | Platform contracts required by ERD persistence use cases. |
| `transport.rs` | Tauri transport for ERD persistence use cases. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | Concrete ERD authority, identity/time, and SQLite adapters. |

**`adapters/`**

| File | Description |
|------|-------------|
| `mod.rs` | Concrete ERD authority, identity/time, and SQLite adapters (module root). |
| `authority.rs` | Scope-pinned connection authority for ERD persistence. |
| `repository.rs` | Single-writer SQLite repository for workspace-scoped ERD layouts. |

## For AI Agents

### Working In This Directory

- Never let a canvas-layout save/share path issue DDL or otherwise touch the
  live database schema; only `adapters/repository.rs`'s SQLite tables may be
  written.
- `adapters/repository.rs` is the single writer for ERD layouts; route new
  persistence needs through it instead of a second writer.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

## Dependencies

### Internal

- Imports `crate::kernel::identity`.
- No other `features/*` module imports this one.

### External

- `sqlx`.
- Frontend adapter: `src/features/erd/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
