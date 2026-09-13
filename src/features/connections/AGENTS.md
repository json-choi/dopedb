<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/connections

## Purpose

Owns the Connection domain end to end: the `ConnectionProfile` model, the
Connection editor (source/catalog/schema/BigQuery-onboarding/dialog
sub-controllers composed together), URL parsing/formatting, diagnostics and
test-failure recovery copy, and managed-connection recovery. Per
`tauriAdapter.ts`'s header comment, this file is "the only frontend owner of
saved-connection Tauri command names" — other features must go through it
rather than calling `invoke` for connection commands directly.

## Key Files

| File | Description |
|------|-------------|
| `ManagedConnectionRecoveryNotice.tsx` | Default-exported notice reusing the exact-connection recovery command in Safety and SQL error surfaces. |
| `ProviderTargetLabel.tsx` | `providerTargetDisplayName` and `ProviderTargetLabel` — renders a Neon-style branch target (`branchName`/`branchId`). |
| `bigQueryOnboardingModel.ts` | Pure BigQuery values shared by validation/queries/editor: `bigQueryAuthMode`, `isValidBigQueryProjectId`, `isValidBigQueryDatasetId`, `bigQueryResourceInputMode`. |
| `connectionDiagnosticMessage.ts` | Maps each `ConnectionDiagnosticCode` to a localized message key. |
| `connectionEditorModel.ts` | Pure editor types/engine rules shared across profile/catalog/schema controllers: `ConnectionEditorView`, `ConnectionTab`, SSL mode lists per engine, `STANDARD_CONNECTION_SOURCES`, `compatibleDrivers`, `sslModeForEngine`. |
| `connectionTestFailure.ts` | Projects a closed native connection-test receipt into localized recovery copy and an editor focus target, per its header comment, without inspecting driver message text. |
| `connectionUrl.ts` | `parseConnectionUrl`/`formatConnectionUrl` — URL translation for SQL, SQLite, and multi-host MongoDB connection strings; kept out of the editor UI per its header comment so the Tailwind editor stays focused on state/interaction. |
| `connectionVerificationAnalytics.ts` | `connectionVerificationRecorder` — captures one privacy-bounded verification analytics event; per its header comment, never exposes host, database, user, error detail, or credentials. |
| `diagnostics.ts` | `ConnectionDiagnosticCode`/`ConnectionDiagnostic` and `diagnoseConnection`, the validation pass a profile must pass before test/save is enabled. |
| `domain.ts` | Branded `ConnectionId`; `ConnectionEngine`, `ConnectionProvider`, `WorkspaceConnectionAccess`, `WorkspaceCredentialMode` (`local`\|`memberLocal`\|`managed`), `ConnectionProviderTarget`, `ConnectionProfile`, BigQuery auth types, `ConnectionTestFailureCode`. |
| `options.ts` | Connection option parameter keys/bounds (`dopedb.timeZone`, `dopedb.keepAliveSeconds`, `dopedb.sshAlias`, etc.) and `isConnectionOptionSupported`/`isSshHostAlias`. |
| `presets.ts` | `ConnectionLaunchPreset`, default ports, `blankConnection`, `demoSqliteConnection`/`isDemoSqliteConnection`/`findDemoSqliteConnection` for the guided demo. |
| `queries.ts` | `connectionQueryKeys` and `connectionsQuery`/`bigQueryAuthStateQuery`/`bigQueryProjectsQuery`/`bigQueryDatasetsQuery` (`queryOptions()`-based). |
| `tauriAdapter.ts` | `listConnections`, `listDrivers`, `installDriver`, `createDemoSqlite`, `upsertConnection`, `setConnectionsSchemaGroup`, `deleteConnection`, `testConnection`/`testConnectionProfile`, `discoverConnectionProfileDatabases`, BigQuery auth/discovery (`getBigQueryAuthState`, `authenticateBigQueryGoogleAccount`/`ServiceAccount`, `clearBigQueryServiceAccountAuth`, `discoverBigQueryProjects`/`Datasets`). |
| `useBigQueryOnboardingController.ts` | Owns BigQuery's local Google Cloud CLI authentication and bounded resource discovery; per its header comment, the editor receives only authentication availability and bounded resource identifiers, not raw credentials. |
| `useConnectionCatalogController.ts` | Driver/source catalog queries, search/selection state, driver installation, and the add-data-source command menu. |
| `useConnectionEditorController.ts` | Composes `useBigQueryOnboardingController`, `useConnectionCatalogController`, `useConnectionEditorDialogs`, `useConnectionProfileController`, `useConnectionProfileState`, and `useConnectionSchemaController` into one `ConnectionEditorController`. |
| `useConnectionEditorDialogs.ts` | Dialog visibility and return-focus anchors (provider credentials, workspace copy/credentials, problems panel) kept separate from profile/catalog state. |
| `useConnectionProfileController.ts` | Profile validation and save/test/delete lifecycle commands; editable draft mechanics stay in `useConnectionProfileState.ts`. |
| `useConnectionProfileState.ts` | Owns the editable profile draft, URL projection, connection options, and local command status shared by the editor's other controllers. |
| `useConnectionSchemaController.ts` | Schema discovery and the persisted introspection scope (`SCHEMA_SCOPE_PARAMETER`) projected by the editor's Schemas tab. |
| `useManagedConnectionRecovery.ts` | Owns the Desktop-to-Workspace-Web recovery command for one managed shared connection; per its header comment, the trusted console origin still comes from the native adapter, not this hook. |

## For AI Agents

### Working In This Directory

- `tauriAdapter.ts` is the sole owner of saved-connection command names —
  route new connection IPC through it, never call `invoke` for a connection
  command from another feature.
- Reconnect/repair/import flows in this feature must never change a
  pre-existing application user's role membership, password, grants, default
  privileges, PUBLIC/shared-role ACLs, or object ownership — see root
  `CLAUDE.md`/`AGENTS.md`'s "Work safely" section, which this feature
  directly implements. Provision new, verifiably DopeDB-owned principals
  instead of rewriting existing ones.
- `connectionVerificationAnalytics.ts` must not gain a path for host,
  database, user, error detail, or credentials — this is a verified privacy
  boundary, not a style choice.
- `connectionUrl.ts` stays UI-free; new URL formats should be added as pure
  parse/format functions here, not inline in the editor component.

### Testing Requirements

- No test file in this directory; not part of `pnpm test` or the 208-test
  budget. `providers/tauriAdapter.test.ts` and `queries/tauriAdapter.test.ts`
  (different features) are in the smoke suite — follow their pattern if a
  connections adapter test is later added.

### Common Patterns

- Every sub-controller returns its state as a typed `ReturnType<typeof use...>`
  export (e.g. `ConnectionEditorController`, `ConnectionProfileState`,
  `ConnectionCatalogController`), and `useConnectionEditorController.ts`
  composes them by construction rather than a shared context.
- Branded `ConnectionId` via `connectionId(value)`, matching the pattern in
  `jobs/domain.ts` and `erd/domain.ts`.

## Dependencies

### Internal

- `src/features/catalogExplorer/scopeFilter.ts` (`SCHEMA_SCOPE_PARAMETER`, `OBJECT_PATTERN_PARAMETER`, `isIntrospectionParameter`).
- `src/features/workspaces/tauriAdapter.ts` (`deleteWorkspaceConnection`, `updateWorkspaceConnection`, `onWorkspaceAccessCallback`, `workspaceManagedConnectionConsoleUrl`), `src/features/workspaces/domain.ts`.
- `src/features/providers/domain.ts` (`ProviderKind`).
- `src/features/productAnalytics/{client,outcomes}.ts`.
- `src/lib/{capabilities,queries}.ts`.
- Rust counterpart: `src-tauri/src/features/connections/transport.rs` (verified present).

### External

- `@tanstack/react-query`, `@tauri-apps/plugin-opener` (`openUrl`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
