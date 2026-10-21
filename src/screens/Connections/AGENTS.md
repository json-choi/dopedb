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
| `ConnectionProfilePanel.tsx` | `ConnectionProfilePanel` — editor header, tab strip, diagnostics summary, and check status from grouped view models. |
| `ConnectionTestStatus.tsx` | `ConnectionTestFailureNotice` (the last check outcome with its one recovery action) and `ConnectionTestActionBar` (Test/Stop, why a check is unavailable, and persistent live regions for each result). |
| `ResourceStatus.tsx` | `ResourceStatus` — loading/empty/failed-with-refresh state of a provider resource list (BigQuery projects and datasets, Cloudflare D1 accounts and databases). |
| `ConnectionGeneralTab.tsx` | `ConnectionGeneralTab` — General properties (name, engine, host/port/database) from profile/driver/workspace-dialog view models. The local password row renders in field and URL-only modes, so every credential recovery finds `connection-password`. |
| `ConnectionTeamFields.tsx` | Team-connection rows of the General tab: transport security the team connection or its provider owns (read-only where a binding or integration owns it), schema group labels, and the member credential state with its binding command. |
| `ConnectionCredentialMethodRow.tsx` | The credential method select of a new team connection (each member's own account, provider-managed short-lived credentials, per-member DopeDB accounts); shared by the General tab and the method flows. |
| `ConnectionMethodFlow.tsx` | Hosts the provider-managed import and per-member-account flows inside the editor, reusing the step components and controllers in `features/workspaceAdmin/providers/databases`; shows the provider-account requirement with a link to Providers. |
| `ConnectionTeamPanel.tsx` | Team-connection administration inside the editor of a connection the member manages: preserved-edit conflict review and the guarded deletion of a connection with per-member DopeDB accounts. |
| `ConnectionPromotionNotice.tsx` | Explorer notice for connections that were only on this device in a team workspace: a toast per newly shared batch and persistent reasons the rest stay local. |
| `ConnectionDatabaseField.tsx` | Native target-database field and accessible loading/empty/error discovery feedback; late suggestions never move focus from another control. A discovery refused because the endpoint moved offers an explicit "Enter password" command. |
| `ConnectionOptionsTab.tsx` | `ConnectionOptionsTab` — runtime-backed connection/session options; mutation/validation stays in the feature controller. |
| `ConnectionAdvancedTab.tsx` | `ConnectionAdvancedTab` — free-form driver parameters and capabilities from grouped profile/catalog view models. |
| `ConnectionSchemaTab.tsx` | `ConnectionSchemaTab` — discovered namespaces and saved introspection scope; does not query catalog adapters directly. |
| `ConnectionSecurityTab.tsx` | `ConnectionSecurityTab` — TLS and SSH alias properties; no file picking or validation state owned here. |
| `ConnectionBigQueryFields.tsx` | `ConnectionBigQueryFields` — BigQuery's official-CLI profile fields, kept separate from socket/password fields. |
| `ConnectionCatalogCompactSelector.tsx` | `ConnectionCatalogCompactSelector` — compact catalog (engine/provider) selector used below the editor's wide-layout breakpoint. |
| `ConnectionCatalogDetail.tsx` | `ConnectionCatalogDetail` — selected cloud provider or driver details from the catalog view model, does not load or mutate catalog state. |
| `ConnectionCatalogNavigation.tsx` | `ConnectionCatalogNavigation` — catalog navigation and source commands in the editor; query/mutation ownership stays in feature controllers. |
| `ConnectionSourcePicker.tsx` | `ConnectionSourcePicker` — shared source groups and commands rendered inline for new connections and in the explicit add popup for existing editors. |
| `ConnectionEditorDialogs.tsx` | `ConnectionEditorDialogs` — provider-credential and workspace-binding dialogs driven by dialog controller state. |
| `ConnectionEditorFooter.tsx` | `ConnectionEditorFooter` — editor footer actions for profile and catalog editor modes. |
| `ManagedWorkspaceConnectionField.tsx` | `ManagedWorkspaceConnectionField` — presents the server-owned managed endpoint boundary and its exact Web recovery command. |
| `DatabaseExplorer.tsx` | `DatabaseExplorer` — sidebar connection tree, DDL modal host, schema-group drag-and-drop; the piece `ConnectionForm.tsx` was split out of. |
| `DatabaseExplorerToolbar.tsx` | `DatabaseExplorerToolbar` — toolbar and scoped search controls for the Database Explorer tool window. |
| `DatabaseExplorerEmptyState.tsx` | `DatabaseExplorerEmptyState` — first-run start list (renders `features/connections/ConnectionStartList`) shown when the workspace has no local connections. |
| `DatabaseExplorerOverlays.tsx` | `DatabaseExplorerOverlays` — footer, setup dialogs, drag preview, the schema-group change confirmation dialog, and modal overlays for Database Explorer. |
| `CatalogTree.tsx` | Default-exported `CatalogTree` — the virtualized connection/catalog tree; also exports the `CatalogTreeSearchResult` type. |
| `CatalogTreeRows.tsx` | Presentational tree rows (`CatalogRelationRow`, `CatalogMissingRelationRow`, `CatalogObjectRow`) and a relation's metadata rows (`CatalogMetadataSectionRow`, `CatalogColumnRow`, `CatalogKeyRow` for primary/unique/foreign-with-target/check keys, `CatalogIndexRow`), each its own tree item; virtualization keys/expansion policy stay in `CatalogTree.tsx`. |
| `CatalogTreeStatus.tsx` | `CatalogTreeStatus` — renders the tree's mutually exclusive access/load/empty states. |
| `ConnectionNode.tsx` | Default-exported `ConnectionNode` — one connection's row in the tree, with its actions menu and drag source. |
| `SchemaConnectionGroupRow.tsx` | `SchemaConnectionGroupRow` — one schema-comparison group's row, showing diff-compatibility and change counts against the member-chosen baseline. |
| `KnowledgeProjectTree.tsx` | `KnowledgeProjectTree` — one Knowledge Project's database/source/analysis resources; injects a connection-catalog row renderer rather than loading catalogs itself. |
| `useCatalogTree.ts` | `useCatalogTree` plus helpers `shouldLoadCatalogDetails` and `databaseCatalogKey`; drives per-database catalog loading and the `CatalogLoadIssue` state consumed by `CatalogTreeStatus.tsx`. |
| `useCatalogTreeProjection.ts` | `useCatalogTreeProjection` — builds the filtered catalog and schema groups consumed by the virtual tree; rendering/expansion stays in `CatalogTree.tsx`. |
| `useDatabaseExplorerKnowledge.ts` | `useDatabaseExplorerKnowledge` — owns Knowledge Project inventory, resource expansion, and analysis query lifecycles consumed by Database Explorer. |
| `useDatabaseExplorerSearch.ts` | `useDatabaseExplorerSearch` — cross-catalog search result aggregation and keyboard result selection/navigation. |
| `catalogOverview.ts` | `catalogFromOverview` — builds the navigation `Catalog` from a lightweight `CatalogOverview` (via `features/catalog`'s `navigationTableFromOverview`) and hydrates rows from the shared full snapshot. |
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
  `ConnectionNode.tsx` use a default export.
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
