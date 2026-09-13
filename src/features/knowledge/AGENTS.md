<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/knowledge

## Purpose

The Knowledge Project/Environment layer: creating Projects and Environments,
connecting/binding source repositories (GitHub or local) and databases into an
Environment, and tracking indexing/inventory state. This is the resource
grouping that Agent sessions and Analysis Articles select from — it does not
itself run Agents or execute queries.

## Key Files

| File | Description |
|------|-------------|
| `bindEnvironmentConnection.ts` | `isKnowledgeEnvironmentRevisionConflict` (detects a 409 "Environment or connection changed" conflict) and `bindKnowledgeEnvironmentConnectionWithRefresh`, which refreshes the native workspace projection and retries a bind after a shared Connection revision advances between an Explorer read and the bind action. |
| `domain.ts` | `KnowledgeEnvironment` (with `riskClass`: production/staging/development/test/custom), `KnowledgeEnvironmentView`, `KnowledgeProject`, `GithubKnowledgeRepository`, `KnowledgeRevision`, `KnowledgeSource`, `KnowledgeInventory`, `EnvironmentConnection`, and create/bind input types. |
| `inventory.ts` | `knowledgeInventoryQuery` — `queryOptions()` wrapper (60s stale time, no retry) around `listKnowledgeInventory`. |
| `presentation.ts` | Pure label formatters: `knowledgeRevisionLabel` (github/local_git/snapshot revision display), `githubSourceRevisionLabel`, `knowledgeEnvironmentBadge`. |
| `queryKeys.ts` | `knowledgeQueryKeys`; exports `KNOWLEDGE_WORKSPACE_QUERY_ROOTS`/`AGENT_KNOWLEDGE_CONNECTION_QUERY_ROOTS` prefixes explicitly for intentional cross-surface invalidation, per its header comment — Knowledge and its Agent-environment projection share one cache identity rooted in the authenticated workspace generation. |
| `tauriAdapter.ts` | `listKnowledgeProjects`, `listKnowledgeInventory`, `listKnowledgeEnvironmentConnections`, `bindKnowledgeEnvironmentConnection`, `revokeKnowledgeEnvironmentConnection`, `createKnowledgeProject`/`Environment`, `deleteKnowledgeProject`, GitHub install/connect (`beginKnowledgeGithubInstall`, `listKnowledgeGithubRepositories`, `connectKnowledgeGithubSource`), `connectKnowledgeLocalFolder`, `listKnowledgeSources`, `revokeKnowledgeSource`, `onKnowledgeSourceChanged`. |
| `useKnowledgeGithubInstall.ts` | Owns the external GitHub App installation browser window and the return-to-app repository refresh, per its header comment. |
| `useKnowledgeSourceActivity.ts` | Reconciles live Knowledge indexing events with inventory query snapshots and analytics. |
| `workspaceModel.ts` | `knowledgeRepositoryLabel`, source health status keys, and `captureKnowledgeSyncOutcome`/`finishKnowledgeSyncOutcome` product-analytics helpers. |

### `components/`

Presentation-only dialogs and section views for the Knowledge screen; state and
mutations are owned by the hooks above or passed in as props, not created here.

| File | Description |
|------|-------------|
| `EnvironmentSetupDialog.tsx` | Environment-creation dialog; per its header comment, this is a scoped Project mutation — the dialog explicitly selects the target Project and returns the updated revisioned Project inventory. |
| `KnowledgeDatabaseSection.tsx` | Database grant and exact-revision binding presentation for one Environment. |
| `KnowledgeSourceSections.tsx` | `KnowledgeConnectSourceSection` and `KnowledgeSourceInventory` — connect-a-source form and the connected-source inventory list for one Environment. |
| `KnowledgeWorkspaceHeader.tsx` | Shared heading and load-failure feedback for the selected Knowledge Environment view. |
| `ProjectSetupDialog.tsx` | Project-creation dialog. |

## For AI Agents

### Working In This Directory

- `bindEnvironmentConnection.ts`'s refresh-and-retry pattern exists because a
  shared Connection's revision can advance between an Explorer read and a
  bind/drop action; any new bind-type mutation touching a shared Connection
  should go through (or follow) this same conflict-detection pattern rather
  than treating a 409 as a plain error.
- `queryKeys.ts` exports its root prefixes deliberately for cross-surface
  invalidation (Knowledge screen + Agent environment picker share one cache
  identity) — do not fork a second, unscoped key space for Agent-side
  Knowledge reads.
- `components/` files must stay presentation-only; new Knowledge mutations
  belong in a hook in the parent directory, not inside a dialog component.

### Testing Requirements

- No test file in this directory; not part of `pnpm test` or the 208-test budget.

### Common Patterns

- Revision-typed sources (`KnowledgeRevision`: `github` \| `local_git` \|
  snapshot) each carry their own identity fields (`refName`+`commitSha`,
  `snapshotSha256`); `presentation.ts`'s `knowledgeRevisionLabel` is the one
  place that renders all three consistently — extend it rather than
  formatting a revision inline elsewhere.

## Dependencies

### Internal

- `src/features/workspaces/tauriAdapter.ts` (`refreshWorkspaceAuthState`).
- `src/features/productAnalytics/domain.ts`/`client.ts` (sync outcome analytics).
- `src/features/connections/domain.ts` (`ConnectionProfile`, consumed by `components/KnowledgeDatabaseSection.tsx`).
- `src/ipc/types` (`errDetails`).
- Rust counterpart: `src-tauri/src/features/knowledge/transport.rs` (verified present).

### External

- `@tanstack/react-query` (`queryOptions`, `useMutation`, `useQueryClient`).
- `@tauri-apps/plugin-opener` (`openUrl`, GitHub install window), `@tauri-apps/api/event` (`listen`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
