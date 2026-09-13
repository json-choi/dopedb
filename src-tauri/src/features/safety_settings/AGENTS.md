<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/safety_settings

## Purpose

Per-connection safety settings (row caps, execution preview row limit,
write/schema-change gates). Shared write policy is projected by the server
rather than widened by this member-local settings surface: a limits-only
edit must never drain a live connection, while an actual write-gate change
retires the cached pool afterward. It does not define its own `adapters/` or
`transport.rs`: the concrete platform adapter is defined inline in `mod.rs`,
and the actual `#[tauri::command]` handlers live outside this tree, in
`src-tauri/src/services/`.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Inline `SafetyPlatformAdapter` (wraps `Store`, `ConnectionManager`); `SafetySettingsFeature` facade (`get`, `update`); `compose(store, connections)`. `update` clamps `max_rows` to 1..100,000 and `exec_preview_row_limit` to 0..1,000,000, downgrades `allow_writes`/`allow_schema_changes` per credential mode/engine/workspace-access rules, and retires the connection pool only when the write policy actually changed. |
| `application.rs` | Safety settings use cases independent of concrete storage and connection adapters. |
| `ports.rs` | Authority and persistence contract (`SafetySettingsPort`) required by Safety settings use cases. |

## For AI Agents

### Working In This Directory

- `update` must never let a managed connection's `allow_writes` exceed the
  server-projected `profile.allow_writes`/`workspace_access.can_write()`, and
  `allow_schema_changes` must never exceed `allow_writes` or the
  Neon/GCP-Cloud-SQL-Postgres-only managed-schema allowance — preserve these
  clamps exactly when touching this method.
- Only retire (`operation_scope.retire_connection`) the connection pool when
  `write_policy_changed` is true; a pure row-limit edit must not drop a live
  connection.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

### Common Patterns

- Same inline-adapter shape as `activity/` and `operation_control/`:
  `compose(store, connections) -> SafetySettingsFeature` builds
  `SafetyUseCases<SafetyPlatformAdapter>` without a separate `adapters/`
  module.

## Dependencies

### Internal

- Uses `crate::connection::{ConnectionAccess, ConnectionManager}` and
  `crate::store::Store` — both outside `features/`.
- No other `features/*` module imports this one; it is consumed by
  `src-tauri/src/services/`.

### External

- None beyond the workspace-wide `uuid`.
- Frontend adapter: `src/features/safetySettings/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
