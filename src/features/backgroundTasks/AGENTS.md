<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/backgroundTasks

## Purpose

Aggregates running work from two other features — Agent (ACP) sessions and
import/export Jobs — into one status-bar menu with a uniform status vocabulary
and cancel action. It owns no execution state of its own; it only projects and
cancels tasks owned by `agents` and `jobs`.

## Key Files

| File | Description |
|------|-------------|
| `BackgroundTasksMenu.tsx` | Default-exported toolbar menu; renders one row per `BackgroundTask` with an icon by kind (`agent` vs. job) and a localized status label/tone. |
| `domain.ts` | `BackgroundTaskStatus` union (`starting`…`cancelling`) and the `BackgroundTask` type, built from `agents`' `AcpSessionId` and `jobs`'/`connections`' `ConnectionId`. |
| `useBackgroundTasks.ts` | Combines `useQueries` over job state, `useAcpSessionSnapshot` for live Agent sessions, and `useQueryServiceActivities`, exposing one list plus `cancelJob`/`cancelAgentAcpSession` commands. |

## For AI Agents

### Working In This Directory

- This feature must not gain its own mutation logic for jobs or Agent
  sessions — cancellation always calls into `jobs/tauriAdapter.ts` and
  `agents/tauriAdapter.ts`/`agents/sessionStore.ts` so there is exactly one
  writer for each underlying task's state.

### Testing Requirements

- No test file here; not part of `pnpm test` or the 208-test budget.

### Common Patterns

- Reads Agent session liveness through `useAcpSessionSnapshot` (the one
  external store in `agents/sessionStore.ts`) rather than issuing its own
  `list_agent_acp_sessions` query.

## Dependencies

### Internal

- `src/features/agents/{domain,tauriAdapter,sessionStore}.ts`,
  `src/features/jobs/{domain,tauriAdapter}.ts`,
  `src/features/connections/domain.ts`,
  `src/features/queryServices/store.ts` (`useQueryServiceActivities`).
- `src/lib/queries.ts` (`jobsQuery`, `qk`), `src/lib/usePostPaintReady.ts`.
- No feature-owned Rust transport; it composes existing `agents`/`jobs` commands.

### External

- `@tanstack/react-query` (`useQueries`, `useQueryClient`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
