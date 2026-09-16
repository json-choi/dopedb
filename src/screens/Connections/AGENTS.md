<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/Connections

## Purpose
Two composed surfaces that used to be one file: the connection create/edit
form (`ConnectionForm.tsx` and its tab/dialog pieces) and the Database
Explorer sidebar (`DatabaseExplorer.tsx` and the catalog tree it renders).
Both consume feature controllers for state and mutation — this directory owns
presentation and layout, not catalog loading, credential handling, or
connection persistence itself.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Barrel re-exporting the two screen entry points: `DatabaseExplorer` and `ConnectionForm`. |
| `ConnectionForm.tsx` | Compact connection/driver editor `ConnectionForm(props: ConnectionEditorProps)`; hosts `useConnectionEditorController` and composes the tab/panel files below. |
| `ConnectionProfilePanel.tsx` | `ConnectionProfilePanel` — editor header, tab strip, diagnostics summary, and action status from grouped view models. |
| `ConnectionGeneralTab.tsx` | `ConnectionGeneralTab` — General properties (name, engine, host/port/database) from profile/driver/workspace-dialog view models. |
| `ConnectionDatabaseField.tsx` | Native target-database field and accessible loading/empty/error discovery feedback; late suggestions never move focus from another control. |
| `ConnectionOptionsTab.tsx` | `ConnectionOptionsTab` — runtime-backed connection/session options; mutation/validation stays in the feature controller. |
| `ConnectionAdvancedTab.tsx` | `ConnectionAdvancedTab` — free-form driver parameters and capabilities from grouped profile/catalog view models. |
| `ConnectionSchemaTab.tsx` | `ConnectionSchemaTab` — discovered namespaces and saved introspection scope; does not query catalog adapters directly. |
| `ConnectionSecurityTab.tsx` | `ConnectionSecurityTab` — TLS and SSH alias properties; no file picking or validation state owned here. |
| `ConnectionBigQueryFields.tsx` | `ConnectionBigQueryFields` — BigQuery's official-CLI profile fields, kept separate from socket/password fields. |
| `ConnectionCatalogCompactSelector.tsx` | `ConnectionCatalogCompactSelector` — compact catalog (engine/provider) selector used below the editor's wide-layout breakpoint. |
| `ConnectionCatalogDetail.tsx` | `ConnectionCatalogDetail` — selected cloud provider or driver details from the catalog view model; does not load or mutate catalog state. |
| `ConnectionCatalogNavigation.tsx` | `ConnectionCatalogNavigation` — catalog navigation and source commands in the editor; query/mutation ownership stays in feature controllers. |
| `ConnectionSourcePicker.tsx` | `ConnectionSourcePicker` — one source picker shared by both wide and compact connection editor layouts. |
| `ConnectionEditorDialogs.tsx` | `ConnectionEditorDialogs` — provider-credential and workspace-binding dialogs driven by dialog controller state. |
| `ConnectionEditorFooter.tsx` | `ConnectionEditorFooter` — editor footer actions for profile and catalog editor modes. |
| `ManagedWorkspaceConnectionField.tsx` | `ManagedWorkspaceConnectionField` — presents the server-owned managed endpoint boundary and its exact Web recovery command. |
| `DatabaseExplorer.tsx` | `DatabaseExplorer` — sidebar connection tree, DDL modal host, schema-group drag-and-drop; the piece `ConnectionForm.tsx` was split out of. |
| `DatabaseExplorerToolbar.tsx` | `DatabaseExplorerToolbar` — toolbar and scoped search controls for the Database Explorer tool window. |
| `DatabaseExplorerEmptyState.tsx` | `DatabaseExplorerEmptyState` — first-run launch actions shown when the workspace has no local connections. |
| `DatabaseExplorerOverlays.tsx` | `DatabaseExplorerOverlays` — footer, setup dialogs, drag preview, and modal overlays for Database Explorer. |
| `CatalogTree.tsx` | Default-exported `CatalogTree` — the virtualized connection/catalog tree; also exports the `CatalogTreeSearchResult` type. |
| `CatalogTreeRows.tsx` | Presentational tree rows (`CatalogRelationRow`, `CatalogMissingRelationRow`, `CatalogObjectRow`); virtualization keys/expansion policy stay in `CatalogTree.tsx`. |
| `CatalogTreeStatus.tsx` | `CatalogTreeStatus` — renders the tree's mutually exclusive access/load/empty states. |
| `ConnectionNode.tsx` | Default-exported `ConnectionNode` — one connection's row in the tree, with its actions menu and drag source. |
| `SchemaConnectionGroupRow.tsx` | `SchemaConnectionGroupRow` — one schema-comparison group's row, showing diff-compatibility and change counts. |
| `KnowledgeProjectTree.tsx` | `KnowledgeProjectTree` — one Knowledge Project's database/source/analysis resources; injects a connection-catalog row renderer rather than loading catalogs itself. |
| `DdlModal.tsx` | Default-exported `DdlModal` — read-only DDL viewer dialog backed by `features/catalog/useTableDdl`. |
| `useCatalogTree.ts` | `useCatalogTree` plus helpers `shouldLoadCatalogDetails` and `databaseCatalogKey`; drives per-database catalog loading and the `CatalogLoadIssue` state consumed by `CatalogTreeStatus.tsx`. |
| `useCatalogTreeProjection.ts` | `useCatalogTreeProjection` — builds the filtered catalog and schema groups consumed by the virtual tree; rendering/expansion stays in `CatalogTree.tsx`. |
| `useDatabaseExplorerKnowledge.ts` | `useDatabaseExplorerKnowledge` — owns Knowledge Project inventory, resource expansion, and analysis query lifecycles consumed by Database Explorer. |
| `useDatabaseExplorerSearch.ts` | `useDatabaseExplorerSearch` — cross-catalog search result aggregation and keyboard result selection/navigation. |
| `catalogOverview.ts` | `catalogOverviewTable` and `catalogFromOverview` — build navigation-only `CatalogTable`/`Catalog` shapes from a lightweight `CatalogOverview` before full metadata arrives. |
| `schemaDiffPresentation.tsx` | `schemaDiffForConnection`, `schemaTableDiffTitle`, and the `SchemaDiffTrigger` button used to open a schema comparison from the tree. |

## For AI Agents

### Working In This Directory
- `ConnectionForm` is imported directly (not lazily) by
  `features/appShell/WorkbenchContent.tsx` for the `route.editing !== null`
  surface; `DatabaseExplorer` is mounted by `features/appShell/ShellLayout.tsx`
  as the left tool window, outside `WorkbenchContent`'s document switch.
- Connection identity and credentials are never handled in these files
  directly — editor tabs read/write through
  `features/connections/useConnectionEditorController`, and provider
  credentials go through `features/providers/ProviderCredentialDialog`. Per
  the repository's write-safety rule, connecting/reconnecting/repairing here
  must never change a pre-existing application user's role membership,
  password, grants, default privileges, or object ownership — only
  provision and verify new DopeDB-owned principals.
- Catalog loading state flows one direction: `useCatalogTree.ts` →
  `useCatalogTreeProjection.ts` → `CatalogTree.tsx` →
  `CatalogTreeRows.tsx`/`CatalogTreeStatus.tsx`. Do not add a second catalog
  fetch path inside a row or status component.
- `NUMERIC`/`MONEY`-bearing DDL or catalog values that reach the UI arrive as
  strings; do not parse them to `number`.
- Manual UI check: run `pnpm dev:app`, create/edit a connection through every
  tab, and confirm the Database Explorer tree, search, and schema-diff
  trigger still work.

### Testing Requirements
- No dedicated automated test under this directory; covered indirectly by
  `pnpm test` and `pnpm build`.

### Common Patterns
- Most files export a named function matching the filename (e.g.
  `export function ConnectionGeneralTab(...)`); only `CatalogTree.tsx` and
  `DdlModal.tsx` use a default export, and `ConnectionNode.tsx` is also a
  default export.
- Presentation components receive an already-resolved
  `ConnectionEditorController` (from
  `features/connections/useConnectionEditorController`) or catalog view model
  as props rather than calling hooks that reach into Tauri or the query cache
  themselves.

## Dependencies

### Internal
- `features/connections/` (domain, `useConnectionEditorController`,
  `presets`, `options`), `features/providers/` (credentials, managed access,
  provider domain), `features/catalogExplorer/` (`catalogDomain`,
  `scopeFilter`, `projectResources`), `features/knowledge/` (project/
  environment domain and dialogs), `features/workspaces/`
  (`WorkspaceConnectionDialog`), `features/catalog/useTableDdl`,
  `features/analysisArticles/` (query keys, list adapter), `lib/schemaDiff`.

### External
- `@tanstack/react-query` (`useQueries`, `useQueryClient`) for catalog and
  analysis-article reads.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
