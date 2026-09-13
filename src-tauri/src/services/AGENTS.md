<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/services

## Purpose

Application feature composition shared by Tauri and the local CLI Broker.
Runtime behavior and DTO ownership live in `../features/*`; this module only
wires concrete adapters into one cloneable application facade so both the
Desktop app and the Broker construct features identically.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Defines `ApplicationServices`, a `Clone`-able facade holding one composed instance of every feature (`activity`, `agents`, `analysis_article`, `connections`, `catalog`, `document`, `erd`, `job`, `knowledge`, `monitoring`, `operation`, `providers`, `product_analytics`, `queries`, `safety`, `script`, `sql_documents`, `workspace`). `ApplicationServices::with_providers` composes them all from one `Store`, `ConnectionManager`, `OperationRuntime`, and `ProvidersFeature`, so every clone shares the same store and scope-aware connection runtime — one authority boundary per process. |

## For AI Agents

### Working In This Directory

- A new feature that needs cross-feature composition gets a field here and a
  `compose(...)` call in `with_providers`, using the same `store`/`connections`
  clones already threaded through — do not construct a second `Store` or
  `ConnectionManager` for it.
- This module intentionally contains no business logic of its own; put new
  behavior in the feature's `features/<feature>/application.rs`, not here.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block here today.

## Dependencies

### Internal

- Composes nearly every module under `../features/*`, plus `../connection`,
  `../operations`, and `../store`. Consumed by `../state.rs` (`AppState`) and
  `../broker/dispatch` (the CLI Broker's handlers).

### External

- None beyond what the composed features already depend on.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
