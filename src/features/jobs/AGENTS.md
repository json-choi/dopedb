<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/jobs

## Purpose

The Durable Job Engine's frontend: connection-scoped bulk import/export. It
covers the whole workflow — file/table capability selection, an immutable plan
draft, exact-approval gating (via `operations`), and lifecycle mutations
(start/pause/cancel) — behind one controller, with `JobPanel`/`JobPlanForm` as
pure presentation.

## Key Files

| File | Description |
|------|-------------|
| `JobPanel.tsx` | Default-exported connection-scoped import/export panel shell; per its header comment, all workflow effects stay in the controller and this file only projects an accessible view. |
| `JobPlanForm.tsx` | Renders the immutable Job plan draft (batch size, format, error policy, field mapping); owns no file/approval/query effects. |
| `domain.ts` | Branded `ConnectionId`/`JobId`/`JobFileCapabilityId`/`JobArtifactId`/`OperationId`; `JobKind`, `JobFormat`, `JobState`, `JobErrorPolicy`, `JobRelationKind`, `JobPlan`, `CreateJobRequest`, and related wire/domain contracts for the Job Engine. |
| `jobPanelPresentation.ts` | Pure labels/formatters only — `JOB_FORMATS`, `formatJobBytes`, `jobProgress`, `jobStateTone`, `jobPreviewCell`; its header comment states it never owns React state or Tauri commands. |
| `tauriAdapter.ts` | `pickJobInput`/`pickJobOutput`, `inspectJobInput`, `createJob`, `listJobs`, `getJob`, `startJob`, `pauseJob`, `cancelJob`, `revealJobArtifact`. |
| `useJobPanelController.ts` | Owns the full connection-scoped Job panel workflow: plan draft, file capability, exact approval (via `operations/tauriAdapter.ts`'s `approveOperation`), lifecycle mutations, and query refresh via `jobsQuery`/`qk`. |

## For AI Agents

### Working In This Directory

- Keep the plan draft immutable once submitted for approval; `JobPlanForm`
  and `JobPanel` must stay effect-free per their own header comments — new
  workflow logic belongs in `useJobPanelController.ts`.
- Approval for a job's execution goes through `operations/tauriAdapter.ts`'s
  shared `approveOperation`, not a jobs-local approval command — this feature
  does not own the approval decision transport.

### Testing Requirements

- No test file in this directory; not part of `pnpm test` or the 208-test budget.

### Common Patterns

- Branded ids with constructors (`jobConnectionId`, `jobRelationRef`), matching
  `connections/domain.ts` and `erd/domain.ts`.
- `JOB_FORMATS` includes both plain and `_gzip` variants (`csv`, `csv_gzip`, …)
  as first-class `JobFormat` values rather than a separate compression flag.

## Dependencies

### Internal

- `src/features/operations/tauriAdapter.ts` (`approveOperation`).
- `src/lib/queries.ts` (`jobsQuery`, `qk`), `src/ipc/types` (`errMessage`, `CatalogRelationV2`).
- `src/design-system/components/{Progress,Status,Workbench,FormControls}`.
- Rust counterpart: `src-tauri/src/features/jobs/transport.rs` (verified present).

### External

- `@tanstack/react-query` (`useQuery`, `useQueryClient`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
