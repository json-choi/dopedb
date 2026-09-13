<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/updater

## Purpose
Desktop app-update lifecycle (checking/available/current/downloading/installing/ready/error)
built directly on the official Tauri updater plugin, not a custom backend. It has
no `tauriAdapter.ts` and no bespoke Rust commands.

## Key Files
| File | Description |
|------|-------------|
| `controller.ts` | `AppUpdaterPhase`/`AppUpdaterSnapshot` types and the updater's state machine/controller. |
| `useAppUpdater.ts` | Hook driving `AppUpdaterController` using `@tauri-apps/plugin-updater`'s `check()`, `@tauri-apps/plugin-process`'s `relaunch()`, and an hourly (`UPDATE_CHECK_INTERVAL_MS`) poll. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- Do not introduce a custom `invoke`-based update command; the official
  `@tauri-apps/plugin-updater` plugin is the intended integration point, matching
  the repo-wide preference for delegating to an OS/official mechanism instead of
  rebuilding it (see root `AGENTS.md`, "Connecting stays trivial").
- `UPDATE_CHECK_INTERVAL_MS` (1 hour) is the polling cadence; do not tighten it
  without a stated reason, since it drives a background network check.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- `useAppUpdater.ts` exposes `AppUpdaterController` via `useSyncExternalStore`,
  the same external-store pattern used elsewhere in `src/features` for
  cross-component shared state (e.g. `../queryServices/store.ts`).

## Dependencies

### Internal
- `../../ipc/types` — `errMessage`.

### External
- `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`, `@tauri-apps/api/app`.
- No dedicated Rust module; updates are handled by the Tauri updater plugin's own
  Rust side, configured in `src-tauri/tauri.conf.json`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
