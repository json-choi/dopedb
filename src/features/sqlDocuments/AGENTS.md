<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-19 -->

# src/features/sqlDocuments

## Purpose
Persisted SQL document domain: branded ids, revisions, autosave, and the port
contract other features (`localHistory`, `workbench`) depend on instead of
importing Tauri `invoke` directly. `domain.ts` states branded ids exist so a
workspace, connection, and document string cannot be passed to the wrong feature
command by accident. `tauriAdapter.ts`'s header calls itself "the only frontend
file that knows the four SQL document command names" (list, create, save, delete —
plus revision reads).

## Key Files
| File | Description |
|------|-------------|
| `domain.ts` | Branded `ConnectionId`/`SqlDocumentId` and the SQL document/revision domain types. |
| `ports.ts` | `SqlDocumentGateway` port contract; application state depends on this rather than importing `tauriAdapter.ts`/`invoke` directly. |
| `tauriAdapter.ts` | Sole owner of the SQL document command names (`list_sql_documents`, `list_sql_document_revision_page`, `get_sql_document_revision`, `create_sql_document`, `save_sql_document`, `delete_sql_document`); implements `tauriSqlDocumentGateway: SqlDocumentGateway`. |
| `pendingSaves.ts` | Registry of the mounted editor's pending save, keyed by document id, so closing a tab can await the debounced write instead of dropping it with the unmounted editor. |
| `queries.ts` | TanStack Query options for a connection's saved SQL documents, used by the Action Search reopen command. |
| `useSqlDocumentAutosave.ts` | Autosave state machine for one persisted SQL document: debounce, local recovery, optimistic revision-conflict handling, stale-async-response suppression, and the `flushPendingSave` that a tab close awaits. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- Other features must depend on `SqlDocumentGateway` (`ports.ts`), not on
  `tauriAdapter.ts` directly — `../localHistory` and `../workbench` already follow
  this; keep new consumers consistent.
- `tauriAdapter.ts` is explicitly the *only* place that should reference the four
  (plus revision) SQL document command name literals; do not add a second
  `invoke("...sql_document...")` call site elsewhere.
- `useSqlDocumentAutosave.ts` must keep suppressing stale async responses so a
  slow save response cannot overwrite a newer local edit; preserve its
  optimistic-revision-conflict handling when touching it.
- Closing a document tab never calls `delete`. `pendingSaves.ts` exists so the
  close path finishes the editor's debounced write and reports a failure instead
  of discarding it; do not make that flush silent or optional.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- Branded id constructors (`connectionId(value)`, `sqlDocumentId(value)`) are the
  only sanctioned way to produce these types; do not cast a raw string elsewhere.

## Dependencies

### Internal
- `../queries` — `SqlResolveMode` (`resolveMode.ts`).
- Consumed by `../localHistory` (`tauriSqlDocumentGateway`) and `../workbench`
  (`SqlDocumentGateway`, domain types).

### External
- Rust: `src-tauri/src/features/sql_documents/transport.rs` (also `adapters.rs`,
  `application.rs`, `domain.rs`, `ports.rs`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
