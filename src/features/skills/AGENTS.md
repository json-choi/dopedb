<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/skills

## Purpose
Local CLI detection/installation and managed Skill (`SKILL.md` bundle) inventory
for the official `claude`/`codex` CLIs used by the Desktop ACP integration.
`tauriAdapter.ts`'s header states provider credentials never enter these calls;
installed files are verified by the Rust boundary (`src-tauri/src/skills/`), not by
the WebView.

## Key Files
| File | Description |
|------|-------------|
| `SkillStartupGate.tsx` | Modal gate shown at startup for outstanding Skill install/update actions across supported Agent providers. |
| `agentPreferences.ts` | Local-storage-backed list of supported Agent CLI targets (`claude-code`, etc.) and a change-event bus for the account menu / setup dialog. |
| `presentation.ts` | Maps `SkillInstallState` to an i18n label key (`missing`, `managed_current`, `managed_older`, `user_modified`, `newer_known`, `unknown_conflict`, `invalid`). |
| `setupPolicy.test.ts` | Tests `buildSkillSetupPlan` across every `SkillInstallState`/`SkillTarget` combination. |
| `setupPolicy.ts` | Pure policy: derives a `SkillSetupAction` (`install`/`update`/`install-and-update`/`none`/`attention`) per target from its install state. |
| `tauriAdapter.ts` | CLI/Skill command owner: `cli_installation_status`, `install_cli`, `skill_status`, `install_skill`, `repair_skill`, `remove_skill`, `skill_self_test`. |
| `useSkillStartupObserver.ts` | Keeps one bounded Skill inventory query alive after the first visible frame (post-paint), via `usePostPaintReady`. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- **Security invariant (verified in code):** `tauriAdapter.ts` never accepts or
  returns a provider credential; installation/repair verification is the Rust
  boundary's job (`src-tauri/src/skills/`), not this adapter's.
- `setupPolicy.ts` is pure and total over `SkillInstallState` × `SkillTarget` —
  when adding a new `SkillInstallState`, update `setupPolicy.ts` and
  `presentation.ts` together and extend `setupPolicy.test.ts`'s state coverage.
- `install_skill`/`repair_skill`/`remove_skill` all take an `expected: SkillTargetExpectation[]`
  guard from the Rust side; do not add a call path that skips passing the expected
  state, since that guard is what prevents clobbering a user-modified install.

### Testing Requirements
- `setupPolicy.test.ts` is part of the `pnpm test` smoke suite
  (`vitest run src/features/skills/setupPolicy.test.ts`) and counts against the
  208-test budget; extend it rather than adding a new top-level test file.

### Common Patterns
- Long-running native operations (`skill_status`, `install_skill`, `repair_skill`)
  are always `spawn_blocking`-wrapped on the Rust side; expect them to resolve
  asynchronously and design UI states (`SkillStartupGate.tsx`) around that.

## Dependencies

### Internal
- `../agents` — `AgentProvider` type (shared vocabulary with Agent Tools settings).
- `../../ipc/types`, `../../ipc/generated/protocol-contracts` — `SkillInstallState`, `SkillTarget`, `SkillTargetSelection`.

### External
- Rust: no dedicated `features/skills/` transport module. Commands are
  `#[tauri::command]`s in `src-tauri/src/commands/mod.rs` calling `state.skills`
  (`SkillManager`), implemented in `src-tauri/src/skills/` (`bundle.rs`,
  `installer.rs`, `inventory/`). CLI install status uses `src-tauri/src/cli_install.rs`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
