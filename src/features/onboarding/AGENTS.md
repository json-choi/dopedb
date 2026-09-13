<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/onboarding

## Purpose
Guided-demo setup for first-run users. Composes existing connection and Project
Environment commands to create a demo SQLite connection and a sandbox knowledge
environment/project. Per its own header comment, it must never fabricate team
membership, credentials, or Agent authority — every capability it grants comes from
calling the same commands a real user flow would call.

## Key Files
| File | Description |
|------|-------------|
| `demoSetup.ts` | Composes connection + Project Environment creation into one guided-demo setup; defines `GUIDED_DEMO_PROJECT_NAME`/`GUIDED_DEMO_ENVIRONMENT_NAME`. |
| `useGuidedDemoCommands.ts` | Hook exposing the guided-demo command set (`browseOrders`, `analyzeRevenue`, `practiceApproval`, `openSafety`). |
| `useGuidedDemoSetup.ts` | Hook that creates/reuses the demo SQLite connection, verifies it, and records analytics for the guided demo. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- Do not add a code path that creates a demo connection, environment, or project
  without going through the same `connections`/`knowledge` commands used elsewhere
  — this directory is not allowed its own privileged shortcut.
- Demo identity must stay recognizable as a demo (`GUIDED_DEMO_PROJECT_NAME`,
  `demoSqliteConnection`/`findDemoSqliteConnection` from `../connections/presets`).

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- Hooks report outcomes through `../productAnalytics/client` using the closed
  `productAnalytics` outcome vocabulary rather than ad hoc event names.

## Dependencies

### Internal
- `../agents` — `listAgentKnowledgeEnvironments` (read-only).
- `../knowledge` — environment/project creation and binding.
- `../connections` — demo SQLite connection presets, `testConnection`, `upsertConnection`, `createDemoSqlite`.
- `../productAnalytics` — outcome capture for guided-demo events.

### External
- No dedicated Rust module or `transport.rs`; this feature has no `tauriAdapter.ts`
  of its own and issues no direct `invoke` calls.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
