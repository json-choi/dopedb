<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/Sql

## Purpose
Manual SQL console. An editable CodeMirror editor where Run is the explicit
human approval action; editor and results share the central document in a
resizable top/bottom split. Running keeps the editor visible and focused.
Multi-statement scripts execute through the backend script runner and keep
per-statement results. `⌘↩` runs the current selection; without a selection,
multi-statement SQL opens a current-statement/whole-script chooser and single
statements run directly. Scope previews do not change the real editor selection.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `Sql` screen: editor/result split via `SqlResultSplit`, resolve-mode and parameter handling via `useSqlWorkbenchController`, manual transaction controls. |
| `SqlParameterDialog.tsx` | Default-exported modal collecting values for named SQL parameters (`apply`/`explain`/`run` actions) before execution. |
| `SqlRunMenu.tsx` | Caret-anchored execution-scope menu; hover and keyboard focus preview the same revision-pinned source, and confirmation delegates to the controller. |

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
