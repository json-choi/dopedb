<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/SchemaDiff

## Purpose
Group schema comparison workspace. Reads only the baseline and the selected
comparison database, live, through the shared per-database catalog entry when
the screen opens (and on explicit reread), shows each side's read time, and
exposes object-level before/after details — without coupling the comparison
workflow to Database Explorer sidebar expansion state. Per `docs/PRODUCT_UI_SCOPE.md`, the CLI's `schema diff` and a
Project-pinned Agent's `schema_diff` reuse this same read-only comparison.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `SchemaDiff` screen: member-scoped baseline selection (`features/catalogExplorer/schemaDiffBaseline`), live baseline/target reads via `useQueries`, read times, failed-reread notice with retry, status filter, diff summary. |
| `SchemaDiffResults.tsx` | Read-only `SchemaDiffResults` list, grouped by `schema.table` relation and windowed through `VirtualTreeRows`; before/after definitions stay visible and text-selectable. Also exports `STATUS_LABELS`. |

## For AI Agents

### Working In This Directory
- Mounted by `WorkbenchContent.tsx` when `route.activeSchemaGroup` is set
  (keyed by `group.key`), receiving the `SchemaConnectionGroup` and an
  `onClose` callback.
- Diff logic (`compareCatalogs`, `defaultSchemaBaseline`, `diffCounts`,
  `schemaGroupIsCompatible`) lives in `src/lib/schemaDiff.ts`, not in this
  screen — this directory only presents results and drives baseline/reread
  UI over `databaseCatalogSnapshotQuery` from `src/lib/catalogQueries.ts`. Only a
  live read since the screen opened decides the comparison; a persisted snapshot
  is labelled as saved and never compared.
- Manual UI check: run `pnpm dev:app`, open a schema group's diff view from
  Database Explorer.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` and `pnpm build`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
