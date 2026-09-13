<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/Sql

## Purpose
Manual SQL console. An editable CodeMirror editor where Run is the explicit
human approval action; execution results occupy the central document.
Multi-statement scripts execute through the backend script runner and keep
per-statement results. `⌘↩` runs the current draft or the current selection.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `Sql` screen: editor/result view toggle, resolve-mode and parameter handling via `useSqlWorkbenchController`, manual transaction controls. |
| `SqlParameterDialog.tsx` | Default-exported modal collecting values for named SQL parameters (`apply`/`explain`/`run` actions) before execution. |

## For AI Agents

### Working In This Directory
- Mounted as the `activeDocument.kind === "sql"` document in
  `WorkbenchContent.tsx`; receives `safety` (falls back to a hard-blocked
  `BLOCKED_SAFETY_SETTINGS` object defined there while policy is still
  loading) plus persistence/result callbacks.
- Core editor state and execution flow live in
  `features/queries/useSqlWorkbenchController`; this screen only renders that
  controller's state and forwards commands — do not add query-execution
  logic directly to `index.tsx`.
- Uses `LazySqlViewer` (`src/components/`) for read-only SQL display and
  `QueryResultsPane` (`features/queryServices/`) for results — do not build a
  second results renderer here.
- Manual UI check: run `pnpm dev:app`, open a SQL document, run a
  parameterized statement.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` and `pnpm build`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
