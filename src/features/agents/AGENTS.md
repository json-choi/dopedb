<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/agents

## Purpose

The in-app Agent (ACP — Agent Client Protocol) chat: session lifecycle, the
chat composer/transcript UI, one exact Project-resource scope per session, SQL
proposal review/approval surfaces, and the external (`dopedb agent start`)
Agent request gate. Per repeated header comments across this feature, an
Agent session's resource grant is immutable once started, at most one selected
database may be a write target, and prompt/tool/result content must never
enter product analytics.

## Key Files

| File | Description |
|------|-------------|
| `AcpChatComposer.tsx` | Default-exported composer; per its header comment, renders one bounded state group and delegates every mutation to controller-owned command groups — owns no session/query/transport state itself. |
| `AcpChatPanel.tsx` | Default-exported AI Chat tool-window entry; owns render recovery and composes the controller/presentation groups from `useAcpChatController`. |
| `AcpChatTranscript.tsx` | Default-exported transcript view; per its header comment, renders controller-owned session/setup groups and presentation-only event models, with no query or transport lifecycle of its own. |
| `AcpConfigSelect.tsx` | Renders the official adapter's advertised config choices; per its header comment, never invents config ids or locally persists a permission mode across sessions. |
| `AcpScopeSelect.tsx` | The Project-resource scope menu: independent database/source checkboxes plus one separate, optional single write target. |
| `AcpSqlApproval.tsx` | Default-exported SQL approval card; calls `operations/tauriAdapter.ts`'s `approveOperation`/`rejectOperation` for a `SqlApprovalReview`. |
| `AcpStructuredResult.tsx` | Default-exported tabular-result renderer for ACP tool output, reusing `queryResults/DataGrid`, capped at 18 columns / 100 rows. |
| `AgentCliStatus.tsx` | `AgentCliStatusIndicators`/`AgentCliDetectionNotice`; projects the local provider CLI detection query into one shared loading/failure/missing/authentication/ready vocabulary. |
| `ExternalAgentConfigurationPicker.tsx` | Editable Project-resource selection UI for configuring an external (`dopedb agent start`) Agent. |
| `ExternalAgentRequestDialogs.tsx` | `ExternalAgentUnavailableDialog`/`ExternalAgentRequestDialog` — composes inventory/review/response into modal dialogs for an external Agent start request. |
| `ExternalAgentRequestGate.tsx` | Owns the external Agent request registry and routes each active request to a bounded review dialog. |
| `ExternalAgentRequestReview.tsx` | `ExternalAgentStartReview`, `StartApprovalButton`, `ExternalAgentRequestIdentity` — presents the immutable external-Agent start scope and its reconfirmation action. |
| `acpActivityLabels.ts` | `toolActivityLabel`; per its header comment, derives operation labels from ACP tool identities because free-form model reasoning text does not by itself establish that a database or Article operation actually ran. |
| `acpPromptContext.ts` | `buildAcpPromptContext`/`summarizeAcpPromptContext`; a bounded projection of the active workbench context (open table/document) attachable to a prompt, capped at `MAX_DOCUMENT_CONTEXT_CHARS` (16 KiB). |
| `acpTranscriptPresentation.ts` | Pure transcript-to-label projections (`findAnalysisArticle`, `toolContentText`, `planEntryLabel`, `lifecycleTone`, `providerLabel`, `loginCommand`); per its header comment, owns no React state, transport calls, or tool-window layout. |
| `displayPreferences.ts` | `useAgentDebugDetails` — persisted (`localStorage`) toggle for showing raw ACP debug details, broadcast via a custom DOM event. |
| `domain.ts` | Branded `AcpSessionId`; `AgentProvider` (`claude`\|`codex`), `AcpPluginId`, `AcpPluginInstallationState`, `AgentCliInfo`, `AgentComposerRequest`, `AcpSessionLifecycle`, `AgentKnowledgeEnvironment`/`Source`/`ConnectionScope`. |
| `externalAgentDomain.ts` | `ExternalAgentProvider`, `ExternalAgentConfig` (checked-in, secret-free Project resource config), `ExternalAgentRequestSummary`. |
| `externalAgentRequestModel.ts` | Pure selection/projection for external Agent approval: `selectedExternalAgentResources`, `requestedExternalAgentResources`, `externalAgentResourceBoundaries`. |
| `externalAgentTauriAdapter.ts` | `listExternalAgentRequests`, `respondExternalAgentRequest`, `onExternalAgentRequested`, `onExternalAgentRequestFinished`. |
| `layout.ts` | Responsive geometry policy for the Agent dock: `AGENT_DOCK_{DEFAULT,MIN,MAX}_WIDTH`, `agentDockLayout` (`compact`\|`docked`\|`overlay`), `clampAgentDockWidth`, `shouldOverlayAgentDock`. |
| `productAnalytics.ts` | `beginAgentInitializationOutcome`, `observeAgentTurnOutcome`; per its header comment, observes only closed lifecycle outcomes — prompt text, ACP error messages, event payloads, connection details, and session ids never enter the analytics contract. |
| `queryKeys.ts` | `agentQueryKeys` (`pluginStatus`, `cliStatus`). |
| `queryOptions.ts` | `agentPluginStatusQuery`, `agentCliDetectionQuery` — read-only `queryOptions()` for local Agent CLI/adapter status. |
| `selectionContext.tsx` | `AgentSelectionProvider`/`useAgentSelection` — React context carrying the active table/connection selection into the composer's context attachment. |
| `sessionFocus.ts` | `ownsAcpComposerRequest`, `isLiveSession`, `selectWorkspaceSessions`, `isCurrentAcpFocusRequest`; per its header comment, keeps session focus/handoff inside the exact requested resource set — another database in the same Environment is not an interchangeable scope. |
| `sessionPresentation.ts` | `sessionMetaLabel` — combines a session's Project name and provider into one label. |
| `sessionStore.test.ts` | Tests `mergeAcpSessionSummaries`/session change handling and `buildAcpArticleContext`; **in the `pnpm test` smoke suite** (see root `package.json`). |
| `sessionStore.ts` | Per its header comment, the ACP process inventory and backend event subscription are application state, not panel state: one external `AcpSessionStore` (via `useSyncExternalStore`) closes the list/listen race and is read by every Agent surface through `useAcpSessionSnapshot`. This is the single writer for live session state. |
| `sqlProposal.ts` | `AgentSqlProposalReference`, `isSqlProposalTool`, `findAgentSqlProposal` — validates operation id (UUID v1-8) / payload hash (SHA-256 hex) / `OperationState` shape from tool call data. |
| `tauriAdapter.ts` | ACP session/plugin commands: `listAgentAcpPlugins`, `installAgentAcpPlugin`/`removeAgentAcpPlugin`/`setAgentAcpPluginEnabled`, `startAgentAcpSession`, `listAgentKnowledgeEnvironments`, `resumeAgentAcpSession`, `listAgentAcpSessions`, `focusAgentAcpSession`, `promptAgentAcpSession`, `cancelAgentAcpSession`. |
| `transcript.ts` | `AcpTranscriptItem`/`AcpConversationProjection`; bounds transcript memory with `MAX_RECENT_EVENTS`/`MAX_TRANSCRIPT_ITEMS`/byte caps and compaction (`COMPACTED_TEXT_BYTES`). |
| `useAcpChatController.ts` | The composer/transcript's main controller; per its header comment, owns session selection, lifecycle, permissions, composer state, and viewport effects, returning state grouped by view responsibility. |
| `useAcpChatViewport.ts` | Owns the dock's DOM-only behavior: sticky transcript scrolling and resize, via `createFrameCoalescer`. |
| `useAcpComposerContext.ts` | `buildAcpArticleContext`/`useAcpComposerContext`; per its header comment, projects an open Analysis Article into a small pointer owned by the session's exact resource grant — Article HTML/SQL/result rows stay behind its tools, not in the prompt context. |
| `useAcpScopeCommands.ts` | Per its header comment, resource changes update the draft immediately and retire the old prepared session in the background; a conversation's exact grant remains immutable once started. |
| `useAcpSessionStartup.ts` | Per its header comment, prepares an exact-scope session while the user composes, without blocking resource selection, and closes obsolete grants before adopting a new one. |
| `useAgentEnvironmentInventory.ts` | Per its header comment, projects the workspace's exact Project resources without exposing the internal Environment hierarchy as a choice the user must make; `AgentDatabaseResourceChoice`/`AgentSourceResourceChoice`/`AgentProjectResourceChoice`. |
| `useAgentReadinessWarmup.ts` | Per its header comment, preloads read-only Agent prerequisites (Knowledge inventory, CLI/plugin status) without creating an ACP process or choosing a resource grant on the user's behalf. |
| `useAgentScopeSelection.ts` | Per its header comment, one Agent session owns an immutable, user-selected resource set from one Project: read resources are independent, at most one selected database is a write target, and every deeper Safety/workspace/database gate still applies. |

## For AI Agents

### Working In This Directory

- A started session's resource grant is immutable — `useAcpScopeCommands.ts`
  and `useAgentScopeSelection.ts` both encode this; a scope change always
  retires the old session and prepares a new one rather than mutating an
  in-flight grant.
- At most one selected database may be a write target per session
  (`useAgentScopeSelection.ts`) — do not add a path that allows more than one.
- Never add prompt text, tool payloads, connection details, or session
  identifiers to `productAnalytics.ts`'s event contract; it is scoped to
  closed lifecycle outcomes only, by design.
- `sessionStore.ts`'s `AcpSessionStore` is the one writer for live ACP session
  state — read it via `useAcpSessionSnapshot`, do not create a second
  `listAgentAcpSessions`/`onAgentAcpChanged` subscription elsewhere.
- External Agent (`dopedb agent start`) requests must keep going through
  `ExternalAgentRequestGate.tsx`'s review flow; per root `CLAUDE.md`/`AGENTS.md`,
  Desktop review of the checked-in, secret-free Project resource config is
  required before that CLI path may run.

### Testing Requirements

- `sessionStore.test.ts` is part of the `pnpm test` smoke suite (see the
  `test`/`test:smoke` scripts in `package.json`) and counts against the
  208-test budget (`tests/critical-test-budget.json`). Run `pnpm test` after
  changing `sessionStore.ts`, `useAcpComposerContext.ts`, or the types they
  share (`AcpSessionChanged`, `AcpSessionSummary`, `AgentKnowledgeScope`).
- No other file in this directory has a dedicated test.

### Common Patterns

- Header comments across this feature explicitly state ownership boundaries
  ("owns no session/query/transport state", "does not expose X") — when
  editing a file, preserve the boundary its header comment already documents
  rather than moving state into a presentation component.
- `ReturnType<typeof use...>` controller types (`AcpChatController`) match the
  same composition pattern used in `connections/`.

## Dependencies

### Internal

- `src/features/connections/domain.ts` (`ConnectionEngine`, `ConnectionId`, `ConnectionProfile`).
- `src/features/knowledge/{domain,presentation}.ts` (`githubSourceRevisionLabel`, `knowledgeEnvironmentBadge`).
- `src/features/operations/tauriAdapter.ts` (`approveOperation`, `rejectOperation`).
- `src/features/analysisArticles/{domain,queryKeys,tauriAdapter}.ts` (Article context/reference lookup).
- `src/features/workbench/{domain,draftStore}.ts` (prompt context attachment).
- `src/features/queryResults/DataGrid` (`AcpStructuredResult.tsx`).
- `src/ipc/generated/protocol-contracts` (`OperationState`).
- Rust counterpart: `src-tauri/src/features/agents/transport.rs` (verified present).

### External

- `@tanstack/react-query`, `@tauri-apps/api/event` (`listen`), `@tauri-apps/plugin-opener` (`openUrl`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
