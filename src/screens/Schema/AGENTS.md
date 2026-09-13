<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/Schema

## Purpose
Catalog V2 schema explorer. A React Flow/ELK canvas owns the relationship
diagram while the inspector and structured editor consume the same
fingerprint-pinned catalog metadata, so the diagram and detail panel never
disagree about which schema revision they show.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `SchemaExplorer` (imported as `SchemaExplorer` in `WorkbenchContent.tsx`): overview/full-catalog loading, search, ERD canvas host, table inspector. |
| `detailLifecycle.ts` | `schemaDetailsEnabled(requested, scopeReady)` — full metadata load is an explicit user action, never a side effect of connection selection. |

## For AI Agents

### Working In This Directory
- Mounted as the `activeDocument.kind === "schema"` document in
  `WorkbenchContent.tsx`, receiving `connection`, `selectedTable`, and
  `onOpenTable`.
- The ERD canvas (`features/erd/ErdCanvas`) is `lazy()`-loaded from this
  screen — keep it behind `Suspense` rather than importing it eagerly.
- Reads go through `catalogOverviewQuery`, `catalogQuery`,
  `catalogSnapshotQuery`, `useCatalogScope` (`src/lib/queries.ts`); do not add
  a raw `invoke` fetch here.
- Respect `detailLifecycle.ts`'s `schemaDetailsEnabled` gate — do not trigger a
  full-catalog fetch merely because a connection became selected.
- Manual UI check: run `pnpm dev:app`, open a connection's Schema tab, and
  confirm the ERD renders and the inspector matches the diagram's revision.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` and `pnpm build`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
