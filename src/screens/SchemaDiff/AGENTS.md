<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/SchemaDiff

## Purpose
Group schema comparison workspace. Loads every group member through the
shared catalog query cache, summarizes all comparison targets against one
baseline connection, and exposes object-level before/after details — without
coupling the comparison workflow to Database Explorer sidebar expansion
state. Per `docs/PRODUCT_UI_SCOPE.md`, the CLI's `schema diff` and a
Project-pinned Agent's `schema_diff` reuse this same read-only comparison.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `SchemaDiff` screen: baseline selection, per-member catalog fetch via `useQueries`, status filter, diff summary. |
| `SchemaDiffResults.tsx` | Read-only `SchemaDiffResults` list, grouped by relation; before/after definitions stay visible and text-selectable. Also exports `STATUS_LABELS`. |

## For AI Agents

### Working In This Directory
- Mounted by `WorkbenchContent.tsx` when `route.activeSchemaGroup` is set
  (keyed by `group.key`), receiving the `SchemaConnectionGroup` and an
  `onClose` callback.
- Diff logic (`compareCatalogs`, `defaultSchemaBaseline`, `diffCounts`,
  `schemaGroupIsCompatible`) lives in `src/lib/schemaDiff.ts`, not in this
  screen — this directory only presents results and drives baseline/refresh
  UI (`fetchFreshCatalog`, `replaceFreshCatalog` from `src/lib/queries.ts`).
- Manual UI check: run `pnpm dev:app`, open a schema group's diff view from
  Database Explorer.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` and `pnpm build`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
