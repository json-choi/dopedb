<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/queryResults

## Purpose
Shared results-grid rendering: a plain `DataGrid` and a windowed `DataGridVirtual`
for large result sets, plus toolbar/export chrome. `DataGrid` renders whatever rows
it is handed — callers window/cap the data first — so plain read-only callers (SQL
results, document results, Analysis Article results) all render unchanged; every
interactive behavior (sort, filter, row/cell selection) is opt-in via callback
props. This directory has no IPC of its own.

## Key Files
| File | Description |
|------|-------------|
| `DataGrid.tsx` | Shared results table: sticky header, row numbers, null styling, opt-in sort/filter/selection callbacks, drag-resizable columns. |
| `DataGridColumnFilterMenu.tsx` | Compact value/count filter popup opened from a `DataGrid` header filter action. |
| `DataGridVirtual.test.ts` | Tests virtualization windowing and cell-selection helpers together with `../../lib/sqlBuild` grid query building. |
| `DataGridVirtual.tsx` | Windowed row-and-column renderer for large query results; only cells intersecting the viewport (+ small overscan) enter the DOM. |
| `ResultToolbar.tsx` | Compact export/copy controls for any result grid; every action operates on the full result rows, not just the visible window. |
| `ResultWorkbench.tsx` | Toolbar/footer chrome (`ResultWorkbenchToolbar`, status pill) wrapping a result grid in the workbench layout. |
| `dataGridKeyboard.ts` | Shared composite-grid keyboard/focus model; the first composite column is the row header, data columns follow at indices 1..N. |
| `dataGridSelection.ts` | Grid cell/range selection types and helpers (anchor/focus coordinates). |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- Keep `DataGrid`/`DataGridVirtual` interactivity strictly opt-in via props; do not
  add a behavior that fires without a caller-supplied callback, since read-only
  consumers (Analysis Article rendering) depend on inert-by-default behavior.
- `dataGridKeyboard.ts`'s row-header-at-index-0 convention is shared by both
  renderers — do not let one renderer diverge from the other's coordinate model.

### Testing Requirements
- `DataGridVirtual.test.ts` is part of the `pnpm test` smoke suite
  (`vitest run src/features/queryResults/DataGridVirtual.test.ts`) and counts
  against the 208-test budget; extend it rather than adding a new top-level test file.

### Common Patterns
- Export/copy actions in `ResultToolbar.tsx` pull from `../queries/resultPageCache`
  (`collectCachedSqlResultRows`) rather than re-reading the backend.

## Dependencies

### Internal
- `../queries` — `SqlStreamRowSource`, `resultPageCache`, `tauriAdapter` (`exportSqlResult`).
- `../../lib/sqlBuild`, `../../lib/gridValueFilter`.
- `../../ipc/types` — `QueryResult`, `CatalogTable`.

### External
- No dedicated Rust module; consumes data already fetched through `../queries`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
