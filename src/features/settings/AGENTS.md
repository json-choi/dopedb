<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/settings

## Purpose
Settings screen navigation state plus the Agent Tools settings sub-feature
(`agentTools/`). `domain.ts` keeps section identity as application state outside
`screens/` so feature state does not depend on a presentation entry point. The
`cli` section here is the "Command line" entry referenced in the root `CLAUDE.md` —
the advanced Shell PTY is surfaced only when a user explicitly opens it from this
settings screen, never from a general work surface.

## Key Files
| File | Description |
|------|-------------|
| `domain.ts` | `SettingsSection` union (`agent-tools`, `advanced`, `cli`, `privacy`, `safety`, `updates`, `language`, `appearance`) — settings navigation is shared application state, not screen-local state. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `agentTools/` | Renders and coordinates the bounded Agent (ACP) plugin and managed Skill setup workflows. Covered inline below (no separate `AGENTS.md`). |

### `agentTools/` (covered inline)

| File | Description |
|------|-------------|
| `AgentPluginSection.tsx` | Renders one Agent setup row per provider with aggregate chat readiness and expandable technical details. |
| `AgentSkillSection.tsx` | Renders optional external-use Skill inventory and guarded actions inside its provider row. |
| `model.ts` | Shared presentation vocabulary for the bounded Agent tool setup workflow; the settings screen consumes these values without owning provider or Skill state itself. |
| `useAgentToolsController.ts` | Coordinates the four bounded setup workflows rendered by Agent Tools settings, keeping effects and native commands out of the screen so it stays a composition root. |

## For AI Agents

### Working In This Directory
- `agentTools/` renders state and calls commands owned by `../agents` (ACP plugin:
  `checkAgentAcpPluginUpdates`, `installAgentAcpPlugin`, `removeAgentAcpPlugin`,
  `setAgentAcpPluginEnabled`) and `../skills` (Skill install/repair/remove) — it
  must not declare its own `invoke` command literals for either.
- `useAgentToolsController.ts` is the intended composition root for effects; keep
  `AgentPluginSection.tsx`/`AgentSkillSection.tsx` as largely presentational
  consumers of it.
- This directory has no `tauriAdapter.ts`; do not add direct `invoke` calls here.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- `model.ts` centralizes icon/label/tone mapping so both plugin and skill sections
  render conflicts/states consistently.

## Dependencies

### Internal
- `../agents` — ACP plugin domain types and commands (`agentCliDetectionQuery`, `agentPluginStatusQuery`, `checkAgentAcpPluginUpdates`, etc.).
- `../../ipc/types` — `SkillConflictKind`, `SkillStatusReason`, `SkillTargetSelection`.
- `../../design-system/components/{SettingsList,Agent,Button,FormControls,Progress,Status}`.

### External
- `@tanstack/react-query`.
- No dedicated Rust `settings` module; backing commands live under `../agents`
  (`src-tauri/src/features/agents/`) and `../skills` (`src-tauri/src/skills/`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
