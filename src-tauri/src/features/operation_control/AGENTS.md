<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/operation_control

## Purpose

Desktop-only exact-hash approval orchestration for durable Operations. The
service derives the approver and current policy from the active scope;
Tauri callers may supply only an operation id, the payload hash rendered to
the user, and an optional human reason — it is the trusted boundary that
turns a rendered confirmation into an approve/reject decision, and also
exposes Terminal-scoped show/wait/cancel over one operation. It does not
define its own `adapters/` or `transport.rs`: the concrete platform adapter
is defined inline in `mod.rs`, and the actual `#[tauri::command]` handlers
live outside this tree, in `src-tauri/src/services/`.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | `OperationDecisionRequest`/`OperationDecisionReceipt` DTOs; inline `OperationPlatformAdapter` (wraps `Store`, `ConnectionManager`, `OperationRuntime`); `OperationControlFeature` facade (`recover_previous_runtimes`, `approve_local`, `reject_local`, `show_terminal`, `wait_terminal`, `cancel_terminal`); `compose(store, connections, runtime)`. |
| `application.rs` | Operation-control use cases independent of concrete persistence and runtime adapters. |
| `ports.rs` | Platform contract (`OperationControlPort`) required by Operation-control use cases. |

## For AI Agents

### Working In This Directory

- `approve_local`/`reject_local` must re-derive the expected confirmation
  phrase and current policy revision from the live connection pin at
  decision time (see `exact_request` in `mod.rs`) — never trust a
  caller-supplied policy revision or approver.
- `show_terminal`/`wait_terminal`/`cancel_terminal` must verify the
  operation's `TerminalAuthority` (session id, workspace, account scope,
  connection id/revision) before returning or acting on it
  (`ensure_terminal_scope`).

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

### Common Patterns

- Same inline-adapter shape as `activity/` and `safety_settings/`:
  `compose(store, connections, runtime) -> OperationControlFeature` builds
  `OperationUseCases<OperationPlatformAdapter>` without a separate
  `adapters/` module.

## Dependencies

### Internal

- Uses `crate::operations` (`ExactApprovalRequest`, `OperationRuntime`,
  `RestartRecoveryReport`, policy helpers) and `crate::kernel::TerminalAuthority`
  — both outside `features/`.
- No other `features/*` module imports this one; it is consumed by
  `src-tauri/src/services/`.

### External

- `dopedb-protocol` (`OperationState`, `OperationSummary`), `tokio` (timeout
  polling in `wait_terminal`).
- Frontend adapter: `src/features/operations/tauriAdapter.ts` (approval
  decisions shared across SQL, jobs, monitoring, and provider provisioning).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
