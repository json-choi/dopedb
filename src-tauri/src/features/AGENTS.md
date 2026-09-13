<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features

## Purpose

Feature-owned application slices, per `mod.rs`. Each feature keeps its domain
rules and use cases independent from Tauri, SQLx, and other platform adapters.
This directory is also the composition boundary that wires concrete adapters
into those use cases: every feature exposes a `compose(...)` function (in its
`mod.rs`) that builds a `Feature` facade from the domain-neutral use-case type
plus its concrete adapters. Feature cores (domain/application/ports) must not
reference Tauri, SQLx, `Store`, the keychain, the network, or the global
`AppState` directly; only adapters and `transport.rs` may do so.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Declares the 20 `pub(crate)` feature modules listed below; no logic of its own. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `activity/` | Transport-neutral audit-chain verification and execution-history reads (see `activity/AGENTS.md`). |
| `agents/` | ACP client runtime, official-adapter plugin management, and local CLI discovery (see `agents/AGENTS.md`). |
| `analysis_articles/` | Current, one-query Analysis Article definitions, sharing, and Desktop-only manual reruns (see `analysis_articles/AGENTS.md`). |
| `catalog/` | Scope-pinned metadata catalog reads (see `catalog/AGENTS.md`). |
| `connections/` | Saved connection domain, validation, and adapters (see `connections/AGENTS.md`). |
| `cosmic_scene/` | Deterministic, allocation-free scene seed for the decorative Welcome artwork (see `cosmic_scene/AGENTS.md`). |
| `documents/` | Transport-neutral, typed read-only MongoDB document queries (see `documents/AGENTS.md`). |
| `erd/` | Workspace-scoped ERD (entity relationship diagram) canvas-layout persistence (see `erd/AGENTS.md`). |
| `jobs/` | Durable, resumable import/export Job Engine (see `jobs/AGENTS.md`). |
| `knowledge/` | Project Knowledge graph extraction, hosted/local sources, and Agent-scoped reads (see `knowledge/AGENTS.md`). |
| `monitoring/` | Scope-aware database monitoring status and fixed PostgreSQL role changes (see `monitoring/AGENTS.md`). |
| `operation_control/` | Desktop-only exact-hash approval orchestration for durable Operations (see `operation_control/AGENTS.md`). |
| `product_analytics/` | Privacy-bounded, closed-vocabulary product analytics transport (see `product_analytics/AGENTS.md`). |
| `providers/` | Member-local provider credentials and managed-access provisioning lifecycles (see `providers/AGENTS.md`). |
| `queries/` | SQL query use cases for desktop and authenticated Terminal/Agent workflows (see `queries/AGENTS.md`). |
| `safety_settings/` | Per-connection safety settings (row caps, write/schema gates) (see `safety_settings/AGENTS.md`). |
| `scripts/` | Transport-neutral multi-statement SQL script execution (see `scripts/AGENTS.md`). |
| `sql_documents/` | Persistent SQL document (saved query file) feature (see `sql_documents/AGENTS.md`). |
| `terminals/` | Connection-pinned, PTY-backed advanced Shell (see `terminals/AGENTS.md`). |
| `workspaces/` | Account-aware workspace authentication, membership, and sync (see `workspaces/AGENTS.md`). |

## For AI Agents

### Working In This Directory

- The intended layering per feature is `domain.rs` (pure types/invariants) →
  `ports.rs` (traits the application depends on) → `application.rs` (use
  cases, generic over the port traits) → `adapters/` (concrete Tauri/SQLx/
  keychain/network implementations of the ports) → `transport.rs` (thin
  `#[tauri::command]` boundary that (de)serializes DTOs and calls the
  composed feature). `catalog/` follows this shape exactly end to end and is
  the cleanest reference: `catalog::compose(store, connections)` builds
  `CatalogUseCases<ScopedCatalogGateway>` from the concrete
  `adapters::local::ScopedCatalogGateway`.
- Three features (`activity/`, `operation_control/`, `safety_settings/`) are
  small enough that they skip a separate `adapters/`/`transport.rs` split:
  the concrete platform adapter struct (e.g. `ActivityPlatformAdapter`) is
  defined inline in `mod.rs` next to `compose(...)`, and their actual
  `#[tauri::command]` handlers live outside this tree, in
  `src-tauri/src/services/`, which calls the composed `*Feature` facade.
- Every feature's public surface is the `Feature` type and `compose(...)`
  function re-exported from its `mod.rs`; most other items are
  `pub(super)`/private to the feature. Do not reach into a sibling feature's
  `adapters` or `domain` internals — depend on its `pub(crate)` re-exports
  (see each feature's own `AGENTS.md` → Dependencies → Internal for the
  actual cross-feature edges observed in code).
- Small cross-feature primitives with no platform dependencies live in
  `../kernel/` (`access`, `identity`, `agent_policy`, `sql_namespace`,
  `sync`, `terminal_authority`) — prefer these over inventing a new
  feature-local identity/authority type.

### Testing Requirements

- `pnpm test:rust` runs `cargo test --package dopedb --lib` (plus
  `dopedb-protocol`/`dopedb-cli` integration tests outside this tree), which
  covers every `#[cfg(test)]` module inside `features/`. Two files here are
  part of the repository's 208-test critical budget
  (`tests/critical-test-budget.json`):
  `providers/adapters/authority_tests.rs` and `queries/domain_tests.rs` — see
  those features' own `AGENTS.md`.

### Common Patterns

- `compose(...) -> XFeature` in each `mod.rs`, e.g.
  `pub(crate) fn compose(store: Store, connections: ConnectionManager) -> CatalogFeature`
  in `catalog/mod.rs`. Bigger features stage composition across two steps
  when a dependency cycle would otherwise exist (see `providers::prepare(..)`
  / `.finish(..)` in `providers/AGENTS.md`).
- A composed application type is a concrete generic instantiation of the
  use-case struct over its adapter types, e.g.
  `type ComposedJobApplication = JobUseCases<JobRepository, RuntimeJobAuthority, LocalJobFiles, JobCatalogAdapter, OperationRuntime, JobWorker, SystemJobGenerator>;`
  in `jobs/mod.rs`.

## Dependencies

### Internal

- `../kernel/` for shared identity/authority/sync primitives.
- Cross-feature edges observed in code: `agents` and `analysis_articles` →
  `knowledge`; `connections` and `jobs` → `catalog`; `knowledge` and
  `providers` → `workspaces`; `scripts` → `catalog`, `queries`; `queries` →
  `agents`, `connections`, `jobs`, `knowledge`, `product_analytics`,
  `workspaces`; `workspaces` → `analysis_articles`, `connections`. Every
  feature's own `AGENTS.md` documents its exact imports.

### External

- Workspace-wide crates most features touch through adapters: `tauri`,
  `sqlx` (Postgres/MySQL/SQLite), `mongodb`, `tokio`, `serde`/`serde_json`,
  `uuid`, `chrono`, `keyring`, `reqwest`, `dopedb-protocol` (shared wire
  types). See `src-tauri/Cargo.toml` for the full, versioned list and each
  feature's own `AGENTS.md` for what it specifically uses.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
