<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features

## Purpose

Every frontend capability lives in its own directory under `src/features/<feature>/`.
`src/screens/` mounts these features; features never mount each other's screens.
Each feature is a vertical slice, not a strict four-file template — the layering
that recurs across real files is:

- `domain.ts` — pure types, branded ids (e.g. `connectionId()`, `jobConnectionId()`),
  and pure functions. No React, Tauri, or query imports.
- `tauriAdapter.ts` — the feature's only caller of `invoke()` / `listen()` from
  `src/ipc/core`. Screens and hooks never call `invoke` directly; they go through
  this file (see e.g. `connections/tauriAdapter.ts:1-2`, `documentQueries/tauriAdapter.ts:1-2`).
- `queryKeys.ts` / `queries.ts` / `*Query()` functions — TanStack Query key builders
  and `queryOptions()` factories consumed with `useQuery`/`useMutation`. Backend reads
  never use `useEffect` + `invoke` directly in a screen.
- `use<Feature>Controller.ts` (application layer) — owns React state, composes
  smaller controller hooks, calls the adapter, and returns a grouped
  `{ model, commands }`-shaped object to presentation components. Larger features
  compose several of these (e.g. `connections/useConnectionEditorController.ts`
  composes five sub-controllers; `jobs/useJobPanelController.ts` owns the whole
  panel workflow).
- Presentation `.tsx` files — render controller output as props and hold no
  transport or query state themselves; several header comments state this
  explicitly (`agents/AcpChatComposer.tsx`, `jobs/JobPlanForm.tsx`).

Not every feature has all of these files verbatim: a small feature may be only a
`tauriAdapter.ts` (`activity/`, `documentQueries/`, `runtime/`), and one mutable
slice keeps a single authoritative writer instead of a plain reducer — for
example `agents/sessionStore.ts` is the one `AcpSessionStore` instance every
Agent surface reads through `useAcpSessionSnapshot`, and
`catalogExplorer/state.ts` is the one `useReducer` for Explorer UI state.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `actionSearch/` | Command-palette action index and dialog: fuzzy search over commands, connections, documents, and cached catalog objects (see `actionSearch/AGENTS.md`). |
| `activity/` | Read-only audit/history feed adapter — verify, list, and get audit and history pages (see `activity/AGENTS.md`). |
| `agents/` | ACP (Agent Client Protocol) chat UI, session store, external-Agent request gate, and exact Project-resource scope selection (see `agents/AGENTS.md`). |
| `analysisArticles/` | Analysis Article editor/reader, sanitized-HTML publication and sharing, and the manual-rerun workflow (see `analysisArticles/AGENTS.md`). |
| `appShell/` | Desktop workbench shell composition: top bar, shell layout, connection picker, tool-window and Agent-dock geometry (see `appShell/AGENTS.md`). |
| `backgroundTasks/` | Cross-feature running-task menu (jobs + Agent sessions) with cancel commands (see `backgroundTasks/AGENTS.md`). |
| `catalog/` | Catalog snapshot-to-UI projection and table DDL query (see `catalog/AGENTS.md`). |
| `catalogExplorer/` | Database Explorer tree state, drag/drop and Project-scoped database ordering, and catalog filtering (see `catalogExplorer/AGENTS.md`). |
| `connections/` | Connection profile domain, editor controllers, BigQuery onboarding, diagnostics, and managed-connection recovery (see `connections/AGENTS.md`). |
| `cosmicScene/` | Welcome-screen WebGL2 cosmic background renderer (see `cosmicScene/AGENTS.md`). |
| `documentQueries/` | MongoDB document-query IPC adapter; read-only, no document write transport (see `documentQueries/AGENTS.md`). |
| `erd/` | React Flow ERD canvas with cancellable ELK layout, virtual relationships, and layout persistence (see `erd/AGENTS.md`). |
| `jobs/` | Durable Job Engine import/export panel, plan form, and lifecycle controller (see `jobs/AGENTS.md`). |
| `knowledge/` | Knowledge Projects/Environments: source and database bindings, GitHub install flow, and inventory sync (see `knowledge/AGENTS.md`). |
| `localHistory/` | SQL revision history tool window with an explicit restore-and-return-to-Explorer flow. |
| `monitoring/` | Privacy-bounded desktop error monitoring (Sentry); scrubs database/workspace/Agent payloads before an event leaves the WebView. |
| `onboarding/` | Guided-demo setup composed from existing connection and Project Environment commands. |
| `operations/` | Single shared adapter for SQL/job/provider approval decisions (`approveOperation`/`rejectOperation`). |
| `productAnalytics/` | Product analytics consent UI plus the event client and outcome helpers other features call into. |
| `providers/` | Managed provider access dialogs and the provider domain model. |
| `queries/` | SQL query/document editor workflow: manual transactions, editor status, and results plumbing. |
| `query/` | Query execution and run-signal domain, gated by Safety Settings. |
| `queryResults/` | Shared results grid rendering (`DataGrid`, virtualized variant) reused by SQL, document, and Article results. |
| `queryServices/` | Central query-result pane and service store shared by the editor and document surfaces. |
| `runtime/` | Packaged-benchmark renderer metrics IPC adapter. |
| `safetySettings/` | Workspace write-ceiling and device Safety gate persistence/coordination (fail-closed ordering). |
| `settings/` | Settings navigation section domain shared by the shell and the modal Settings screen. |
| `skills/` | Skill startup gate and setup policy checks. |
| `sqlDocuments/` | SQL document domain: branded ids and resolve-mode contracts. |
| `tableData/` | Table data grid catalog/query hooks. |
| `terminals/` | xterm-based PTY surface for the explicit, connection-pinned advanced Shell (Settings → Command line only). |
| `updater/` | App auto-updater phase state and controller. |
| `workbench/` | Central workbench document domain (singleton vs. query documents) and the draft store. |
| `workspaces/` | Workspace/account auth policy, login flow, and Tauri adapter. |

## For AI Agents

### Working In This Directory

- Add new IPC calls only in a feature's `tauriAdapter.ts`; never call `invoke`
  from a screen, component, or controller hook directly.
- Backend reads go through a `queryOptions()`/`useQuery` pair, not
  `useEffect` + adapter call, per root `CLAUDE.md`/`AGENTS.md`.
- Keep one writer per piece of mutable cross-surface state (see `agents/sessionStore.ts`
  for the pattern); other hooks read a snapshot, they do not duplicate the store.
- A feature may import another feature's `domain.ts`/`tauriAdapter.ts`/presentation
  helpers (e.g. `backgroundTasks` reads `agents` and `jobs` domain types), but
  should not reach into another feature's private controller state.
- See root `AGENTS.md` / `CLAUDE.md` for repository-wide rules (layering, i18n,
  export style, Tailwind-only UI).

### Testing Requirements

- `pnpm test` runs the fixed frontend smoke suite (see `package.json` `test`
  script); only a few features currently have a test in that list
  (`queryResults`, `providers`, `queries`, `query`, `skills`, `agents`,
  `workbench`, `workspaces` — one file each). The repository has a hard budget
  of 208 critical tests (`tests/critical-test-budget.json`,
  `pnpm check:test-budget`); do not add a test outside that budget without an
  explicit user request.
- `pnpm build` type-checks and bundles the frontend; run it after touching any
  feature.

### Common Patterns

- Branded string ids via a `declare const ...Brand: unique symbol` plus a
  constructor function, so a `ConnectionId` and a `JobId` cannot be swapped by
  accident (`connections/domain.ts`, `jobs/domain.ts`, `erd/domain.ts`).
- Analytics modules (`*/productAnalytics.ts`) state in their header comment
  exactly which fields are excluded from the event payload (prompt text, SQL,
  row data, error bodies) — follow that exclusion list when extending one.

## Dependencies

### Internal

- `src/screens/` mounts feature entry points (e.g. `screens/Connections` renders
  the Database Explorer built from `catalogExplorer` + `connections`).
- `src/components/`, `src/design-system/` supply shared UI and semantic tokens
  consumed by every feature's presentation layer.
- `src/lib/` supplies the global TanStack Query cache helpers (`qk`, `useCatalogScope`),
  `i18n`, and DOM-free utilities used across features.
- `src/ipc/core` (`invoke`) and `src/ipc/types` are the only IPC primitives a
  `tauriAdapter.ts` should import.

### External

- `@tanstack/react-query` for all query/mutation state.
- `@tauri-apps/api` (`invoke`, `event`) and `@tauri-apps/plugin-opener` for
  native IPC and opening external URLs.
- `@xyflow/react` + `elkjs` (ERD canvas layout), `@sentry/react` (monitoring).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
