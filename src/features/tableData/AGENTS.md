<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/tableData

## Purpose
Table data browsing/editing state for the catalog-backed data grid: cell selection,
row editor (insert/edit/duplicate), staged writes, and filter/sort state for a
single table view. Proposed edits go through the shared script-proposal/approval
path (`propose_table_changes` → `../operations` approval), not a direct write.

## Key Files
| File | Description |
|------|-------------|
| `catalogTable.ts` | Upgrades a navigation-only `CatalogTable` reference to its full catalog entry once the catalog query resolves. |
| `domain.ts` | `RowEditorState`, `SelectedCell`, `StagedWrite`, and `TableDataState` types. |
| `state.ts` | Reducer (`useReducer`) for table view state: reset, patch, filter, settle filters, cycle sort, stage. |
| `tableState.ts` | Shared table-query timing/equality policy: `FILTER_DEBOUNCE_MS` (250), `TABLE_PAGE_SIZE` (100), `sameFilters`. |
| `tauriAdapter.ts` | `proposeTableChanges` — the sole command this feature owns (`propose_table_changes`). |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- A staged write (`StagedWrite`) must go through `proposeTableChanges` and the
  `../operations` approval flow before it runs; do not add a path that executes a
  table edit without a proposal/approval step.
- `proposeTableChanges` requires a non-empty `statements` array and a
  `catalogFingerprint`; the Rust handler rejects an empty batch and this frontend
  should not attempt to bypass that guard.
- Keep `tableState.ts`'s debounce/page-size constants as the single source for grid
  timing so other table surfaces stay consistent.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- `state.ts` follows the "reducer as single writer" convention: screens dispatch
  actions rather than mutating `TableDataState` fields directly.

## Dependencies

### Internal
- `../../lib/queries` — `catalogQuery`, `databaseCatalogQuery`, `useCatalogScope`.
- `../../lib/sqlBuild` — `GridSort`.
- `../../ipc/types` — `Catalog`, `CatalogTable`, `ScriptOperationProposal`.

### External
- Rust: no dedicated `features/table_data/` module. `propose_table_changes` is a
  `#[tauri::command]` in `src-tauri/src/commands/mod.rs` calling
  `state.services.script`, composed from `src-tauri/src/features/scripts/`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
