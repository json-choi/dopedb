<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/catalogExplorer

## Purpose

The Database Explorer's own UI/interaction state: which connections/schema
groups are expanded, drag-and-drop for schema grouping and Project database
ordering, catalog search/filtering, and explicit loading/authentication
recovery. It has no `tauriAdapter.ts` of its own — catalog *data* comes from
`catalog`/`connections`, and this feature only holds and filters presentation
state on top of it.

## Key Files

| File | Description |
|------|-------------|
| `catalogDomain.ts` | `DropTarget`/`ProjectDatabaseOrderDrag` drag types, `catalogLoadIssue`/`isAuthenticationRequired`/`isManagedConnectionRecoveryRequired` error classification, `SQL_OBJECT_SECTIONS`, and object-label/filename helpers (`catalogObjectLabel`, `fallbackSchemaGroupName`, `tableMatchesFilter`). |
| `domain.ts` | `WorkspaceDialogState`, `DdlDialogState`, and the `CatalogExplorerState` shape (`scopeKey`, `wanted`, `refreshErrors`, `openConnections`, …). |
| `projectResources.ts` | Pure functions over Project/Environment/connection resources: `projectResourceKey`, `flattenProjectEnvironmentResources`, `orderProjectDatabaseResources`, `moveProjectDatabaseResource`, `projectConnectionAssignment`. |
| `scopeFilter.ts` | Owns the two reserved introspection parameters (`SCHEMA_SCOPE_PARAMETER` = `dopedb.schemaScope`, `OBJECT_PATTERN_PARAMETER` = `dopedb.objectPattern`) and `filterCatalog`/`filterCatalogOverview`/`filterCatalogSnapshot`, which apply a connection's persisted schema scope and object pattern to catalog data. |
| `state.ts` | `catalogExplorerReducer` and `useCatalogExplorerState(scopeKey)` — the one reducer owning Explorer expansion/selection/error UI state. |
| `useCatalogExplorerLoading.ts` | Owns explicit Explorer loading and authentication recovery; per its header comment, provider login runs through the existing connection adapter and this hook only coordinates catalog cache refresh once a member-local credential becomes usable again. |
| `useDatabaseExplorerMutations.ts` | Explorer mutation commands (delete/update connection, bind to Environment); per its header comment, preserves workspace connections when only a Project binding goes away rather than deleting the connection. |
| `useProjectDatabaseOrder.ts` | Drag-driven reordering of databases within a Project, built on `projectResources.ts`'s pure ordering functions. |
| `useProjectExplorerActions.ts` | Project/Environment expansion and "open environment setup" action wiring for the Explorer tree. |
| `useSchemaGroupDrag.ts` | Pointer-driven drag-and-drop for grouping connections into a shared schema group, calling `connections/tauriAdapter.ts`'s `setConnectionsSchemaGroup`. |

## For AI Agents

### Working In This Directory

- This feature has no `tauriAdapter.ts`; new IPC needs belong in `catalog/`
  or `connections/`, not here — `catalogExplorer` should stay a pure
  state/filtering layer over those features' data.
- `scopeFilter.ts`'s two reserved parameter names
  (`dopedb.schemaScope`, `dopedb.objectPattern`) are the only place introspection
  scope is encoded; do not add a second parallel encoding for schema/object
  filtering elsewhere.
- `useDatabaseExplorerMutations.ts` intentionally distinguishes "remove Project
  binding" from "delete connection" — do not collapse that distinction, since
  it directly implements the repository's "connecting must never silently
  delete a workspace connection" safety rule.

### Testing Requirements

- No test file in this directory; not part of `pnpm test` or the 208-test budget.

### Common Patterns

- `state.ts` is the one `useReducer`-based state owner in this feature set
  (most other features here use `useState`/`useQuery` directly inside a
  controller hook instead).

## Dependencies

### Internal

- `src/features/connections/{domain,tauriAdapter,bigQueryOnboardingModel,useManagedConnectionRecovery}.ts`.
- `src/features/knowledge/domain.ts` (`EnvironmentConnection`, `KnowledgeEnvironment`, `KnowledgeProject`).
- `src/features/analysisArticles/queryKeys.ts` (cache invalidation on connection changes).
- `src/lib/{queries,capabilities,schemaDiff}.ts`, `src/ipc/types` (`Catalog*` types).
- No feature-owned Rust transport (`catalogExplorer` has no `src-tauri/src/features/catalog_explorer/`).

### External

- `@tanstack/react-query` (`useMutation`, `useQueryClient`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
