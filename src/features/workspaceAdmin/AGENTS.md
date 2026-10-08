<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-08 | Updated: 2026-10-08 -->

# src/features/workspaceAdmin

## Purpose

Desktop Settings surfaces for workspace administration: the account area
(other sessions, workspaces scheduled for deletion), workspace creation, and for
the active team workspace the members, database access, providers and owner-only
backups/deletion sections. Every read and write goes through one Tauri command
with a closed operation; the Bearer session and provider OAuth state stay in Rust
(`src-tauri/src/features/workspace_admin`).

## Key Files

| File | Description |
|------|-------------|
| `domain.ts` | Wire contracts mirroring the Rust `WorkspaceAdminOperation` enum, plus `WorkspaceAdminScope`. |
| `tauriAdapter.ts` | The only owner of the `workspace_admin_request` and `start_workspace_provider_authorization` command names. |
| `requests.ts` | `runWorkspaceAdmin`, `WorkspaceAdminRequestError` (status, code, body), session-rejection detection and localized error text. |
| `scope.ts` | `workspaceAdminScope` / `useWorkspaceAdminScope`: the exact signed-in account, team workspace and role; `null` for personal, disabled or signed-out states. |
| `queryKeys.ts` | `workspaceAdmin` and `workspaceAccountAdmin` query roots, keyed by account and workspace and cleared on any scope change. |
| `navigationRequest.ts` | `requestWorkspaceAdmin(section, focus?)` / `onWorkspaceAdminRequested`, and a one-time, 60-second database focus for managed-connection recovery. |
| `useWorkspaceAdminRequests.ts` | Lets the shell, which owns the Settings route, answer those requests. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `account/` | Account section: other sessions (revoke) and owned workspaces pending deletion (cancel). |
| `workspaces/` | New-workspace dialog. |
| `members/` | Member directory, invitations, role changes and removal. |
| `access/` | Database access: team read sharing, member grants, conflict review, shared-database removal. |
| `providers/` | Provider accounts (`accounts/`), Google Cloud SQL setup (`gcp/`), managed database import and Neon bootstrap (`databases/`), and the Neon branch manager (`neonBranches/`). |
| `lifecycle/` | Owner-only backups, encryption-key rotation and workspace deletion. |

## For AI Agents

### Working In This Directory

- **Security invariant (verified in code):** no file here builds a control-plane
  URL, sends a header or sees a token; operations are typed values passed to
  `tauriAdapter.ts`.
- Reads use TanStack Query options under the two roots in `queryKeys.ts`; mutations
  invalidate only their own area's keys. Changes that alter the member's own
  authority (role, grants, team read, workspace creation or cancelled deletion) ask
  `WorkspaceAccount` to refresh through `requestWorkspaceMembershipRefresh()`
  instead of calling the auth adapter directly.
- Sections are shown only when they can act: members/access/providers for owners
  and admins, lifecycle for owners. Do not add disabled placeholders for other roles.
- Destructive actions (remove member, revoke invitation, delete shared database,
  delete or restore a backup) go through `ConfirmButton`'s blocking confirmation
  dialog; scheduling workspace deletion requires the exact workspace name. Never use
  `window.confirm`.
- Show a server sentence only when it is in the current UI language; otherwise use
  the catalog fallback (`workspaceAdminErrorMessage`).
- `providers/domain.ts` is the Desktop copy of the provider presentation rules; keep
  it in step with the server's provider contracts.

### Testing Requirements

- Guarded through `src/features/providers/tauriAdapter.test.ts`,
  `src/features/workspaces/authPolicy.test.ts` and
  `src/features/workbench/state.test.ts`; extend those instead of adding a file
  (208-test budget).

## Dependencies

### Internal

- `../workspaces` for auth state, workspace context, cache transitions and the membership refresh channel.
- `../connections` for connection query keys and resource resets after access changes.
- `../../design-system` primitives and `../../lib/i18n` catalogs `workspaceAdmin`, `workspaceAccount`, `workspaceMembers`, `workspaceAccess`, `workspaceProviders`, `workspaceProviderDatabases`, `workspaceNeonBranches`, `workspaceLifecycle`.

### External

- `@tanstack/react-query`, `react`.
