<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/workspaces

## Purpose
Owns shared workspace/account identity, auth-state polling, and the workspace
switcher/connection-sharing flow — the frontend half of DopeDB's "workspace owns
shared access, members own credentials" product axis (root `AGENTS.md`, axis 1).
`tauriAdapter.ts`'s header states it is the only frontend owner of workspace Tauri
command names, and that bearer session tokens stay behind the Rust adapter: no
function here accepts or returns token material. `cache.ts` states components and
transport adapters never mutate shared workspace state directly — every
authoritative replacement and scope transition passes through it.

## Key Files
| File | Description |
|------|-------------|
| `authPolicy.test.ts` | Cross-checks workspace auth/login-callback URLs and deep-link handling against `src-tauri/tauri*.conf.json`, `src-tauri/capabilities/default.json`, and `workspace-cloud`'s deep-link module, plus a product-analytics fixture. |
| `authPolicy.ts` | Workspace identity stays visually stable while the server silently revalidates the OS-keychain session; defines recheck/retry backoff timing (`WORKSPACE_AUTH_RECHECK_MS`, `WORKSPACE_AUTH_RETRY_MS`, exponential `workspaceAuthRetryDelay`). Resource APIs still authorize every sensitive action regardless of this cached visual state. |
| `cache.ts` | Sole owner of authoritative workspace Query-cache replacement/invalidation and scope-transition cancellation. |
| `choices.ts` | Pure account/workspace option projection for the switcher and secure-copy dialog; composite values keep duplicate cross-account memberships distinct. |
| `domain.ts` | Branded `WorkspaceId`/`AccountId` and workspace wire/domain contracts. |
| `loginRequest.ts` | Window-event bus (`requestWorkspaceLogin`/`onWorkspaceLoginRequested`) routing contextual sign-in actions through the one shell-owned login lifecycle. |
| `navigation.ts` | Builds narrow Workspace Web destination URLs from the trusted console origin returned by the native adapter. |
| `queries.ts` | TanStack Query key/option definitions for workspace context and auth state. |
| `selectionRequest.ts` | Window-event bus (`requestWorkspaceSelection`/`onWorkspaceSelectionRequested`) routing contextual recovery actions through the shell-owned workspace menu. |
| `tauriAdapter.ts` | Sole frontend owner of workspace command names (Desktop login begin/complete/cancel, legacy device login/poll, sign-out, list/get/set active workspace, copy/bind/update/delete workspace connection, write-policy). |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `components/` | Workspace-facing UI: account menu, connection-sharing dialog, workspace switcher. Covered inline below (no separate `AGENTS.md`). |

### `components/` (covered inline)

| File | Description |
|------|-------------|
| `WorkspaceAccount.tsx` | Account-specific native loopback/PKCE login lifecycle and the unified local account menu; caches only public identity, session tokens stay behind Rust IPC. |
| `WorkspaceConnectionDialog.tsx` | Secure workspace connection flow: publishes only a redacted local template, or binds a member-local credential to an already-synchronized template. |
| `WorkspaceSwitcher.tsx` | Active workspace/project menu for the title toolbar; clears cached resource reads before the shell reloads the newly selected account scope. |

## For AI Agents

### Working In This Directory
- **Security invariant (verified in code):** `tauriAdapter.ts` and
  `WorkspaceAccount.tsx` never accept or return a bearer/session token; only
  Desktop uses public identity, a public authorization URL and an opaque attempt
  handle. PKCE verifier, callback code and session tokens stay native. Legacy
  device-auth adapters remain separate from the Desktop UI.
- **Security invariant (verified in code):** `cache.ts` is the only sanctioned
  place to replace or invalidate shared workspace Query state — do not call
  `queryClient.setQueryData`/`invalidateQueries` on workspace keys from a
  component or another adapter.
- **Security invariant (verified in code):** `WorkspaceConnectionDialog.tsx`
  publishes only a redacted template to the shared workspace record; a member's
  own credential is bound locally, never attached to the shared record (matches
  root `AGENTS.md` axis 1: "long-lived secrets never travel with the shared
  record").
- `authPolicy.ts`'s cached "visually stable" auth state must never itself gate a
  sensitive action; only a live resource-API check may authorize one.

### Testing Requirements
- `authPolicy.test.ts` is part of the `pnpm test` smoke suite
  (`vitest run src/features/workspaces/authPolicy.test.ts`) and counts against the
  208-test budget; extend it rather than adding a new top-level test file. It
  cross-reads Tauri config/capabilities files and `workspace-cloud` deep-link code,
  so a change to either side's callback URL shape must keep this test passing.

### Common Patterns
- `WorkspaceSwitcher.tsx` and `WorkspaceConnectionDialog.tsx` both route mutations
  through `cache.ts` (`invalidateWorkspaceContext`, `runWorkspaceAuthorityTransition`,
  `synchronizeWorkspaceScope`) rather than calling `tauriAdapter.ts` and the query
  client separately.

## Dependencies

### Internal
- `../connections` — `ConnectionId`, `ConnectionProfile`.
- `../providers` — `ProviderCredentialDialog`, `ProviderCredentialsMenuItem` (used from `WorkspaceAccount.tsx`).
- `../../lib/queryClient` — `cancelWorkspaceResourceQueries`, `resetWorkspaceResourceQueries`.
- `../../lib/externalLinks` — `AGENT_SETUP_URLS`, `DOPEDB_RELEASES_URL` (test-referenced).

### External
- `@tanstack/react-query`, `@tauri-apps/plugin-opener`.
- Rust: `src-tauri/src/features/workspaces/transport.rs` (also `adapters/`,
  `application/`, `application.rs`, `domain.rs`, `ports.rs`).
- Test-only: `workspace-cloud/lib/desktop-deep-link` (deep-link parity),
  `src-tauri/capabilities/default.json`, `src-tauri/tauri*.conf.json`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
