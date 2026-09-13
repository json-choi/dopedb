<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/kernel

## Purpose

Small, platform-independent cross-feature domain primitives and permission
types shared across feature boundaries, with no persistence or platform
dependency of their own. This is the "small shared types" layer the root
`AGENTS.md`/`CLAUDE.md` describes: feature cores may depend on `kernel`
without pulling in Tauri, SQLx, or any adapter.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Declares the submodules (`access`, `agent_policy`, `identity`, `sql_namespace`, `sync`, `terminal_authority`), all `pub(crate)`. |
| `access.rs` | Exact local access authority (which workspace/account selection and connection revision a task was authorized against) shared across feature boundaries. Contains no persistence or runtime handles, so application ports can name it without depending on the SQLite `Store` that materializes it. |
| `identity.rs` | Strong, transparent-wrapper resource identities (connection, workspace, document, etc.) so a raw `Uuid` cannot be passed to the wrong lookup without a compiler error, while keeping the existing wire representation. |
| `sql_namespace.rs` | Shared SQL namespace validation and identifier quoting. A namespace travels through document persistence and immutable operation payloads as plain data; only the target-specific executor (`../executor`) turns it into SQL, using quoted identifiers rather than a raw statement fragment. |
| `terminal_authority.rs` | Immutable authority captured by one in-app Terminal session. Lives in `kernel` rather than a feature service because query, document, Analysis Article, operation, and connection slices all validate the same pin. |
| `sync.rs` | Poison-tolerant synchronization primitives (`lock_unpoisoned`) shared by long-lived runtimes, so one panicking holder of a `Mutex` does not permanently wedge every future caller. |
| `agent_policy.rs` | Cross-feature limits for short-lived, Terminal-originated Agent capabilities (e.g. how long one immutable Agent plan lives before it must be recreated). |

## For AI Agents

### Working In This Directory

- A type belongs here only if it has no persistence/runtime handle and no
  platform dependency; anything that needs `Store`, a live pool, or Tauri
  belongs in the owning feature or in `../connection`/`../store` instead.
- Prefer the `identity.rs` wrapper types over a bare `Uuid` when adding a new
  cross-feature identifier, to keep lookups compiler-checked.
- Use `sync::lock_unpoisoned` instead of `.lock().unwrap()` for any
  long-lived, shared `Mutex` so one panic does not poison every future caller.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block here today.

## Dependencies

### Internal

- Depended on by most feature modules under `../features/*`, plus
  `../executor`, `../store`, `../connection`, and `../broker` for identity,
  access-authority, and namespace types.

### External

- `serde`, `uuid`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
