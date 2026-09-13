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
| `index.tsx` | Default-exported `Activity` screen: filterable/paged history and audit list, entry detail fetch on selection. |

## For AI Agents

### Working In This Directory
- Mounted lazily by `src/features/appShell/WorkbenchContent.tsx` as the
  `WorkbenchDocument` kind for activity documents, receiving `connection` and
  an `onLoadSql` callback (to send a historical statement back into a SQL
  document).
- Uses `historyQuery`, `historyEntryQuery`, `auditPageQuery`, `auditEntryQuery`,
  `auditVerdictQuery` from `src/lib/queries.ts` — do not add a raw `invoke`
  call here for data this module already fetches through those options.
- Manual UI check: run `pnpm dev:app` and open a connection's Activity tab.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` (frontend smoke suite) and `pnpm build` type-checking.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
