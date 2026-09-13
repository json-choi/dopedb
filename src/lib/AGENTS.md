<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/lib

## Purpose
DOM-free (or nearly DOM-free) shared application logic: the global TanStack
Query cache and its backend-event-driven invalidation, pure SQL/export/schema
helpers, ERD graph/layout/export, and the i18n runtime. This is where
screen-independent business logic lives so it stays unit-testable without
mounting React; screens read it via hooks/query options rather than
duplicating the logic. `src/lib/*` uses **named exports only** (the one
exception to the repo's default-export convention).

## Key Files
| File | Description |
|------|-------------|
| `appProviders.tsx` | The single provider composition shared by the real app entry point and UI review harnesses; the only place providers/global CSS are wired, so the harness can never drift into a second copy. |
| `capabilities.ts` | Resolves which `DriverCapability` set applies to a saved connection, gating SQL-only UI (tabs, DDL, row editing, schema diff) with the same driver-fallback order `ConnectionForm` uses. |
| `documentGrid.ts` | Shapes MongoDB documents into `DataGrid` columns/rows (union of top-level keys, `_id` first, cells JSON-stringified); shared by the Documents screen and the Tables MongoDB branch. |
| `erdExport.ts` | Deterministic ERD export (SVG is the source artifact; PNG/PDF are derived locally) independent of the React Flow DOM, using `ERD_EXPORT_PALETTE`. |
| `erdGraph.ts` | Pure Catalog V2 → ERD graph projection; physical foreign keys are immutable catalog facts, virtual relationships are a separate explicit overlay that never feeds DDL. |
| `erdLayout.ts` | Cancellable adapter around ELK's dedicated worker for ERD layout, with a deterministic grid fallback when WebKit can't construct/run the worker. |
| `export.ts` | Browser-side result-export helpers (clipboard text, file download); the pure CSV/JSON shaping lives in `sqlBuild.ts`. |
| `externalLinks.ts` | Static external setup-doc URLs for the Claude and Codex CLIs. |
| `frameCoalescer.ts` | Generic `requestAnimationFrame`-batched value coalescer. |
| `gridValueFilter.ts` | Encodes/decodes a data-grid cell value filter using a private-use prefix character. |
| `operationActivity.tsx` | App-level bounded activity ledger for authenticated Terminal broker commands. |
| `queries.ts` | Query-key factory and shared TanStack Query options for every cached backend read; one fetch per (resource, connection) is shared app-wide. |
| `queryClient.tsx` | The app-wide `QueryClient` plus the single place backend events are translated into cache invalidations. |
| `queryResultPhase.ts` | Canonical read-query priority/phase type so an empty result can never be confused with an error or a still-loading state. |
| `relTime.ts` | Dependency-free short relative timestamp formatting for feed/audit rows. |
| `schemaDiff.ts` | Pure schema-group construction and catalog comparison, feeding both the sidebar diff summary and the full comparison workspace. |
| `sqlBuild.ts` | Pure, unit-tested SQL/export string builders for the data grid: engine-aware identifier quoting (reused from `tableRef.ts`), literal escaping, and injection-safe WHERE/ORDER BY/paging/DML generation. |
| `sqlStatements.ts` | Client-side statement splitter mirroring the Rust `sql_script::split_statements`/`is_effective_sql`, used only as a UX heuristic — the backend re-splits authoritatively before executing. |
| `tableRef.ts` | Identifier quoting and table labels shared by the sidebar explorer and data view. |
| `useEventCallback.ts` | Keeps an event-handler identity stable across renders while always invoking the latest implementation (used by editor extensions). |
| `usePostPaintReady.ts` | Hook that flips to `true` only after the first paint. |
| `useQueryRun.ts` | Shared execute/cancel harness for the SQL and Documents consoles: issues a fresh `queryId` per run and distinguishes a user-initiated cancel from a real backend error. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `i18n/` | Static English/Korean message catalogs and the localization runtime (see `i18n/AGENTS.md`). Catalogs are split one file per bounded feature namespace under `i18n/catalogs/` (e.g. `sql.ts` owns `sql.*` keys, `agents.ts` owns `agent.*`/`agentTools.*`); `defineCatalog` makes a missing or mismatched Korean key a TypeScript error, and `composeCatalogs` throws at module load if two catalogs ever claim the same key. |

## For AI Agents

### Working In This Directory
- Use named exports only — no default export in this directory, per root
  `CLAUDE.md`.
- Backend cache invalidation belongs in `queryClient.tsx`; do not add
  per-screen event listeners that duplicate its event-to-invalidation
  mapping.
- Keep files that don't need React (`sqlBuild.ts`, `schemaDiff.ts`,
  `erdGraph.ts`, `tableRef.ts`, `relTime.ts`, etc.) free of React imports so
  they stay unit-testable in isolation; only add a `.tsx` extension when a
  file genuinely needs JSX (providers, hooks returning elements).
- New backend reads are added as a query option in `queries.ts`, not as a
  bespoke `useEffect` + `invoke` in a screen (see root `AGENTS.md`).

### Testing Requirements
- No test files live directly under `src/lib/` today (existing coverage for
  its logic lives in `src/features/*` tests referenced by `package.json`'s
  `test`/`test:smoke` scripts, e.g. `queryResults/DataGridVirtual.test.ts`,
  `query/runSignal.test.ts`). Adding a unit test for pure logic here (e.g.
  `sqlBuild.ts`, `schemaDiff.ts`) must replace an existing lower-value test
  to stay within the 208-test budget (`tests/critical-test-budget.json`,
  `pnpm check:test-budget`).
- `pnpm build` type-checks this directory.

### Common Patterns
- Files with non-trivial behavior open with a short role comment describing
  intent and non-obvious invariants (e.g. `sqlBuild.ts`, `queries.ts`,
  `useQueryRun.ts`).
- Pure logic is deliberately separated from its browser-side effect (e.g.
  `sqlBuild.ts`'s CSV/JSON shaping vs. `export.ts`'s clipboard/download).

## Dependencies

### Internal
- `src/ipc/types.ts` for backend DTOs (`CatalogTable`, `Engine`, etc.).
- `src/design-system/artifactPalettes.ts` (`erdExport.ts`).
- Consumed by 151+ files across `src/features/` and `src/screens/`.

### External
- `@tanstack/react-query` (`queries.ts`, `queryClient.tsx`).
- `elkjs` (`erdLayout.ts`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
