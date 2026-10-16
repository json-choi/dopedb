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
| `ConnectionCredentialRecoveryNotice.tsx` | SQL result notice for a run that could not use this device's credential: enter a local password or connect a shared member credential (through `requestConnectionCredentials`), sign in to the workspace again, or renew a provider sign-in in the editor; a refused OS credential store has its own copy. |
| `ProviderTargetLabel.tsx` | `providerTargetDisplayName` and `ProviderTargetLabel` — renders a Neon-style branch target (`branchName`/`branchId`). |
| `bigQueryOnboardingModel.ts` | Pure BigQuery values shared by validation/queries/editor: `bigQueryAuthMode`, `isValidBigQueryProjectId`, `isValidBigQueryDatasetId`, `bigQueryResourceInputMode`. |
| `connectionDiagnosticMessage.ts` | Maps each `ConnectionDiagnosticCode` to a localized message key. |
| `connectionEditorShellBridge.ts` | The editor's contract with shell navigation: any surface asks the shell to open a connection at its credential with `requestConnectionCredentials`, `useCredentialRecoveryEntry` opens an editor launched for credential recovery at its password field or member binding, `useConnectionEditorLeaveGuard` registers the guard the shell consults before Settings or Workspace management replace the editor, and a one-shot marker makes the editor's own Workspace management requests (managed recovery, shared database add) open over it and return to it. |
| `connectionEditorModel.ts` | Pure editor types/engine rules shared across profile/catalog/schema controllers: `ConnectionEditorView`, `ConnectionTab`, SSL mode lists per engine, `STANDARD_CONNECTION_SOURCES`, `compatibleDrivers`, `sslModeForEngine`. |
| `connectionTestFailure.ts` | Projects a closed native connection-test receipt into localized recovery copy and an editor focus target, per its header comment, without inspecting driver message text. A check refused before contacting a server (`refusal: "savedCredentialEndpointChanged"`) and a local save refused with `credentialBindingRequired` share the dedicated "enter the saved password again" copy; a `retryLater` refusal keeps its network-family title with the live remaining seconds, and `sharedConnectionChanged` asks for a workspace refresh. |
| `connectionUrl.ts` | `parseConnectionUrl`/`formatConnectionUrl` — URL translation for SQL, SQLite, and multi-host MongoDB connection strings; kept out of the editor UI per its header comment so the Tailwind editor stays focused on state/interaction. |
| `connectionVerificationAnalytics.ts` | `connectionVerificationRecorder` — captures one privacy-bounded verification analytics event; per its header comment, never exposes host, database, user, error detail, or credentials. |
| `diagnostics.ts` | `ConnectionDiagnosticCode`/`ConnectionDiagnostic` and `diagnoseConnection`, the validation pass a profile must pass before test/save is enabled. |
| `domain.ts` | Branded `ConnectionId`; `ConnectionEngine`, `ConnectionProvider`, `WorkspaceConnectionAccess`, `WorkspaceCredentialMode` (`local`\|`memberLocal`\|`managed`), `ConnectionProviderTarget`, `ConnectionProfile`, BigQuery auth types, `ConnectionTestFailureCode`, `ConnectionProbeRefusal`, and the check and `DatabaseDiscoveryReceipt` wire receipts. |
| `options.ts` | Connection option parameter keys/bounds (`dopedb.timeZone`, `dopedb.keepAliveSeconds`, `dopedb.sshAlias`, etc.) and `isConnectionOptionSupported`/`isSshHostAlias`. |
| `presets.ts` | `ConnectionLaunchPreset` (engine/provider plus the endpoint a local listener suggestion proved reachable), default ports, `blankConnection`, `demoSqliteConnection`/`isDemoSqliteConnection`/`findDemoSqliteConnection` for the guided demo. |
| `queries.ts` | `connectionQueryKeys` and `connectionsQuery`/`localDatabaseListenersQuery`/`bigQueryAuthStateQuery`/`bigQueryProjectsQuery`/`bigQueryDatasetsQuery` (`queryOptions()`-based). |
| `tauriAdapter.ts` | `listConnections`, `listDrivers`, `installDriver`, `createDemoSqlite`, `upsertConnection`, `setConnectionsSchemaGroup`, `deleteConnection`, `testConnection`/`testConnectionProfile`, `discoverConnectionProfileDatabases`, `discoverLocalDatabaseListeners`, BigQuery auth/discovery (`getBigQueryAuthState`, `authenticateBigQueryGoogleAccount`/`ServiceAccount`, `clearBigQueryServiceAccountAuth`, `discoverBigQueryProjects`/`Datasets`). |
| `useBigQueryOnboardingController.ts` | Owns BigQuery's local Google Cloud CLI authentication and bounded resource discovery; per its header comment, the editor receives only authentication availability and bounded resource identifiers, not raw credentials. |
| `useConnectionCatalogController.ts` | Driver/source catalog queries, search/selection state, driver installation, the add-data-source command menu, and the owner/admin-only shortcut that opens Workspace management → Providers at the shared database add flow through `requestWorkspaceAdmin`. |
| `useConnectionEditorController.ts` | Composes `useBigQueryOnboardingController`, `useConnectionCatalogController`, `useConnectionEditorDialogs`, `useConnectionProfileController`, `useConnectionProfileState`, and `useConnectionSchemaController` into one `ConnectionEditorController`, and applies the shell bridge's entry and leave hooks. |
| `useConnectionEditorDialogs.ts` | Dialog visibility and return-focus anchors (provider credentials, workspace copy/credentials, problems panel) kept separate from profile/catalog state. |
| `useConnectionProfileController.ts` | The profile's save/delete/duplicate/cancel lifecycle with phase-specific save failures, and the grouped editor projection; composes `useConnectionProblems` and `useConnectionTestCommand`. A local save refused because the endpoint moved returns focus to the password field. It also owns the refusal recoveries the check notice offers: resynchronizing a changed shared connection (`refreshDesktopConnections`) and signing in to the workspace again over the editor. Editable draft mechanics stay in `useConnectionProfileState.ts`. |
| `useConnectionProblems.ts` | Diagnostics revealed after a touch or an attempt, inline field validation, the Problems list including the last check outcome, and navigation from a problem to the tab, field, or member binding that fixes it. |
| `useConnectionTestCommand.ts` | The cancellable check: request identity that drops stopped or superseded receipts, and the outcome. A typed failure opens Problems while the action bar's persistent alert announces its title. A refusal made before contacting a server opens no Problems and records no verification; a moved endpoint focuses the password field, and only a runtime `retryLater` starts a cooldown, from the wait the runtime reported. |
| `useConnectionDatabaseDiscovery.ts` | Ephemeral database discovery keyed by the draft's endpoint revision; focus starts it once per endpoint, ready/empty lists are reused, only the retry command repeats it, and late responses are rejected. A refused discovery offers an explicit command to the password field rather than moving focus away from the field that started it. |
| `useLocalListenerDiscovery.ts` | Loopback listener discovery for the first-run Welcome; each probe is one explicit run (a finished run may be repeated on request, never polled) and returns suggestions that only the connection editor can turn into a saved profile. |
| `useConnectionProfileState.ts` | Owns the editable profile draft, connection options, required-field reveal state, saved-password removal, tab focus (`tabs.focusField`), and local command status shared by the editor's other controllers, including the check cooldown (`status.retrySeconds`) that the action bar and failure copy count down together and the stage of a failed command (`status.showError`) that titles it in Problems; composes the three draft hooks below. |
| `useConnectionUrlDraft.ts` | The connection URL input mode, URL draft, its parse into the profile draft, and clipboard import; a parsed password goes only to the credential field. |
| `useAdvancedParameterRows.ts` | Free-form driver parameter rows with stable ids; the profile receives only the effective map, and blank or reserved keys never reach it. |
| `useConnectionDraftChanges.ts` | The unsaved-change fingerprint against the last saved baseline and the confirmation required before discarding a dirty draft. |
| `useConnectionSchemaController.ts` | Schema discovery and the persisted introspection scope (`SCHEMA_SCOPE_PARAMETER`) projected by the editor's Schemas tab. |
| `useManagedConnectionRecovery.ts` | Owns the repair command for one managed shared connection: opens Workspace management → Providers focused on that database through `requestWorkspaceAdmin`, and runs the caller's refresh once when Settings reports that database repaired. |

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
- `src/features/workspaces/tauriAdapter.ts` (`deleteWorkspaceConnection`, `updateWorkspaceConnection`), `src/features/workspaces/domain.ts`.
- `src/features/workspaceAdmin/navigationRequest.ts` (`requestWorkspaceAdmin`) and `src/features/workspaceAdmin/providers/gcp/repairSignal.ts` (`onManagedConnectionsRepaired`) for managed-connection recovery.
- `src/features/providers/domain.ts` (`ProviderKind`).
- `src/features/productAnalytics/{client,outcomes}.ts`.
- `src/lib/{capabilities,queries}.ts`.
- Rust counterpart: `src-tauri/src/features/connections/transport.rs` (verified present).

### External

- `@tanstack/react-query`, `@tauri-apps/plugin-opener` (`openUrl`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
