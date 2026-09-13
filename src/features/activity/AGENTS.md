<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/activity

## Purpose

Read-only access to the connection-scoped audit log and query/history feed.
This feature is a single IPC adapter with no domain types, state, or UI of its
own — callers own presentation and paging state.

## Key Files

| File | Description |
|------|-------------|
| `tauriAdapter.ts` | `auditVerify`, `listAuditPage`, `getAuditEntry`, `listHistoryPage`, `getHistoryEntry` — thin wrappers over `invoke()` for the audit and history commands. |

## For AI Agents

### Working In This Directory

- Backend commands (`audit_verify`, `list_audit_page`, `get_audit_entry`,
  `list_history_page`, `get_history_entry`) are dispatched through
  `src-tauri/src/commands/mod.rs`, not a per-feature `transport.rs` — this
  feature has no `src-tauri/src/features/activity/transport.rs` file, only
  `application.rs`/`ports.rs`. Keep new command names in sync with that
  dispatcher rather than assuming a matching transport module exists.
- This is an audit/history *reader*; it must not gain a write path — auditing
  and history integrity depend on nothing outside the Rust core mutating these
  records.

### Testing Requirements

- No test file here; not part of `pnpm test` or the 208-test budget.

### Common Patterns

- Cursor-based paging: `listAuditPage`/`listHistoryPage` take a
  `{ rowId } | null` cursor and return a `*Page` type, consistent with other
  paged adapters in the codebase.

## Dependencies

### Internal

- `src/ipc/core` (`invoke`), `src/ipc/types` (`AuditEntryDetail`, `AuditPage`,
  `AuditVerdict`, `HistoryEntryDetail`, `HistoryPage`, `HistoryPageRequest`).
- Backend: `src-tauri/src/features/activity/{application.rs,ports.rs}` plus
  the shared `src-tauri/src/commands/mod.rs` dispatcher (no `transport.rs`).

### External

- None beyond the Tauri IPC bridge.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
