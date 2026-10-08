<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-08 | Updated: 2026-10-08 -->

# src-tauri/src/features/workspace_admin

## Purpose

Desktop workspace administration. Members, connection grants, provider
integrations, shared-database import, Neon branches, backups, key rotation,
workspace deletion and account sessions stay owned by the hosted control plane;
this feature sends one closed, validated operation at a time with the signed-in
account's Bearer session and returns `{status, body}` to Settings. The Bearer
session never crosses into the webview, and Desktop never stores provider
secrets it forwards.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | `WorkspaceAdminFeature = WorkspaceAdminUseCases<HostedWorkspaceAdmin>`, `compose()`, and the test-only `assert_workspace_admin_contract()` run by the queries security test. |
| `domain.rs` | Request/response types, `AdminRoute` (method, literal/UUID path segments, query, zeroizing body, expected revision, timeout, response cap), size/time limits, the provider start-URL validator, and the signed-in-account check. |
| `domain/operation.rs` | The closed `WorkspaceAdminOperation` catalog: an internally tagged enum (`kind`) with camelCase fields and `deny_unknown_fields`. |
| `domain/routes.rs` | Maps every operation to its exact control-plane method, path, query and JSON body; validates names, confirmations, opaque tokens, plan hashes and bounded provider payloads. |
| `domain/values.rs` | Closed value enums (roles, capabilities, provider kinds, Neon actions, GCP inventory) and `SecretText`, a zeroizing secret with redacted `Debug`. |
| `ports.rs` | `WorkspaceAdminControlPlanePort` (`execute`, `origin`). |
| `application.rs` | `execute` and `start_provider_authorization`; both refuse an account that is not signed in on this device. |
| `adapters.rs` | `HostedWorkspaceAdmin`: loads the account's keychain session, builds the URL with `path_segments_mut`, applies per-route timeout and size caps, and parses only bounded JSON. |
| `transport.rs` | Tauri commands `workspace_admin_request` and `start_workspace_provider_authorization` (opens the validated same-origin start page with the system browser). |

## For AI Agents

### Working In This Directory

- **Security invariant (verified in code):** the frontend picks an operation from
  the closed catalog; it never sends a path, method, header or URL. Paths are built
  only from literals and typed UUIDs, so a request cannot reach another route.
- **Security invariant (verified in code):** the Bearer session is read from the
  keychain inside the adapter and is never returned, logged or placed in an error.
  A missing session is `AuthenticationRequired`.
- **Security invariant (verified in code):** `start_workspace_provider_authorization`
  opens only `<control-plane origin>/auth/provider/start?state=...` after checking
  scheme, host, port, path and a single base64url state. Provider callbacks still
  bind the browser session's user to the state's user on the server.
- Adding an operation means adding the variant in `operation.rs`, its route in
  `routes.rs`, the TypeScript union member in `src/features/workspaceAdmin/domain.ts`
  with the same field names, and a contract assertion in `domain.rs`.
- Keep `domain.rs` and its submodules free of Tauri, keychain and HTTP client types;
  only `adapters.rs` and `transport.rs` touch them.

### Testing Requirements

- `pnpm test:rust` runs `assert_workspace_admin_contract()` inside the existing
  `query_and_skill_security_contracts_stay_fail_closed` test. Extend those
  assertions instead of adding a new test (208-test budget).

## Dependencies

### Internal

- `crate::connection::keychain::fetch_workspace_session` for the account's Bearer session.
- `crate::hosted_control_plane` for the client, origin and expected-revision header.
- `crate::kernel::identity` for typed account, workspace, connection and integration ids.
- `crate::state::AppState` (transport only) for the signed-in accounts from the `workspaces` feature.

### External

- `reqwest`, `url`, `serde`/`serde_json`, `uuid`, `zeroize`, `tauri`, `tauri-plugin-opener`.
