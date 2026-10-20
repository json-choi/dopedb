<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-08 | Updated: 2026-10-09 -->

# src/features/workspaceAdmin

## Purpose

Desktop surfaces for workspace administration: the account area in Settings →
Account (other sessions, workspaces scheduled for deletion), workspace creation,
and, in the separate Workspace management dialog (`src/screens/WorkspaceAdmin`),
the active team workspace's members, providers (accounts only) and owner-only
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
| `sections.ts` | `WorkspaceAdminSection` and the search keywords shared by the dialog and Action Search. |
| `navigationRequest.ts` | `requestWorkspaceAdmin(destination, focus?)` / `onWorkspaceAdminRequested`, and a one-time, 60-second focus the Providers section takes: the managed connection to offer a repair for. |
| `useWorkspaceAdminRequests.ts` | Lets the shell, which owns the Workspace management route, answer those requests. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `dateFormat.ts` | `formatAdminDate` / `adminLocale`: the one UI-language date and time formatter for every panel here and the Settings account section. |
| `workspaces/` | New-workspace dialog. |
| `members/` | Member directory, invitations, role changes and removal, plus the single canonical editor of per-member per-team-connection permission (none / read / write for managed, member-local and direct-connection databases, with provisioning status chips) fed by `listMemberGrants`, and the pending-revocation list. |
| `accessLowering/` | `useAccessLowering`, the one place that sends an access-lowering change: a provisioned (direct connection) database goes through `applyDirectRevocation` first (each target carries its own `targetLevel`; a lowering such as write→read uses `lowerConnectionAccess` and keeps the member's database account), anything else runs its plain operation. `AccessLoweringPrompt` and `DirectAdminCredentialForm` render an unfinished change (missing admin credential, failed steps) with enter-credential / leave-pending actions. |
| `access/` | Team-connection reads shared by Members and access lowering (`sharedDatabasesQuery`), and the preserved-edit conflict review the connection editor shows (`ConflictReview`, `useAccessCommands`). The team read switch no longer exists on Desktop; the server route remains for 0.7.0. Per-member grants are edited in Members. |
| `providers/` | Provider accounts (`accounts/`), Google Cloud SQL setup (`gcp/`), the Neon branch manager (`neonBranches/`), and the add flows the connection editor hosts as credential methods (`databases/`: provider-managed import with Neon bootstrap, and per-member DopeDB accounts). The Providers panel itself lists accounts and offers the managed-connection repair; there is no separate database list. |
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
- Sections are shown only when they can act: members/providers for owners
  and admins, lifecycle for owners. Do not add disabled placeholders for other roles.
- Any change that lowers a member's database access (grant lower/remove, role
  change that lowers the effective level, member removal, team-connection
  deletion) is sent through `useAccessLowering`, never by calling
  `runWorkspaceAdmin` directly; provisioned databases need their accounts revoked
  on the database before the workspace change commits.
- Destructive actions (remove member, revoke invitation, delete team connection,
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
