<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/Activity

## Purpose
Unified activity log for a connection: paged history entries and audit
entries. Lists use bounded metadata pages; exact SQL text and audit bodies
cross IPC only after the user selects one record, keeping the default page
load cheap.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `Activity` screen: filterable/paged query history whose SQL cell is a real button that opens the statement in a new SQL tab (pending/failure stay on the row, no premature success toast). Status/origin filter facets come only with the first page and are kept while paging. |
| `AuditTrail.tsx` | Security trail section: hash-chain verdict with its exact scope (genesis link plus the persisted tail anchor, so removed or replaced newest records are named precisely; a rewrite of both rows and anchor in `app.db` is not detectable), explicit re-verify, jump to the first broken record, an app-session high-water mark that flags a shrinking chain, and bounded metadata pages. |
| `activityLabels.ts` | Closed catalog projection for every history status/origin, audit action, and recorded identity the Rust writers emit; `cancelled`/`outcome_unknown` stay warning-toned with a check-before-rerun instruction. |

## For AI Agents

### Working In This Directory
- Mounted lazily by `src/features/appShell/WorkbenchContent.tsx` as the
  `WorkbenchDocument` kind for activity documents, receiving `connection` and
  an `onLoadSql` callback that receives the selected `HistoryEntryDetail`, so the
  shell reopens the statement in the database and schema the history row recorded
  for its run (`historyQueryTarget` in `src/features/workbench/domain.ts`).
- Uses `historyQuery`, `historyEntryQuery`, `auditPageQuery`, `auditEntryQuery`,
  `auditVerdictQuery` from `src/lib/queries.ts` — do not add a raw `invoke`
  call here for data this module already fetches through those options.
- The verdict rescans the whole chain. `operation:changed` only marks it stale
  (`src/lib/queryClient.tsx`); it recomputes when Activity opens or the reader
  presses re-verify. Never add an automatic verdict refetch loop.
- When a Rust writer adds a history status/origin or audit action, add its label
  to `activityLabels.ts` and both catalogs in the same change.
- Manual UI check: run `pnpm dev:app` and open a connection's Activity tab.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` (frontend smoke suite) and `pnpm build` type-checking.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
