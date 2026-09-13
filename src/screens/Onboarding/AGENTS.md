<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/Onboarding

## Purpose
The welcome document. Shown with no connections, an empty document strip, or
as an explicit "welcome" workbench document kind. Only exposes commands with a
real application owner (new connection, create demo database, guided demo
steps) — provider setup and Agent actions stay in their own tool windows, not
here.

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `Onboarding` screen: connection/demo entry commands plus an optional `guidedDemo` step list; renders `features/cosmicScene/CosmicBackdrop` as the visual backdrop. |

## For AI Agents

### Working In This Directory
- Mounted in three places in `WorkbenchContent.tsx`: as the fallback when
  `connection.items.length === 0` or `route.welcomeOpen`, and as the
  `activeDocument.kind === "welcome"` document, each with different prop
  combinations (`guidedDemo` only appears when a demo SQLite connection is
  selected).
- `guidedDemoAvailable` is gated by `catalogScope.workspaceKind ===
  "personal"` in `AppShell.tsx` — do not offer guided-demo commands outside
  that scope.
- Manual UI check: run `pnpm dev:app` with zero connections configured to see
  the first-run state, then with a demo SQLite connection to see the guided
  steps.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` and `pnpm build`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
