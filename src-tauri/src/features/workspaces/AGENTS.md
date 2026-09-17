<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/workspaces

## Purpose

Account-aware workspace feature: Desktop loopback PKCE authentication,
account/workspace selection, membership, shared-connection publication, and
ordered remote-change synchronization. This is the Rust-side home of the
"workspace owns shared access, members own credentials" product axis — Bearer
sessions and authorization-code exchanges stay in Rust and never cross into the
webview, logs, local SQLite, or frontend query caches.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | `WorkspacesFeature = WorkspaceUseCases<SqliteWorkspaceRepository, ConnectionWorkspaceRuntime, HostedWorkspaceControlPlane, dyn ConnectionCredentialVault, ProcessWorkspaceConfiguration, SystemWorkspaceSshProfile>`; `compose(store, connections, credentials)`. |
| `domain.rs` | Workspace domain values and invariants; no Tauri/SQLite/HTTP/keychain/pool details — typed identities keep account/workspace/connection selectors from being exchanged accidentally while preserving the existing string/UUID wire shape. |
| `ports.rs` | Platform ports required by workspace use cases. |
| `transport.rs` | Tauri transport adapter for workspace use cases. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | Concrete SQLite, connection-runtime, process-configuration, SSH-profile, deep-link, and hosted control-plane adapters, including the `control_plane/` HTTP exchange group. |
| `application/` | Account-aware workspace use cases split by concern (authentication, navigation, sharing). |

**`adapters/`**

| File | Description |
|------|-------------|
| `mod.rs` | Concrete workspace adapters (module root). |
| `local.rs` | Local SQLite, connection-runtime, and process-configuration adapters. |
| `desktop_callbacks.rs` | Token-free Desktop access and article navigation callbacks; neither establishes a login session. |
| `desktop_login.rs` / `desktop_login/` | Desktop-only ephemeral IPv4 loopback listener, bounded callback parser, PKCE handoff, cancellation, and serialized account commit. |
| `control_plane.rs` | Hosted Better Auth Desktop PKCE adapter; network exchange and credential persistence stay in Rust so Bearer sessions never cross into the webview, logs, local SQLite, or frontend query caches. |
| `control_plane/` | Split HTTP exchange modules — see below. |

**`adapters/control_plane/`**

| File | Description |
|------|-------------|
| `authentication.rs` | Desktop authorization code, session, and membership HTTP exchanges. |
| `connections.rs` | Redacted shared-connection and managed-lease HTTP exchanges. |
| `provider_local_target.rs` | Redacted shared-connection and short-lived provider-lease HTTP exchanges. |
| `sync.rs` | Payload-free ordered workspace change cursor exchange. |

**`application/`**

| File | Description |
|------|-------------|
| `mod.rs` (`application.rs`) | Account-aware workspace use cases; mutation ordering/rollback policy live in the child modules, with SQLite/hosted HTTP/keychain/pool/environment/Tauri details behind ports. |
| `authentication.rs` | Authentication lifecycle use cases. |
| `navigation.rs` | Workspace/account selection and remote synchronization use cases. |
| `sharing.rs` | Shared connection publication and member-local credential binding use cases. |

## For AI Agents

### Working In This Directory

- A Bearer session or authorization code must never reach the webview,
  logs, local SQLite, or a frontend query cache — keep it inside
  `adapters/control_plane/` and the in-memory session state it feeds.
- Desktop browser login uses `127.0.0.1` with an OS-assigned port, exact
  `/callback`, native-only PKCE verifier, and one-use state. The authorization
  code never crosses IPC. Callback waiting holds no Broker authority gate;
  token exchange and account activation share the existing authority fence.
  Replacement, cancellation, and process shutdown close the listener. Token-free access and article deep links remain navigation-only.
- Shared-connection publication (`application/sharing.rs`) must keep
  long-lived secrets out of the shared record — member-local access stays in
  the OS credential store, managed access issues a short-lived,
  member-specific credential instead.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`). The frontend
  `src/features/workspaces/authPolicy.test.ts` (3 tests) is part of the
  208-test critical budget and protects the corresponding client-side
  authentication/consent contracts this feature's transport backs.

### Common Patterns

- `compose(store, connections, credentials) -> WorkspacesFeature` composes a
  single generic `WorkspaceUseCases<...>` over six concrete adapter types in
  one call (no staged/two-phase composition, unlike `providers`).

## Dependencies

### Internal

- Imports `crate::features::{analysis_articles, connections}` and
  `crate::kernel::{access, identity}`.
- Imported by `crate::features::knowledge` and `crate::features::providers`
  (workspace-scoped grants/authority) and `crate::features::queries`.

### External

- `reqwest`, `sqlx`, `keyring` (via `ConnectionCredentialVault`),
  `tauri-plugin-deep-link`.
- Frontend adapter: `src/features/workspaces/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
