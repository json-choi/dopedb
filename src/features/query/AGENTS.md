<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/query

## Purpose
Pure, client-side SQL text analysis: draft analysis (statement splitting, parameter
detection, early risk signals), SQL formatting, and the SQL editor text buffer. It
has no `domain.ts`/`tauriAdapter.ts` of its own and issues no direct `invoke` calls
(one exception: `sqlFormatter.ts` delegates to the backend `format_sql_fragment`
command from `../queries/tauriAdapter` when running inside Tauri, for large or
compound-statement documents). Do not confuse this singular `query` feature with the
plural `../queries` feature, which owns SQL execution and IPC.

## Key Files
| File | Description |
|------|-------------|
| `runSignal.test.ts` | Tests run-signal risk-tone logic together with `../safetySettings` persistence and a `ConnectionProfile`. |
| `runSignal.ts` | Fast client-side guidance shown before the authoritative backend classifier runs; these signals never grant execution, they only explain obvious risk shapes early. |
| `sqlDraftAnalysis.ts` | Pure draft-analysis function (statement split, parameter detection, run-signal analysis) shared by the main thread hook and the worker. |
| `sqlDraftAnalysis.worker.ts` | Runs `sqlDraftAnalysis` inside a dedicated Web Worker and validates the message origin before processing. |
| `sqlFormatter.ts` | SQL formatting entry point; splits large/compound documents into bounded chunks and, under Tauri, delegates formatting to the backend `format_sql_fragment` command. |
| `sqlFormatter.worker.ts` | Web Worker wrapping the `sql-formatter` package's `format` function for the non-Tauri/preview formatting path; validates its own script origin before accepting a message. |
| `sqlParameters.ts` | Finds and tokenizes SQL named parameters (e.g. `:param`) for parameter-binding UI. |
| `useSqlDraftAnalysis.ts` | Hook that debounces (140ms) draft analysis requests against `sqlDraftAnalysis`. |
| `useSqlEditorBuffer.ts` | Hook managing the SQL editor's text buffer with debounced (400ms) snapshot persistence. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- `runSignal.ts` results are advisory only — do not let a signal here suppress or
  replace the backend's `inspect_sql`/`propose_sql` classification in `../queries`.
- Both `.worker.ts` files validate their own message/script origin before acting on
  a posted message; preserve that check when editing worker message handling.
- Keep this feature free of `invoke`/`tauriAdapter.ts` beyond the single existing
  delegation in `sqlFormatter.ts`; new IPC belongs in `../queries`.

### Testing Requirements
- `runSignal.test.ts` is part of the `pnpm test` smoke suite
  (`vitest run src/features/query/runSignal.test.ts`) and counts against the
  208-test budget; extend it rather than adding a new top-level test file.

### Common Patterns
- Compute-heavy, pure functions (`sqlDraftAnalysis`, `splitSqlFormatChunks`) are
  written to run identically on the main thread or inside a worker.

## Dependencies

### Internal
- `../connections` — `ConnectionEngine`.
- `../safetySettings` — `SafetySettings` type, `persistConnectionSafety` (test only).
- `../../lib/sqlStatements` — `splitStatements`.
- `../queries/tauriAdapter` — `formatSqlFragment` (Tauri-only formatting path).

### External
- `sql-formatter` (`SqlLanguage`, `format`).
- No dedicated Rust module; the one backend call it makes routes through
  `src-tauri/src/features/queries/transport.rs` via `../queries`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
