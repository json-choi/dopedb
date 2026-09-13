<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/Documents

## Purpose
Ad-hoc read-only document query console for MongoDB connections — the
"documents" tab's counterpart to the SQL console. `find`/`aggregate`/`count`
queries are built from JSON textareas, parsed client-side, then run through a
durable single-use read plan on the backend.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `Documents` screen: query-shape picker, JSON input, result grid via `features/documentQueries`. |

## For AI Agents

### Working In This Directory
- Mounted both as a standalone document kind (`WorkbenchDocument.kind ===
  "documents"`) and as the default content for a selected non-SQL connection
  in `WorkbenchContent.tsx`.
- Calls `proposeDocumentQuery` / `runDocumentQuery` from
  `features/documentQueries/tauriAdapter` and reads through `catalogQuery` /
  `useCatalogScope` (`src/lib/queries.ts`) — no direct `invoke` for catalog
  data.
- Manual UI check: run `pnpm dev:app` against a MongoDB (or document-engine)
  connection and exercise find/aggregate/count.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` and `pnpm build`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
