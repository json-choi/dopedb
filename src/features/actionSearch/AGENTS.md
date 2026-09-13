<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/actionSearch

## Purpose

The command palette (`Cmd/Ctrl+K`-style dialog). It indexes real shell commands,
open documents, and cached catalog objects (tables/views/etc.) into one fuzzy
search list, and renders the dialog itself. It does not own connection, catalog,
or document state — it only projects and filters state already held by other
features.

## Key Files

| File | Description |
|------|-------------|
| `ActionSearch.tsx` | Default-exported dialog component: keyboard navigation, portal rendering, and selection commit for `ActionSearchCloseReason` (`dismiss` \| `selection`). |
| `domain.ts` | Pure `ActionSearchItem`/`ActionSearchKind` types and `indexActionSearchItems`/`searchActionItems` fuzzy-match functions; no React or IPC imports. |
| `catalogCache.ts` | `useCachedCatalogOverviews` — reads already-fetched `CatalogOverview` query cache entries (by connection/database) so search does not trigger new catalog fetches. |
| `useActionSearchDialog.ts` | Open/close state and the editable-target guard (`actionSearchShortcutTargetIsEditable`) so the shortcut does not fire while typing in an input, textarea, or CodeMirror surface. |
| `useActionSearchItems.ts` | Builds the actual `ActionSearchItem[]` from connections, workbench documents, settings sections, and cached catalog tables for the current scope. |

## For AI Agents

### Working In This Directory

- This feature reads from `catalogExplorer`, `connections`, `settings`, and
  `workbench` domain types; it must not introduce new IPC calls of its own —
  add data via the owning feature's existing query cache instead of a new
  `tauriAdapter.ts`.
- Keep `domain.ts` free of React/Tauri imports; indexing and matching logic
  belongs there so it stays independently testable.

### Testing Requirements

- No dedicated test file exists here today; `actionSearch` is not part of the
  `pnpm test` smoke suite or the 208-test budget. Verify changes with `pnpm build`
  and a manual check of the command palette.

### Common Patterns

- `catalogCache.ts` reads the shared TanStack Query cache directly (via
  `QueryClient`) instead of calling `useQuery`, because it wants a snapshot of
  whatever catalog data has already loaded rather than to trigger a new fetch.

## Dependencies

### Internal

- `src/features/catalogExplorer/scopeFilter.ts` (catalog filtering), `src/features/connections/domain.ts`,
  `src/features/settings/domain.ts`, `src/features/workbench/domain.ts`.
- `src/design-system/components/{Button,CommandMenu,Modal}`, `src/components/Icon`.
- `src/lib/i18n`, `src/lib/queries` (`databaseCatalogQuery`, `CatalogScope`).
- No feature-owned Rust transport: `actionSearch` has no
  `src-tauri/src/features/action_search/` counterpart; it only re-reads other
  features' already-fetched data.

### External

- `@tanstack/react-query` (`QueryClient` cache reads), `react-dom` (`createPortal`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
