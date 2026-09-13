<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/queries

## Purpose
Core SQL execution feature: manual SQL workbench state, inspection/proposal/approval
of statements, streaming and cancelling results, manual transactions, and the
persisted query-service session store used by the `queryServices` feature. Its DTOs
are generated from the Rust model/receipt contracts (`domain.ts`, `generated/contracts.ts`)
so this module stays the one frontend owner of that wire shape instead of a
hand-written mirror. Do not confuse this with the singular `../query` feature, which
holds pure client-side SQL text analysis with no IPC.

## Key Files
| File | Description |
|------|-------------|
| `ManualTransactionControls.tsx` | UI controls (commit/rollback etc.) driven by a `ManualTransactionController`. |
| `ManualTransactionsMenu.tsx` | Status-bar recovery surface for manual transactions across the active workspace; hidden when there is nothing to recover. |
| `domain.ts` | Query's public DTOs, generated from the Rust model/receipt contracts; re-exports `Classification`/`PreviewReport`/`RiskLevel`. |
| `editorStatus.ts` | SQL editor cursor/status types and the editor indent size constant. |
| `editorStatusStore.ts` | `useSyncExternalStore`-based store for the current `SqlEditorStatus`. |
| `generated/contracts.ts` | ts-rs-generated wire contracts (`SqlInspection`, `SqlOperationProposal`) from `src-tauri/src/features/queries/adapters/desktop_contracts.rs`; keep synchronized with the Rust DTOs, do not hand-edit its shape without regenerating. |
| `namespace.ts` | Resolves the default SQL namespace per connection engine (sqlite `main`, postgres `public`, else the database name). |
| `productAnalytics.ts` | Reduces query runtime state to one content-free product event per manual attempt; SQL text and statement errors never enter retained analytics state. |
| `resolveMode.ts` | `playground`/`script` resolve-mode type and a non-code masking helper used by mode resolution. |
| `resultPageCache.ts` | Bounds SQL stream result retention to `SQL_RESULT_CACHE_MAX_PAGES` (6) plus one in-flight page. |
| `runPath.ts` | Pure branching logic: backend classification stays authoritative; this only decides combined vs. planned streaming for a manual run. |
| `sqlWorkbenchModel.ts` | Pure state/text projections shared by the manual SQL workbench controller. |
| `tauriAdapter.test.ts` | Verifies transaction snapshot consolidation, the `propose_sql` wire shape, bounded table-page streaming, and cancel/ACK semantics for read proposals. |
| `tauriAdapter.ts` | Sole owner of SQL execution/manual-transaction/streaming command names (`inspect_sql`, `propose_sql`, `run_sql`, `run_script`, `cancel_query`, `read_sql_result_page`, manual transaction begin/commit/rollback, etc.). |
| `useManualTransaction.ts` | Hook wrapping begin/commit/rollback/get manual-transaction commands. |
| `useSqlResultPages.ts` | Hook paging through cached SQL stream rows via `readSqlResultPage`. |
| `useSqlResultStream.ts` | Query feature's core execution state machine: a run owns its controller and every pending React commit acknowledgement so a replaced run cannot resolve a stale callback. |
| `useSqlWorkbenchController.ts` | Owns SQL editor persistence, target resolution, execution approval, streaming, cancellation, and Services projection for the manual query workbench. |
| `useSqlWorkbenchTarget.ts` | Resolves the manual SQL workbench's exact database and namespace authority. |
| `useWorkspaceManualTransactions.ts` | Workspace-level observer giving the status bar one recovery surface for manual transactions left open outside the active editor. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `generated/` | `contracts.ts` only — ts-rs-generated wire types mirroring `src-tauri/src/features/queries/adapters/desktop_contracts.rs`. Regenerate rather than hand-edit. |

## For AI Agents

### Working In This Directory
- `tauriAdapter.ts` is the only place that should call `invoke` for SQL execution,
  manual transactions, or query-service session persistence; other features import
  from here rather than re-declaring a command name.
- `generated/contracts.ts` is a checked-in generated file; a Rust DTO change to
  `desktop_contracts.rs` must be regenerated here, not hand-patched, and field order
  must match (see root `AGENTS.md` "IPC" rule).
- `runPath.ts` and `runSignal`-adjacent logic in `../query` are advisory only —
  backend classification via `inspect_sql`/`propose_sql` remains the authoritative
  safety check; do not let a frontend heuristic skip approval.
- `useSqlResultStream.ts` binds React commit acknowledgements to the exact run
  instance; when modifying it, preserve that a superseded run cannot resolve
  callbacks for the run that replaced it.

### Testing Requirements
- `tauriAdapter.test.ts` is part of the `pnpm test` smoke suite
  (`vitest run src/features/queries/tauriAdapter.test.ts`) and counts against the
  208-test budget; extend it rather than adding a new top-level test file.

### Common Patterns
- Manual transaction hooks (`useManualTransaction.ts`, `useWorkspaceManualTransactions.ts`)
  key TanStack Query entries with `qk` from `../../lib/queries` for cache consistency.

## Dependencies

### Internal
- `../connections` — `ConnectionProfile`, `ConnectionEngine`.
- `../operations` — `approveOperation` (used by `useSqlWorkbenchController.ts`).
- `../query` — `localizeRunSignal`, `useSqlDraftAnalysis`, `formatSqlDocument`, `SqlParameter`.
- `../productAnalytics/client` — event capture for manual-attempt outcomes.
- `../../ipc/generated/protocol-contracts`, `../../ipc/types`.

### External
- `@tanstack/react-query`, `sql-formatter` (`SqlLanguage` type only).
- Rust: `src-tauri/src/features/queries/transport.rs` (also `application.rs`,
  `domain.rs`, `domain_tests.rs`, `manual_transaction*.rs`, `ports.rs`, `adapters/`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
