<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/operations

## Purpose
Single owner of the operation-approval command names (`approve_operation`,
`reject_operation`) shared across SQL execution, jobs, monitoring, and provider
provisioning. Any feature that proposes a gated operation (a write, a monitoring
role change, a provisioning step) routes its approve/reject action through this
adapter instead of re-declaring the command literal itself.

## Key Files
| File | Description |
|------|-------------|
| `tauriAdapter.ts` | `approveOperation`/`rejectOperation` — the shared operation-decision command adapter. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- Do not add a second place in the frontend that calls `invoke("approve_operation" \| "reject_operation", ...)`;
  every caller (queries, tableData, monitoring, providers) must import from here.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- Both exports pass an optional `reason` through as `reason ?? null`, matching the
  Rust side's `Option<String>` field.

## Dependencies

### Internal
- `../../ipc/types` — `OperationDecision`.
- Consumed by `../monitoring`, `../queries` (`useSqlWorkbenchController.ts`), and
  other features that propose gated operations.

### External
- No dedicated Rust `transport.rs`. `approve_operation`/`reject_operation` are
  `#[tauri::command]`s in `src-tauri/src/commands/mod.rs` calling
  `state.services.operation`, composed from `src-tauri/src/features/operation_control/`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
