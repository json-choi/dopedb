<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens

## Purpose
Screen-level entry points for the desktop workbench. Each subdirectory is one
document/surface kind mounted by the app shell; screens compose `src/features/*`
controllers and `src/design-system` primitives but do not own global state,
Tauri calls, or the query cache themselves. `src/App.tsx` re-exports
`features/appShell/AppShell` as the sole render root — screens are never routed
by a URL router, only by the shell's internal document/route state.

## Key Files
None directly in this directory; every screen lives in its own subdirectory.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `Activity/` | Unified audit/history log viewer (see `Activity/AGENTS.md`). |
| `Connections/` | Connection editor and Database Explorer sidebar tree (see `Connections/AGENTS.md`). |
| `Documents/` | Ad-hoc MongoDB find/aggregate/count console (see `Documents/AGENTS.md`). |
| `Knowledge/` | Knowledge Project environment view: sources, analysis articles (see `Knowledge/AGENTS.md`). |
| `Onboarding/` | Welcome document shown with no connection or an empty document strip (see `Onboarding/AGENTS.md`). |
| `Schema/` | Catalog V2 ERD/relationship explorer (see `Schema/AGENTS.md`). |
| `SchemaDiff/` | Multi-connection schema comparison workspace (see `SchemaDiff/AGENTS.md`). |
| `Settings/` | Settings dialog: Advanced, AgentTools, Appearance, Cli, Privacy, Safety, Updates (see `Settings/AGENTS.md`). |
| `Sql/` | Manual SQL console (CodeMirror editor + results) (see `Sql/AGENTS.md`). |
| `Tables/` | Table/collection data grid, paging, and row editing (see `Tables/AGENTS.md`). |

## For AI Agents

### Working In This Directory
- Screens are wired in `src/features/appShell/WorkbenchContent.tsx`, which
  `lazy()`-imports each screen module (`Activity`, `Documents`, `Knowledge`,
  `SchemaExplorer` from `screens/Schema`, `SchemaDiff`, `Settings`, `Sql`,
  `TableData` from `screens/Tables`) and switches on `WorkbenchDocument.kind` /
  shell route flags to decide which one renders in the central pane. `Settings`
  renders as an always-available overlay dialog rather than a document kind.
  `ConnectionForm` (from `screens/Connections`) is imported directly (not
  lazily) for the connection editor surface. `Onboarding` is imported directly
  by `WorkbenchContent` for the welcome states.
- `src/features/appShell/AppShell.tsx` is the actual mount root: it builds the
  `WorkbenchContent` model/commands props from feature controllers
  (`useAppShellWorkbenchController`, `useCatalogScope`, `useQueryServices`,
  etc.) and passes them down; screens receive fully-resolved props, they do
  not call `invoke` or read global state directly.
- New screens follow the `screens/X/index.tsx` file convention (see root
  `AGENTS.md`/`CLAUDE.md`) and must be added to `WorkbenchContent`'s lazy
  import map and route switch to become reachable.
- `docs/PRODUCT_UI_SCOPE.md` is the source of truth for screen structure,
  density, and per-feature scope decisions (`구현 안 함` / `범위 밖` / `미결`).
  Read it before changing what a screen shows or adding a new one.
- Read `src/design-system/README.md` before any TSX/Tailwind change in a
  screen: utilities use the `tw:` prefix, only semantic tokens (no raw
  colors), and repeated patterns are promoted to `src/design-system/`
  primitives rather than copied.

### Testing Requirements
- No screen-specific automated tests exist under `src/screens/` today; the
  frontend smoke suite (`pnpm test`) and a manual run of `pnpm dev:app` are
  the checks that exercise screen composition. `pnpm build` also type-checks
  every screen.
- The 208-test budget (`tests/critical-test-budget.json`) does not currently
  reserve any slots under `screens/`; adding one requires replacing an
  existing lower-value test, not growing the budget.

### Common Patterns
- Files export a default component named after the screen (e.g.
  `export default function Onboarding(...)` in `Onboarding/index.tsx`), except
  `Connections/index.tsx`, which is a barrel re-exporting two named exports
  (`DatabaseExplorer`, `ConnectionForm`) instead of one screen component.
- Backend reads go through TanStack Query options from `src/lib/queries.ts`
  (e.g. `catalogQuery`, `historyQuery`) — screens call `useQuery`/`useQueries`
  with those options rather than `useEffect` + `invoke`.

## Dependencies

### Internal
- `src/features/appShell/` mounts every screen and owns shell-level state.
- Screens compose `src/features/<feature>/` domain hooks and adapters,
  `src/components/` shared UI, `src/design-system/` primitives, and
  `src/lib/` (i18n, query cache, schema-diff, catalog helpers).

### External
- `@tanstack/react-query` for all backend reads/mutations.
- `react` (lazy/Suspense for screen code-splitting in `WorkbenchContent`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
