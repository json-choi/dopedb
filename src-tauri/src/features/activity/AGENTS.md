<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/activity

## Purpose

Transport-neutral reads of the append-only audit chain and execution history
for one connection. This feature only verifies and paginates; it never writes
audit or history entries (those are recorded by the features that perform the
audited action, e.g. `queries`, `scripts`, `monitoring`). It does not define
its own `adapters/` or `transport.rs`: the concrete platform adapter and the
actual `#[tauri::command]` handlers live outside this tree, in
`src-tauri/src/services/`.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | `AuditVerdict`, `AuditPageRequest`, `HistoryPageRequest` DTOs; the inline `ActivityPlatformAdapter` (wraps `Store`); `ActivityFeature` facade; `compose(store)`. |
| `application.rs` | `ActivityUseCases<P: ActivityPort>` — audit verification and audit/history pagination, independent of the concrete `Store`. |
| `ports.rs` | `ActivityPort` trait required by the use cases (verify audit, audit page/entry, history page/entry). |

## For AI Agents

### Working In This Directory

- No `domain.rs`: DTOs (`AuditVerdict`, `AuditPageRequest`, `HistoryPageRequest`) live directly in `mod.rs` since this feature only projects `crate::model` audit/history types, it does not own new domain invariants.
- `ActivityPlatformAdapter` delegates straight to `crate::audit::verify_chain`/`page_after`/`entry` and `Store::list_history_page`/`get_history_entry`; keep any new audit/history query here rather than duplicating chain-walking logic in a transport layer.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

### Common Patterns

- `compose(store: Store) -> ActivityFeature` in `mod.rs` follows the same
  shape as other features, but wires the inline `ActivityPlatformAdapter`
  instead of a separate `adapters/` module.

## Dependencies

### Internal

- `crate::audit` (chain verification, paging) and `crate::store::Store`
  (history queries) — both outside `features/`.
- No other `features/*` module imports this one; it is consumed by
  `src-tauri/src/services/`.

### External

- `serde`, `uuid`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
