<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/scripts

## Purpose

Transport-neutral multi-statement SQL script execution: proposal
classification, durable receipts for read-only runs, and exact-approved
transactional mutation execution. There is no dedicated `scripts` frontend
feature directory or `transport.rs` here — commands are exposed to the
renderer from `src/features/queries/tauriAdapter.ts` (`run_script`,
`propose_script`), reusing the desktop SQL proposal/execution boundary owned
by `queries`.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Transport-neutral multi-statement SQL script execution (module root). |
| `application.rs` | Script use cases independent of concrete storage, pool, and operation adapters. |
| `ports.rs` | Platform contract required by Script application use cases. |
| `proposal.rs` | Immutable multi-statement proposal classification and persistence. |
| `read_execution.rs` | Read-only multi-statement execution with durable receipts. |
| `write_execution.rs` | Exact-approved transactional script mutation execution. |
| `execution.rs` | Shared execution-claim/dispatch logic between read and write paths. |
| `helpers.rs` | Script result projection, transaction execution, and audit/history recording. |

## For AI Agents

### Working In This Directory

- A script's classification (read-only vs. mutating) is decided once in
  `proposal.rs` and must not be re-derived differently in
  `read_execution.rs`/`write_execution.rs`; a mutation must always go
  through the exact-approved path in `write_execution.rs`.
- There is no local `transport.rs`; new commands are wired through
  `crate::features::queries::transport` and the frontend
  `src/features/queries/tauriAdapter.ts` — keep both in sync rather than
  adding a second, feature-local transport.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

## Dependencies

### Internal

- Imports `crate::features::{catalog, queries}` and
  `crate::kernel::{access, agent_policy}`.
- No other `features/*` module imports this one.

### External

- `sqlparser`, `sqlx`.
- No dedicated frontend adapter directory; invoked from
  `src/features/queries/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
