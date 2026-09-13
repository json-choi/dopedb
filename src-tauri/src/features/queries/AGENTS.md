<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/queries

## Purpose

SQL Query use cases for desktop and authenticated Terminal/Agent workflows:
inspection, proposal, execution, cancellation, streaming with backpressure,
manual transactions, and audit/history recording. This is the composition
boundary between the safety pipeline (classification, approval), the durable
Operation ledger, and the concrete database executors — domain/application
code stays independent of persistence and pool adapters.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | `QueriesFeature` facade (propose/inspect/run desktop SQL, desktop SQL streaming with ACK/pull/cancel/export, Terminal plan/prepare, Agent-proposal review, manual-transaction access, query-service session persistence); `compose(store, connections, operation)`. |
| `domain.rs` | SQL query contracts and pure planning guidance; values deliberately contain only typed identities and allowlisted display data — platform persistence, pool handles, and protocol UUID conversion stay in adapters. |
| `application.rs` | SQL query use cases (`QueryUseCases<P: QueryPlatformAdapter-shaped port>`), independent of persistence and pool adapters. |
| `ports.rs` | Ports through which SQL query use cases reach platform adapters. |
| `transport.rs` | Tauri transport for desktop SQL query use cases. |
| `manual_transaction.rs` | Connection-scoped manual SQL transactions; a session owns one physical SQLx connection plus the exact connection lease that authorized it, so desktop SQL, table edits, and connection-pinned Agent commands can share one rollback boundary without exposing credentials/handles to the renderer or CLI. |
| `manual_transaction_execution.rs` | Engine-specific manual transaction query and script execution. |
| `manual_transaction_session.rs` | Manual transaction connection and session state machines. |
| `domain_tests.rs` | **Part of the 208-test critical budget** (`tests/critical-test-budget.json`, 1 test): protects production guidance, namespace safety, current Services result shape, ephemeral table-page retention, fail-closed Skill install/conflict handling, credential-free Agent CLI probing, official ACP model/permission-mode allowlists without default escalation, secret-free typed connection-test receipts, and redacted non-retryable timeout/cancellation classification across query, Article, and target operations. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | Concrete desktop and Terminal SQL platform adapters (flat, 19 files, no further nesting). |

**`adapters/`**

| File | Description |
|------|-------------|
| `mod.rs` | Concrete platform adapters for desktop and authenticated Terminal SQL Query workflows (module root). |
| `platform.rs` | Shared local platform dependencies for desktop and Terminal SQL adapters. |
| `desktop_port.rs` | Desktop query port implementation backed by the local platform adapter. |
| `desktop_contracts.rs` | Desktop SQL adapter contracts, lease-backed receipts, and error projections. |
| `desktop_planning.rs` | Durable desktop and Terminal SQL proposal planning adapter operations. |
| `desktop_inspection.rs` | Atomic desktop SQL inspection with one authority and policy snapshot. |
| `desktop_execution.rs` | Desktop SQL execution, cancellation, audit, history, and outcome reconciliation. |
| `desktop_provenance.rs` | Best-effort desktop query audit and history persistence. |
| `desktop_support.rs` | Shared desktop SQL policy, preview, and read-streaming support. |
| `desktop_stream_registry.rs` | Single-writer, capability-bound pull/ACK backpressure for desktop SQL streams. |
| `desktop_stream_lifecycle.rs` | Owned, bounded cleanup for an aborted desktop SQL stream task. |
| `desktop_result_store.rs` | Private, capability-bound disk storage for desktop SQL result pages; rows never enter the application SQLite database, audit/history, or a renderer-owned aggregate — each page is an independently bounded JSON file, and the immutable manifest publishes only after the producer receipt matches every page written. |
| `desktop_result_files.rs` | Capability-bound result manifest, page, and retention file operations. |
| `desktop_result_benchmark.rs` | Packaged result-store benchmark fixtures and cancellable export probes (`packaged-benchmark` cargo feature). |
| `desktop_trace.rs` | Stable, low-cardinality phase names for desktop SQL stream observability; deliberately never record SQL text, result values, capabilities, or connection credentials. |
| `terminal_plan.rs` | Concrete planning adapter for immutable Terminal SQL-read capabilities. |
| `terminal_run.rs` | Claiming and executing one Terminal-bound, single-use SQL-read plan. |
| `terminal_support.rs` | Persistence and safety helpers shared by Terminal query planning and execution. |
| `errors.rs` | Platform error and guard-bearing failure receipts for Terminal query adapters. |

## For AI Agents

### Working In This Directory

- Result rows must stay inside `adapters/desktop_result_store.rs`'s bounded,
  capability-scoped page files — never route a row into the application
  SQLite database, audit/history, or a renderer-owned aggregate.
- `adapters/desktop_trace.rs` phase identifiers must stay low-cardinality and
  free of SQL text, result values, capabilities, or credentials; do not log
  richer data through this path.
- Stream cancellation must reserve/close the stream registry
  (`desktop_stream_registry.rs`) before the durable operation reaches a
  terminal state, so a policy/authorization failure cannot strand a
  pre-ready credit (see `run_desktop_sql_stream` in `mod.rs`).
- A Terminal-bound SQL-read plan (`adapters/terminal_plan.rs`) is single-use;
  `terminal_run.rs` claims it exactly once.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`). `domain_tests.rs`
  is part of the repository's 208-test critical budget — replace a
  lower-value test rather than adding a new one there without an explicit
  user request.

### Common Patterns

- `compose(store, connections, operation) -> QueriesFeature` wires a single
  `QueryPlatformAdapter` (from `adapters/`) into `QueryUseCases`, plus
  side-channel runtime state (`DesktopSqlStreamRegistry`,
  `DesktopStreamCleanupRuntime`, `ManualTransactionRuntime`) that isn't part
  of the generic port because it must be shared with `mod.rs`'s own methods.

## Dependencies

### Internal

- Imports `crate::features::{agents, connections, jobs, knowledge, product_analytics, workspaces}`
  and `crate::kernel::{access, agent_policy, identity, sync}`.
- Imported by `crate::features::scripts` (shares the desktop SQL proposal/
  execution boundary for multi-statement scripts).

### External

- `sqlx`, `sqlparser`, `sqlformat`, `tokio`, `dashmap`.
- Frontend adapter: `src/features/queries/tauriAdapter.ts` — also has 13
  tests in the 208-test critical budget
  (`src/features/queries/tauriAdapter.test.ts`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
