<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-10-09 | Updated: 2026-10-09 -->

# src/screens/WorkspaceAdmin

## Purpose
Workspace management dialog for the active team workspace. It is a separate shell
modal from the application Settings, so administration of the shared workspace
never mixes with per-device preferences. Owners and admins see Members, Database
access and Providers; owners also see Backups & deletion. The account area (other
sessions, workspaces scheduled for deletion) stays in Settings → Account because it
belongs to the signed-in user, not to one workspace.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `WorkspaceAdmin` dialog on `design-system/components/SectionDialog`: role-filtered section entries, the panels from `features/workspaceAdmin`, closing when the member loses management authority, and handing `account` navigation to Settings → Account. |

## For AI Agents

### Working In This Directory
- Mounted by `WorkbenchContent.tsx` while the shell mode is `workspaceAdmin`. The
  shell route owns the active section; the dialog only reports selections through
  `onSelectSection`, so a request that arrives while it is open moves it too.
- Entry points all go through `requestWorkspaceAdmin` from
  `features/workspaceAdmin/navigationRequest`: the workspace menu's `Manage
  workspace`, Action Search, managed-connection recovery, and the data source
  catalog's `Add shared database` shortcut (which also hands the Providers section a
  one-time add-database focus).
- Show only sections the role can run; never add disabled placeholders for other
  roles.
- Manual UI check: run `pnpm dev:app` signed in as a team owner or admin, open the
  workspace menu → Manage workspace, step through each section, and open
  `Add shared database` from the data source `+` menu.

### Testing Requirements
- No dedicated automated test for this screen; the navigation reducer and the
  request/focus hand-off are covered by `src/features/workbench/state.test.ts` and
  `src/features/workspaces/authPolicy.test.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
