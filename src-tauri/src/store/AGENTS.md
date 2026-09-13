<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/store

## Purpose

The local application store: a WAL-mode SQLite database at the application-
owned data root's `app.db`, holding connections, safety settings, query
history, the audit log, snippets, and the schema cache. Secrets are **never**
stored here — a connection row carries only a `secret_ref` pointing at an OS
credential-store item (see `../connection/keychain.rs`). Row⇄model mapping is
manual (`sqlx::query`, not the compile-time `query!` macro) because this is a
runtime-arbitrary-SQL client, not a fixed-schema application. Covers
`repositories/` and `tests/` inline.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | `Store::open()`: opens (or resets, for a pre-MVP schema mismatch) the WAL SQLite database at the app-owned data root. |
| `schema.rs` | Current DDL baseline for a fresh local app database (952 lines). Secrets never live here, matching the module-level invariant. |
| `bootstrap.rs` | Fresh-install bootstrap for the local app database. DopeDB is still pre-MVP, so stores from earlier schema experiments are deliberately unsupported — `Store::open` resets a mismatched app-owned store rather than decoding or migrating it, to avoid carrying data-conversion code for a product that has not reached MVP. |
| `projections.rs` | SQLite row projections and stable enum/string codecs shared across repositories. |
| `workspace_codec.rs` | SQLite wire codecs for workspace-owned values. |
| `agent_acp.rs` | Workspace-scoped persistence for current ACP conversation projections. Only opaque session ids and bounded UI events live here — provider tokens, refresh credentials, broker capabilities, and prompt context rows are never persisted by this repository. |
| `query_services.rs` | Bounded workspace/account-local persistence for the Services result projection. Snapshots are display-only execution artifacts; they never become executable SQL, operation grants, credentials, or authority inputs after being loaded back. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `repositories/` | Feature-scoped SQLite repository implementations owned by the local store (see below). |
| `tests/` | The store's own `#[cfg(test)]` integration suite, gated by `#[cfg(test)] mod tests;` in `mod.rs` (see below). |

### `repositories/`

| File | Description |
|------|-------------|
| `mod.rs` | Declares the feature-scoped repository submodules. |
| `catalog.rs` | Canonical catalog cache persistence (backs `../introspect/catalog_v2.rs`). |
| `history.rs` | Scope-pinned query history persistence and Analysis Article provenance reads. |
| `safety.rs` | Per-connection safety policy persistence. |
| `analysis_articles.rs` | Encrypted local recovery cache for privacy-minimized Analysis Article results. |
| `analysis_run_identity.rs` | Device-local identity for the possession-bound manual Analysis run capability; not a database credential and never authorizes background work on its own. |
| `connections/mod.rs` | Connection persistence grouped by mutation, lookup, and batch operations. |
| `connections/mutations.rs` | Connection creation, remote synchronization, and credential-binding mutations. |
| `connections/lookup.rs` | Scoped connection lookup and retained-authority validation. |
| `connections/grouping.rs` | Batch schema grouping and connection tombstone mutations. |
| `workspaces/mod.rs` | Workspace persistence grouped by account sync, selection, and scope invariants. |
| `workspaces/accounts.rs` | Remembered account and workspace-membership reconciliation. |
| `workspaces/scope.rs` | Active-scope projection, generation, and membership-repair invariants. |
| `workspaces/selection.rs` | Atomic account/workspace selection and account removal. |
| `workspaces/sync.rs` | Account-scoped hosted pull checkpoints. |

### `tests/`

| File | Description |
|------|-------------|
| `mod.rs` | Declares the store's "minimal scope-isolation smoke suite" (`connections_scope`, `fixtures`). |
| `fixtures.rs` | Shared store repository integration-test fixtures against the current schema. |
| `connections_scope.rs` | Store baseline, shared connection-binding, and catalog scope-isolation tests (2109 lines — the largest test file in the crate). |

## For AI Agents

### Working In This Directory

- Never persist a secret (password, token, refresh credential) into any table
  here — a connection row holds only a `secret_ref`; provider/ACP credentials
  stay out of `agent_acp.rs` and `query_services.rs` by design.
- `Store::open` resets a mismatched pre-MVP schema rather than migrating it.
  Do not add migration/decode logic for an old schema without first checking
  whether the pre-MVP reset policy in `bootstrap.rs` still applies — that is a
  product decision, not a local judgment call.
- Every repository is scope-pinned (workspace/account/connection revision, via
  `../kernel::access`) — a new query must filter by the same scope columns
  the existing lookups in `repositories/connections/lookup.rs` and
  `repositories/workspaces/scope.rs` use, not just by a bare id.
- Row mapping is manual `sqlx::query` (not `query!`), matching the
  runtime-arbitrary-SQL nature of the app; keep new mappers consistent with
  `projections.rs`'s existing codecs rather than inventing a parallel scheme.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`) runs `tests/`.
  `repositories/analysis_articles.rs` (3 tests) and
  `tests/connections_scope.rs` (4 tests) are budget-protected under the
  repository's 208-test cap (`tests/critical-test-budget.json`); a new test
  must replace a lower-value existing test rather than raise the cap — run
  `pnpm check:test-budget` after a test change.

## Dependencies

### Internal

- Backs nearly every feature under `../features/*` and `../operations`,
  `../audit`, `../skills`; secrets it references by id live in
  `../connection/keychain.rs`'s OS credential store.

### External

- `sqlx` (sqlite), `chrono`, `uuid`, `chacha20poly1305`/`zeroize` (Analysis
  Article local recovery cache encryption), `tokio`, `dopedb-protocol`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
