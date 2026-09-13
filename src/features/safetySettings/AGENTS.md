<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/safetySettings

## Purpose
Coordinates two write gates for a connection: the workspace-level write ceiling and
the narrower device-local Safety gate. `persistence.ts`'s header states the
ordering is fail-closed, and all concrete IPC is supplied by the caller (screen)
rather than owned here — this module is policy/coordination logic, not a
self-contained IPC feature.

## Key Files
| File | Description |
|------|-------------|
| `persistence.ts` | Coordinates the workspace write ceiling and the device Safety gate with fail-closed ordering; takes IPC functions as injected `SafetyPersistenceCommands`. |
| `policy.ts` | `ConnectionWriteAuthority` projection and `WriteBlockRecoveryKind` union describing why/how a blocked write can be recovered (device safety, local safety, managed credential, schema safety/unavailable, workspace grant). |
| `queries.ts` | TanStack Query option loading safety settings with a 5s timeout (`loadSafetyBounded`). |
| `tauriAdapter.ts` | `getSafetySettings`/`setSafetySettings` — the only two commands this feature owns (`get_safety`, `set_safety`). |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- **Security invariant (verified in code):** `persistence.ts` is explicitly
  fail-closed — do not reorder its workspace-ceiling-then-device-gate checks such
  that a failure to read one gate is treated as permissive.
- `persistence.ts` takes commands as an injected `SafetyPersistenceCommands` object
  rather than calling `tauriAdapter.ts` directly; keep that inversion so the policy
  logic stays testable without Tauri.
- `set_safety`'s Rust handler additionally stops the connection's terminal and ACP
  Agent sessions on any successful update (see `src-tauri/src/commands/mod.rs`);
  do not assume a settings change is UI-only.

### Testing Requirements
- No test file exists in this directory. Its policy logic is covered indirectly by
  `../query/runSignal.test.ts`, which is part of the `pnpm test` smoke suite.

### Common Patterns
- N/A beyond the fail-closed coordination pattern in `persistence.ts`.

## Dependencies

### Internal
- `../connections` — `ConnectionProfile` (narrowed to `allowWrites`/`credentialMode`/`workspaceAccess`/`engine`/`provider`).
- `../../ipc/types` — `SafetySettings`.

### External
- Rust: no dedicated `transport.rs`. `get_safety`/`set_safety` are
  `#[tauri::command]`s in `src-tauri/src/commands/mod.rs` calling
  `state.services.safety`, composed from `src-tauri/src/features/safety_settings/`
  (`mod.rs`, `application.rs`, `ports.rs`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
