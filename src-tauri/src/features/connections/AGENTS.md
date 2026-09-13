<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/connections

## Purpose

Saved connection domain rules, validation, and mutation ordering for every
engine DopeDB supports. Per `CLAUDE.md`/`AGENTS.md`, connecting,
reconnecting, importing, or repairing a connection must never change an
existing application's users, roles, passwords, grants, default privileges,
PUBLIC/shared-role ACLs, or object ownership — this feature provisions and
validates DopeDB-owned principals without rewriting pre-existing ones.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Saved connection feature composition. |
| `domain.rs` | Connection domain values and invariants, deliberately unaware of Tauri, SQLite, the keychain, live pools, or the driver installer; owns rules every transport must use. |
| `application.rs` | Connection use cases; validation and mutation ordering, with concrete SQLite/keychain/driver/pool/Tauri details behind ports. |
| `ports.rs` | Platform ports required by connection use cases. |
| `adapters.rs` | Concrete connection adapters for SQLite, live pool authority, drivers, and keychain. |
| `transport.rs` | Tauri transport adapter for connection use cases. |
| `demo.rs` | Creates the bundled, local SQLite learning database used by the first-run Data Source launcher; seeded idempotently under the app-local data directory so opening the demo never overwrites user edits. |

## For AI Agents

### Working In This Directory

- Any new connect/repair/import path must preserve pre-existing application
  users, roles, grants, and ownership; only new DopeDB-owned principals may
  be created or normalized. Stop with a specific diagnostic rather than
  silently widening access when a safe path cannot be established.
- `demo.rs`'s seeding must stay idempotent — never overwrite an existing
  demo database file's user edits.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

### Common Patterns

- `compose(...)` in `mod.rs` wires `adapters.rs`'s concrete gateways into
  `application::ConnectionUseCases`, following the same shape as `catalog/`.

## Dependencies

### Internal

- Imports `crate::features::catalog` and `crate::kernel::identity`.
- Imported by `crate::features::workspaces` (shared-connection
  publication/binding) and `crate::features::queries`/`crate::connection`
  runtime composition outside this tree.

### External

- `sqlx`, `keyring`, provider driver crates.
- Frontend adapter: `src/features/connections/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
