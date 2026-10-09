<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-10-09 -->

# src/screens/Settings

## Purpose
Settings shell for Agent tools, advanced, command-line, appearance, language,
privacy, updates, the signed-in account, and per-connection safety. Kept as an
overlay dialog outside the document strip so navigation stays focused on the
currently selected database. Sections split into two scopes: `application`
(device- or user-wide) sections and one `dataSource` section (`safety`).
Workspace administration is not here; it lives in the separate Workspace
management dialog (`src/screens/WorkspaceAdmin`).

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `Settings` modal on `design-system/components/SectionDialog`: section entries with the shared search keywords from `features/settings/domain`, section routing, refreshes safety on close via `refreshSafety`. |
| `Appearance.tsx` | Default-exported `Appearance` section: theme preference (`system`/`light`/`dark`) via `design-system/theme`'s `useTheme`/`setThemePreference`; device-local, applies immediately. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `Account/` | `index.tsx` — default-exported `AccountSettings`, shown only while signed in: other sessions of the account and owned workspaces scheduled for deletion (`features/workspaceAdmin/account`). |
| `Advanced/` | `index.tsx` — default-exported `AdvancedSettings`: debugging toggle (`useAgentDebugDetails`/`saveAgentDebugDetails` from `features/agents/displayPreferences`) inside a `SettingsGroup`; `Diagnostics.tsx` presents opt-in bounded local logs and explicit privacy warnings before copying or opening the GitHub issue form. |
| `AgentTools/` | `index.tsx` — default-exported `AgentTools`: composes provider-first Agent setup rows and install/self-test status via `useAgentToolsController` (all from `features/settings/agentTools/`). |
| `Cli/` | `index.tsx` — default-exported `CliSettings`: version-matched CLI sidecar install status/action via `cliInstallationStatusQuery` and `features/skills/tauriAdapter`'s `installCli`; `AdvancedShellTerminal.tsx` — `AdvancedShellTerminalLauncher`, the explicit developer-only Shell PTY pinned to the selected connection (separate surface from ACP Agent sessions; only reachable from here, never a general work screen). |
| `Privacy/` | `index.tsx` — default-exported `PrivacySettings`: product-analytics consent grant/deny via `features/productAnalytics/client` and a link to the privacy policy (`openProductAnalyticsPrivacyPolicy`). |
| `Safety/` | `index.tsx` — default-exported `Safety`: per-connection `SafetySettings` editor (`get_safety`/`set_safety` via `features/safetySettings/persistence`); `MonitoringAccess.tsx` — `MonitoringAccess` compact PostgreSQL monitoring-role panel that exposes backend-owned fixed `GRANT`/`REVOKE pg_monitor` approval and a DBA-copy fallback SQL string, without exposing arbitrary write toggles. |
| `Updates/` | `index.tsx` — default-exported `Updates`: app updater status/progress display and refresh/install actions against `features/updater/controller`'s `AppUpdaterSnapshot`. |

## For AI Agents

### Working In This Directory
- Mounted by `WorkbenchContent.tsx` as an always-available overlay
  (`settingsDialog`) whenever `route.settingsOpen` is true, layered above
  whichever document is active — it is not one of the `WorkbenchDocument`
  kinds.
- `safety` is the only `dataSource` entry; with no connection selected it
  renders `settings.selectConnection` instead of the editor. A new
  data-source-scoped section must handle the no-connection state the same way.
- Do not add workspace administration sections here: they belong to the
  Workspace management dialog, which the shell opens through
  `requestWorkspaceAdmin`.
- The Safety section must never let the UI itself perform a schema/role
  change — `MonitoringAccess.tsx` explicitly keeps the fixed `GRANT
  pg_monitor TO CURRENT_USER;` statement backend-approved rather than exposing
  a free-form write toggle, consistent with the repository's rule against
  changing pre-existing roles/grants outside a verified DopeDB-owned
  principal.
- The Advanced Shell Terminal (`Cli/AdvancedShellTerminal.tsx`) is a distinct,
  connection-pinned PTY surface, separate from ACP Agent sessions; keep it
  reachable only from Settings → Command line, not from a general work
  screen.
- Manual UI check: run `pnpm dev:app`, open Settings, and step through each
  section, including toggling the Safety section with and without a
  connection selected.

### Testing Requirements
- No dedicated automated test for these screens; covered indirectly by
  `pnpm test` and `pnpm build`.

## Dependencies

### Internal
- `features/settings/agentTools/`, `features/safetySettings/`,
  `features/productAnalytics/`, `features/updater/`, `features/skills/`,
  `features/terminals/PtySurface`, `features/agents/displayPreferences`,
  `design-system/theme`, `design-system/components/Settings`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
