<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/documents

## Purpose

Transport-neutral, typed read-only document queries against MongoDB. The
service owns the authority pin, read-only classification, row cap,
execution, audit, and history lifecycle; adapters receive only allowlisted
display/result DTOs, and connection profiles and credential references never
cross this boundary. There is deliberately no document write transport in
the Desktop product.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Transport-neutral, typed document reads for MongoDB (module root and the invariants above). |
| `application.rs` | Typed Document read use cases independent of concrete storage and pool adapters. |
| `ports.rs` | Platform contract required by typed Document read use cases. |
| `desktop_plan.rs` | Immutable desktop document-read planning. |
| `desktop_run.rs` | Desktop document-read execution by durable operation identity. |
| `terminal_read.rs` | Terminal-scoped typed MongoDB read execution. |
| `recording.rs` | Shared document row bounds, policy projection, audit, and history recording. |

## For AI Agents

### Working In This Directory

- No `domain.rs`/`adapters/`/`transport.rs` split: this feature's use cases
  are typed directly against MongoDB reads and composed inline; do not add a
  write path here — the product intentionally has none for documents.
- Row-cap and read-only classification live in `recording.rs`; reuse it
  rather than re-deriving bounds in `desktop_run.rs` or `terminal_read.rs`.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

## Dependencies

### Internal

- Imports `crate::kernel::{access, agent_policy}` (Terminal-originated Agent
  read capability limits).
- No other `features/*` module imports this one.

### External

- `mongodb`.
- Frontend adapter: `src/features/documentQueries/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
