<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-19 -->

# src/features/workbench

## Purpose
Workbench document-strip state: which SQL/table/other documents are open, which is
active, and unsaved-draft tracking. Stable ids describe singleton resources while
query documents use unique ids and retain their connection scope. It has no IPC of
its own — persistence is delegated to `../sqlDocuments`.

## Key Files
| File | Description |
|------|-------------|
| `domain.ts` | `WorkbenchDocument` union and id helpers (`stableDocument`, `queryDocument`, `persistedQueryDocument`, `sqlRecoveryKey`-based ids). |
| `draftStore.ts` | `useSyncExternalStore`-based unsent-draft cache, capped at `MAX_RETAINED_DRAFTS` (64), evicting entries with no active listeners first. |
| `openTabs.ts` | Member-local open-tab record (list, order, active tab) per workspace/account/connection, plus `restorableOpenTabs`, which decides what may reopen after a document list response. |
| `state.test.ts` | Renders workbench state against a real schema-diff fixture and SQL parameter/catalog helpers to validate the document strip state machine. |
| `state.ts` | Pure state machine for the workbench document strip; React effects/handlers dispatch commands here instead of mutating the document array in multiple places. |
| `useWorkbenchDocuments.ts` | Single writer for workbench document state; coordinates connection changes, persisted SQL restoration, tab commands, and optimistic save projections. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- `state.ts` is the single source of truth for document-strip transitions; do not
  mutate a `WorkbenchDocument[]` array directly from a screen or hook — dispatch
  through this state machine instead (repo-wide "single writer" rule).
- `useWorkbenchDocuments.ts` is documented as "the" single writer for workbench
  document state — do not add a second hook that also owns document lifecycle.
- `draftStore.ts` only evicts a draft with zero active listeners; do not change
  eviction to drop a draft a component still has mounted.
- Closing a tab is not deleting a document: `restoreSql` reopens only the ids in
  the member-local record (`openTabs.ts`), never the whole `list()` result. A
  missing record means a first run and restores everything; a stored empty list
  means the member closed everything and must stay empty.
- `useWorkbenchDocuments.ts` writes that record only after a connection's restore
  has settled, so an initial placeholder document can never overwrite what the
  member left open.

### Testing Requirements
- `state.test.ts` is part of the `pnpm test` smoke suite
  (`vitest run src/features/workbench/state.test.ts`) and counts against the
  208-test budget; extend it rather than adding a new top-level test file. It
  reads `dopedb-protocol/tests/fixtures/schema-diff-v1.json` as a fixture.

### Common Patterns
- Document ids distinguish "stable" (singleton) vs. "unique, connection-scoped"
  documents — preserve that distinction when adding a new document kind.

## Dependencies

### Internal
- `../sqlDocuments` — `SqlDocument`, `SqlDocumentGateway`, `sqlRecoveryKey`.
- `../queries` — `DEFAULT_SQL_RESOLVE_MODE`, `SqlResolveMode`.
- `../catalog` — `catalogFromSnapshot` (test only).
- `../../lib/tableRef` — `tableKey`.
- `../../ipc/types` — `CatalogTable`.

### External
- No dedicated Rust module; this feature has no `tauriAdapter.ts` and issues no
  direct `invoke` calls.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
