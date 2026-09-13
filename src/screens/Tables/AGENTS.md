<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/Tables

## Purpose
Table/collection data surface: paged data grid, filtering, cell/row
inspection, and staged row edits. `index.tsx` dispatches to an engine-specific
implementation — SQL engines and MongoDB have separate data-fetch and
edit-proposal flows even though they share toolbar/pager/side-panel pieces.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `TableData`: routes to `MongoTableData` for document engines (`isDocumentEngine`) or `SqlTableData` otherwise. |
| `SqlTableData.tsx` | SQL table query, paging, filtering, and staged row-edit controller; proposes changes via `features/tableData/tauriAdapter` and runs approved scripts via `features/queries/tauriAdapter`. |
| `MongoTableData.tsx` | MongoDB collection paging/count via `documentCountQuery`/`documentRowsQuery`, converts documents to grid rows with `lib/documentGrid`. |
| `TableToolbar.tsx` | Toolbar: export (CSV/JSON via `lib/export`), pager, manual transaction controls. |
| `TableExpressionBar.tsx` | Grid expression (filter/sort) input fields validated by `lib/sqlBuild`'s `gridExpressionIssue`. |
| `TableSidePanel.tsx` | Row/cell inspector and `RowEditor` host for staged writes and pending deletes. |
| `TableStructure.tsx` | Read-only column/PK/nullable structure table for a `CatalogTable`. |
| `Pager.tsx` | Shared pagination control (page/pageSize/total/hasMore) used by both engine variants and the toolbar. |

## For AI Agents

### Working In This Directory
- Mounted as the `activeDocument.kind === "data"` document in
  `WorkbenchContent.tsx` (lazy-imported as `TableData`), receiving
  `connection`, `table`, and the effective `safety` settings; if safety
  settings have not resolved yet, `WorkbenchContent` renders a fallback
  instead of this screen.
- Row-edit proposals go through `features/tableData/tauriAdapter`
  (`proposeTableChanges`) and execute via `features/operations/tauriAdapter`
  (`approveOperation`/`rejectOperation`) — never mutate a row directly without
  that proposal/approval round trip, per the repository's write-safety rules.
  `NUMERIC`/`MONEY` cell values arrive serialized as strings; do not coerce
  them to `number` before display or edit.
- Shared paging/toolbar/expression components (`Pager`, `TableToolbar`,
  `TableExpressionBar`) are reused by both `SqlTableData` and
  `MongoTableData` — prefer extending them over forking engine-specific
  copies.
- Manual UI check: run `pnpm dev:app`, open a table for both a SQL connection
  and a MongoDB connection, and exercise paging, filtering, and a staged edit.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` and `pnpm build`.

### Common Patterns
- Engine dispatch by capability check (`isDocumentEngine(connection.engine)`
  in `index.tsx`) rather than by connection driver name.

## Dependencies

### Internal
- `features/tableData/` (state, catalog metadata, tauriAdapter),
  `features/queries/` (script execution), `features/operations/` (approve/
  reject), `features/agents/selectionContext` (Agent cell/row selection),
  `features/queryResults/DataGrid`, `lib/documentGrid`, `lib/sqlBuild`,
  `lib/export`, `lib/tableRef`.

### External
- `@tanstack/react-query` (`useQuery`) for paged reads.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
