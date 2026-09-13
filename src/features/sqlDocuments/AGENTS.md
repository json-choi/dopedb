<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

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
| `useSqlDocumentAutosave.ts` | Autosave state machine for one persisted SQL document: debounce, local recovery, optimistic revision-conflict handling, and stale-async-response suppression. |

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
