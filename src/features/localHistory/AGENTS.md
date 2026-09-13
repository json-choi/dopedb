<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/localHistory

## Purpose
Renders the SQL revision-history tool window: lets a user browse a document's past
revisions and restore one, then return explicitly to the Explorer surface. It owns
no IPC of its own — it reads and restores revisions entirely through the
`sqlDocuments` feature's gateway, so it must not duplicate document/revision command
names or bypass that gateway with a direct `invoke`.

## Key Files
| File | Description |
|------|-------------|
| `LocalHistoryToolWindow.tsx` | SQL revision selection and restoration tool window, with an explicit return to Explorer. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- Revision listing and restoration go through `tauriSqlDocumentGateway` from
  `../sqlDocuments/tauriAdapter`; do not call `invoke` directly here.
- Depends on `WorkbenchDocument` (`../workbench/domain`) narrowed to the `"sql"` kind
  and on `ConnectionProfile` (`../connections/domain`) — treat both as read-only
  inputs supplied by the caller.

### Testing Requirements
- No test file exists in this directory; it is not part of the `pnpm test` smoke
  suite or the 208-test budget.

### Common Patterns
- Single default-export screen-level component (`LocalHistoryToolWindow.tsx`),
  consistent with the "one main artifact → default export" rule.

## Dependencies

### Internal
- `../sqlDocuments` — `SqlDocumentRevision`/`SqlDocumentRevisionPage` domain types
  and the `tauriSqlDocumentGateway`.
- `../workbench` — `WorkbenchDocument` type.
- `../connections` — `ConnectionProfile` type.
- `../../design-system/components/*`, `../../components/Icon`, `../../lib/i18n`.

### External
- No dedicated Rust module. Backed indirectly by `src-tauri/src/features/sql_documents/transport.rs`
  through the `sqlDocuments` gateway (`list_sql_document_revision_page`,
  `get_sql_document_revision`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
