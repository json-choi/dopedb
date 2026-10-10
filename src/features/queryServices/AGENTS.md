<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/queryServices

## Purpose
Central result presentation and session tracking for query/script outcomes: local
snapshots that survive editor and document closure, each one still scoped to its
original connection and workspace. It persists sessions through commands that live
in the `queries` Rust feature (`list_query_service_sessions`, `save_query_service_session`),
so it shares that backend module rather than owning one of its own.

## Key Files
| File | Description |
|------|-------------|
| `QueryResultsPane.tsx` | Central result presentation pane with tabs; local snapshots survive editor/document closure and stay scoped to their originating connection/workspace. A running session shows its elapsed time and, while its run has one registered in `../backgroundTasks/cancelRegistry.ts`, that exact cancel. |
| `QueryServiceResult.tsx` | Displays a query outcome plus the recovery command owned by its exact connection; run errors and each failed script statement render by typed kind in translated copy with a caret under the failing position. |
| `StreamOutcome.tsx` | Bounded desktop stream projection; the grid and exports consume the immutable chunk source directly and never flatten a partial result. |
| `errorCopy.ts` | `sqlErrorCopy` / `scriptStatementErrorCopy`: translated title and message by typed error kind plus the verbatim database detail; shared by `QueryServiceResult.tsx` and the table editor's staged-change failure (`screens/Tables/SqlTableData.tsx`). |
| `domain.ts` | `QueryServiceStatus`/`QueryServiceSession` types built on `../queries`' `ExecOutcome`/`ScriptOutcome`/`SqlStreamViewState`; restore validates typed script statement errors and gives a snapshot's legacy plain-text statement error the typed shape with kind `unknown`; `persistableQueryServiceSession` saves a cancelled run's partial rows as the cancellation alone. |
| `runningUpdateScheduler.ts` | Publishes the latest "running" snapshot at most once per interval per session id; lifecycle transitions (waiting/terminal) bypass the cadence and commit immediately. |
| `store.ts` | `useSyncExternalStore`-based session store, capped at `MAX_SESSIONS` (20) per scope. |
| `tauriAdapter.ts` | `listQueryServiceSessions`/`saveQueryServiceSession`, scoped by `{ workspaceId, accountScope }`. |
| `useQueryServices.ts` | Hook coordinating session lifecycle against the store and adapter. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- `tauriAdapter.ts` always passes `expectedWorkspaceId`/`expectedAccountScope`; do
  not drop that scoping when adding a new session read/write.
- `StreamOutcome.tsx` must keep consuming the chunk source directly rather than
  flattening a partial stream into a full result, per its header comment.
- `store.ts`'s 20-session cap per scope is intentional; raise it only with an
  explicit reason, mirroring the repo's "no unexplained budget increases" stance.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- `runningUpdateScheduler.ts`'s cadence-with-bypass pattern (throttle in-flight
  updates, but let terminal states commit immediately) is specific to this module.

## Dependencies

### Internal
- `../queries` — `SqlStreamViewState`, `resultPageCache`, `useSqlResultPages`, session command names live in its Rust transport.
- `../queryResults` — `DataGrid`, `ResultToolbar`, `ResultWorkbench*`.
- `../../ipc/types` — `AppErrorDetails`, `ExecOutcome`, `ScriptOutcome`.

### External
- Rust: no dedicated `query_services` module. Commands are implemented in
  `src-tauri/src/features/queries/transport.rs` (`mod.rs` at
  `src-tauri/src/features/queries/mod.rs:163,173`) backed by
  `src-tauri/src/store/query_services.rs`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
