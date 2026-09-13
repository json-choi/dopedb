<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/features

## Purpose
Frontend feature modules for the workspace-cloud control-plane app, grouped by
product capability rather than by file type. `articleSharing/` renders and
administers Analysis Article handoff/invitation flows (server components plus
one client accept button). `connectionAccess/` carries a browser-only intent
across the Desktop deep-link round trip after a connection/grant change.
`providerAccess/` is the largest module: GCP Cloud SQL OAuth setup and Neon
Postgres branch management, shared-connection import, and managed-credential
recovery, split into domain types/parsers, transport/mutation helpers, and
React hooks that compose them for the `.tsx` view components. None of these
directories talk to a cloud provider's API directly — every mutation goes
through this app's own `app/api/v1/...` routes, which own the real provider
calls and database writes.

## Key Files

### articleSharing/
| File | Role | Description |
|------|------|-------------|
| `HandoffPage.tsx` | Server component | Authenticates the visitor, resolves either a direct Article scope or a pending invitation via `acceptance.ts`/`store.ts`, and renders the sign-in/handoff/desktop-open screen (`dopedb://article/...` deep link plus web download link). |
| `InvitationAcceptButton.tsx` | Client component | `"use client"` button that POSTs `/api/v1/article-invitations/{id}` to accept an invitation, then navigates to the resolved Article path; shows pending/failed states. |
| `acceptance.ts` | Server-only data module | `inspectArticleInvitation` (read-only preview) and `acceptArticleInvitation` (one transactional SQL statement that adds the recipient as an Analyst member and grants `read` on the Article's connection) against `workspace_control.workspace_article_invitation`. |
| `copy.ts` | i18n copy | `articleSharingCopy` en/ko string table consumed by the components above (not the shared `workspace-messages` catalog). |
| `store.ts` | Server-only data module | `loadArticleSharing`, `createArticleInvitation` (48h expiry, 50-invite cap), `revokeArticleInvitation`, and the shared `liveArticleSql` query that resolves an Article to its current workspace/connection/environment binding; also owns `articlePath`/`invitationUrl` path helpers and `parseInvitationEmail`. |

### connectionAccess/
| File | Role | Description |
|------|------|-------------|
| `DesktopAccessReturn.tsx` | Client component + context | `"use client"` component that reads/writes a `sessionStorage`-persisted `DesktopAccessReturnIntent` (via `lib/desktop-deep-link`) to show a "return to DopeDB" banner after the user is redirected back from a Desktop-initiated connection/grant flow; exposes `useDesktopAccessReturn()` so other components (e.g. GCP setup) can call `complete(connectionId)`. Carries no credentials — only non-secret intent state. |
| `grants.ts` | Mutation helper | `changeConnectionGrant` calls `/api/v1/workspaces/{id}/connections/{id}/grants` (POST to set, DELETE to remove) and orders the two so a capability reduction issues the DELETE before any new POST, using `hasWorkspaceConnectionCapability` from `lib/workspace-permissions` to detect a reduction. |

### providerAccess/
| File | Role | Description |
|------|------|-------------|
| `GcpCloudSetup.tsx` | Component | Renders the GCP Cloud SQL OAuth-return setup surface (project/instance pick, environment classification, IAM/production approvals) driven entirely by a `ProviderAccountAccessController` prop; exposes only target selection and approval checkboxes since WIF/IAM/service-account provisioning happens server-side. |
| `NeonBranchManager.tsx` | Component | Renders Neon branch inventory, create/switch/delete plans, approval decisions, and the "safe run" (checkpoint → isolate → execute → return) step tracker; calls `useNeonBranchManager` itself rather than receiving a controller prop. |
| `ProviderIntegrationList.tsx` | Component | Renders the connected-accounts list (OAuth providers, Neon API key, Vault AppRole) with connect/reconnect/disconnect actions, driven by a `ProviderAccountAccessController` prop. |
| `ProviderResourcePicker.tsx` | Component | Renders the account → database → review import wizard (including Neon environment classification and bootstrap preflight/apply) driven by a `SharedDatabaseAccessController` prop. |
| `domain.ts` | Domain types + parsers | Shared `Provider`/`Integration`/`SharedConnection`/`Resource` types, `selectableProviderResources` filtering, GCP setup types and strict runtime parsers (`parseGcpActiveLeaseConflict`, `parseGcpSetupPermissionCheck`), Neon bootstrap report types and strict parsers (`parseNeonBootstrapReport`/`Preflight`/`Apply`), and Vault AppRole config shaping (`vaultConfigurationPayload`). No fetch calls. |
| `gcpBootstrapTransport.ts` | Transport helper | `requestGcpBootstrap` POSTs the GCP bootstrap apply request and polls through `503 gcp_iam_propagation_pending` responses (bounded retry loop against a caller-supplied deadline) instead of retrying an ambiguous network failure. |
| `integrationMutations.ts` | Transport helper | `connectProviderIntegration` (POST `/api/v1/workspaces/{id}/provider-integrations`) and `disconnectProviderIntegration` (DELETE `.../provider-integrations/{id}`). |
| `managedConnectionRecovery.ts` | Browser-storage model | Reads/writes a versioned, TTL-bounded (`ManagedConnectionRecoveryIntent`) `sessionStorage` record identifying a GCP managed-connection repair in progress across the OAuth round trip, and resolves it against the live `managedConnections` snapshot (`resolveGcpManagedConnectionRecoveryTarget`). Pure model + storage I/O, no fetch. |
| `neonBranchManagerModel.ts` | View-model helpers | Pure functions deriving `NeonBranchManager` view state: `projectTargets` (dedups integration+project pairs), and locale-aware label/tone helpers (`operationLabel`, `operationTone`, `warningLabel`, `deletionBlockerLabel`, `branchEnvironment`, `safeRunPhase*`, `operationCatalogFingerprint`). |
| `neonBranchParsingPrimitives.ts` | Parsing primitives | Small reusable unknown-value validators (`record`, `exact`, `safeText`, `segment`, `uuid`, `instant`, `integer`, `nullable`, `oneOf`) used to build the strict Neon wire-contract parsers in `neonBranches.ts`. |
| `neonBranchSafeRun.ts` | Pure domain logic | `neonOperationProjectId` and `deriveNeonSafeRun`, which project one auditable checkpoint→isolate→execute→return "safe run" journey from durable branch inventory + operation history (no fetch, no React). |
| `neonBranches.ts` | Domain types + parsers | Largest module (779 lines): `NeonBranchInventory`/`NeonBranchOperation`/`NeonBranchCreatePlan`/`DeletePlan`/`SwitchPlan` types and their strict runtime parsers (`parseNeonBranchInventory`, `parseNeonBranchOperations`, `parseNeonBranchPlanResponse`); re-exports `deriveNeonSafeRun`/`neonOperationProjectId` from `neonBranchSafeRun.ts`. No fetch calls — pure wire-contract validation. |
| `providerAccountMutations.ts` | Mutation orchestrator | `providerAccountMutations` composes `connect`/`disconnect`/`beginConnect`/`beginReconnect`/`reconnectGcpSetup` on top of `integrationMutations.ts`, routing a GCP reconnect to managed-connection repair when a matching managed connection exists. |
| `state.ts` | State container | `ProviderAccessState` shape and `useProviderAccessState`, a `useReducer`-based store with a memoized per-field setter factory (`ProviderAccessFieldSetter`) shared by the account-access and shared-database-access hooks. |
| `transport.ts` | Transport helper | `fetchProviderAccountSnapshot` / `fetchProviderAccessWithManagedConnections` (GET `/api/v1/workspaces/{id}/provider-integrations`), `fetchSharedConnectionsSnapshot` (GET `.../connections`), and `providerResponseError` for localized error extraction. |
| `useGcpProviderSetup.ts` | Hook | Owns the GCP OAuth-return setup flow: project/instance inventory fetches, permission checks, active-lease conflict handling, and `completeGcpSetup` (drives `gcpBootstrapTransport.requestGcpBootstrap`); uses `useDesktopAccessReturn` from `connectionAccess/` to signal completion back to the Desktop-return banner. |
| `useGcpRecoveryState.ts` | Hook | Resolves the browser-persisted GCP recovery intent (`managedConnectionRecovery.ts`) against the server-loaded managed-connection inventory before `useGcpProviderSetup` may act on it; tracks `pending`/`targetMissing`. |
| `useManagedConnectionRecovery.ts` | Hook | `repairManagedConnection` callback: starts a target-pinned GCP OAuth repair (validates the returned `authorizationUrl` is `accounts.google.com`), persisting only non-secret identifiers via `saveManagedConnectionRecoveryIntent`. |
| `useNeonBranchManager.ts` | Hook | Largest hook (615 lines); sole state owner for Neon branch inventory/operations for `NeonBranchManager.tsx` — loads inventory + operations, and issues `planCreate`/`planDelete`/`planSwitch`/`mutateOperation` (approve/reject) against `/api/v1/workspaces/{id}/provider-integrations/{id}/neon-branches[/operations]`. |
| `useNeonProviderBootstrap.ts` | Hook | Owns Neon bootstrap classification/preflight/apply against `/api/v1/workspaces/{id}/provider-integrations/{id}/neon-bootstrap`, parsing responses through `domain.ts`'s `parseNeonBootstrapPreflight`/`Apply`. |
| `useProviderAccountAccess.ts` | Hook | Top-level controller for `GcpCloudSetup.tsx`/`ProviderIntegrationList.tsx`: loads the provider/integration snapshot, composes `useGcpProviderSetup`, `useGcpRecoveryState`, `useManagedConnectionRecovery`, and `providerAccountMutations`; exports `ProviderAccountAccessController` type. |
| `useSharedDatabaseAccess.ts` | Hook | Top-level controller for `ProviderResourcePicker.tsx`: owns shared-connection inventory, provider-resource discovery/import (`importDiscoveredResource`, `deleteSharedConnection`), and composes `useNeonProviderBootstrap` and `useManagedConnectionRecovery`; exports `SharedDatabaseAccessController` type. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `articleSharing/` | Analysis Article invitation handoff: server-rendered accept/open page, one client accept button, and the server-only SQL data layer for invitations and sharing metadata. |
| `connectionAccess/` | Browser-only intent tracking for the round trip back from Desktop after a connection/grant change; no credentials, no server calls of its own beyond the grant-change POST/DELETE. |
| `providerAccess/` | GCP Cloud SQL and Neon Postgres cloud-provider integration: OAuth/API-key setup, branch/database discovery and import, managed-credential recovery, split into domain/parsing, transport/mutation, and hook layers consumed by four `.tsx` views. |

## For AI Agents

### Working In This Directory
- Every network call in this tree targets this app's own `app/api/v1/...` routes (verified: no file here calls a provider API directly, matching the root `CLAUDE.md`/`AGENTS.md` rule that all provider traffic goes through the official CLI or, for workspace-cloud, this app's own control-plane routes).
- `providerAccess/` layers strictly: `domain.ts`/`neonBranches.ts`/`neonBranchParsingPrimitives.ts` (types + strict unknown-value parsers, no I/O) → `transport.ts`/`integrationMutations.ts`/`gcpBootstrapTransport.ts` (fetch wrappers) → `state.ts` (reducer) → `use*.ts` hooks (compose transport + state) → `.tsx` components (render a hook's or a passed-down controller's return value). `GcpCloudSetup.tsx` and `ProviderIntegrationList.tsx` take a `ProviderAccountAccessController` prop; `ProviderResourcePicker.tsx` takes a `SharedDatabaseAccessController` prop; `NeonBranchManager.tsx` is the one component that calls its hook (`useNeonBranchManager`) directly.
- Contrary to a naive filename-only read, `providerAccess/` does **not** import `lib/control-plane-contracts.ts`, `lib/providers/adapter-contract.ts`, `lib/providers/vault-contracts.ts`, or `lib/providers/neon-branch-operations/contracts.ts` — its wire-contract types and strict parsers (e.g. `parseNeonBranchInventory`, `parseNeonBootstrapReport`) are defined locally in `domain.ts`/`neonBranches.ts`. Verify against the actual server-side contracts in `../lib/` before assuming shape parity.
- `providerAccess/useGcpProviderSetup.ts` imports `useDesktopAccessReturn` from `../connectionAccess/DesktopAccessReturn`, so `connectionAccess/` is a real dependency of `providerAccess/`, not just an adjacent sibling.
- `articleSharing/store.ts` and `acceptance.ts` are `"server-only"` and run one durable SQL statement per mutation (advisory-lock + CTE) rather than multiple round trips — read the full statement before changing invitation semantics; it never recreates removed membership or grants on a re-accept.

### Testing Requirements
- No colocated `*.test.ts`/`*.spec.ts`/`*.harness.ts` files exist under `features/` (verified by search). `pnpm workspace:cloud:build` is the only check that type-checks this directory (Next.js build). This app's dedicated Vitest suites (`pnpm --dir workspace-cloud test:contracts`, `test:postgres-harness-guard`, `test:postgres-import`, `test:d1-import`) only include harness files under `lib/`, not anything in `features/`.
- Manually exercise changed screens per the root `CLAUDE.md`/`AGENTS.md` UI-change rule; there is no automated coverage substitute here.

### Common Patterns
- Controller hook returns a single object mixing state and actions (e.g. `useProviderAccountAccess` returns `providers`, `loading`, `error` alongside `connect`, `disconnect`, `beginReconnect`); components destructure only what they render.
- Strict unknown-value parsing before trusting any fetch response: every domain type has a paired `parse*` function that rejects unexpected extra/missing keys (`strictRecord`/`exact`) rather than doing a partial cast — see `domain.ts`'s `parseNeonBootstrapReport` or `neonBranchParsingPrimitives.ts`.
- Locale copy is pulled from the shared `../../lib/workspace-messages` catalog per-namespace (`workspaceMessages[locale].providerAccess`, `.neonBranches`, `.gcpSetup`, `.providerList`, `.resourcePicker`) except `articleSharing/`, which keeps its own small `copy.ts` table instead.

## Dependencies

### Internal
- `../../lib/db`, `../../lib/env` — server-only DB client and origin URL (used by `articleSharing/store.ts` and `acceptance.ts`).
- `../../lib/authoritative-session` — session resolution in `articleSharing/HandoffPage.tsx`.
- `../../lib/workspace-locale`, `../../lib/workspace-locale-server` — locale path helpers.
- `../../lib/workspace-messages` — the shared i18n copy catalog consumed by `connectionAccess/` and every `providerAccess/` component/hook.
- `../../lib/workspace-provider-copy` — `localizedProviderMessage`, `localizedIntegrationDisplayName`, `localizedNeonFindingText`.
- `../../lib/workspace-permissions` — `hasWorkspaceConnectionCapability` in `connectionAccess/grants.ts`.
- `../../lib/desktop-deep-link` — session-storage intent codec used by `connectionAccess/DesktopAccessReturn.tsx`.
- `../../app/components/*` (`Brand`, `LocaleSwitcher`, `Identity*`, `Controls`, `Console`, `WorkspaceLocale`) — shared UI primitives rendered by the components in this tree.
- `app/api/v1/workspaces/{id}/provider-integrations`, `.../connections`, `.../connections/{id}/grants`, `.../provider-integrations/{id}/gcp-setup`, `.../neon-branches[/operations]`, `.../neon-bootstrap`, `.../imports`, and `app/api/v1/article-invitations/{id}` — the server routes every transport/mutation module in this tree calls.
- `providerAccess/` internally: hooks depend on `state.ts`, `transport.ts`, `domain.ts`, `neonBranches.ts`; `useProviderAccountAccess.ts` composes `useGcpProviderSetup`, `useGcpRecoveryState`, `useManagedConnectionRecovery`; `useSharedDatabaseAccess.ts` composes `useNeonProviderBootstrap` and `useManagedConnectionRecovery`.

### External
- `react` (`useState`, `useReducer`, `useCallback`, `useEffect`, `useMemo`, `useRef`, `createContext`/`useContext`) — every hook and client component.
- `next/headers`, `next/navigation` — `articleSharing/HandoffPage.tsx` (server component).
- `drizzle-orm` (`sql` template tag) — `articleSharing/store.ts` and `acceptance.ts`.
- No `@tanstack/react-query` usage in this directory — reads go through hand-written `fetch` + `useEffect`/`useCallback` controllers, not TanStack Query (unlike the `screens`/`useEffect`+`invoke` rule for the Tauri desktop app, this is the separate Next.js control-plane app).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
