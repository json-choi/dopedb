<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/analysisArticles

## Purpose

Analysis Articles: a shared HTML document with exactly one read-only saved
query, per `docs/adr/0007-analysis-article-bi-domain.md`. This feature covers
authoring/editing, the manual-rerun and result-recovery workflow, sanitized
public-snapshot publication, member-to-member sharing invitations, and the
Desktop deep-link ("Article link") handoff. It must never expose an executable
block, schedule, or live query to a public/shared audience — only the
sanitized HTML body and one exact query definition are shared; result rows and
reruns stay on the exact-grant Desktop.

## Key Files

| File | Description |
|------|-------------|
| `AnalysisArticleEditor.tsx` | Modal editor for one Article's title/HTML/target environment fields. |
| `AnalysisArticleReader.tsx` | Read surface composing the shared `AnalysisArticleBody` (from `design-system`) with a derived outline and the exact query tool; commands/results stay owned by the article controller per its header comment. |
| `AnalysisPublicationPanel.tsx` | Lists/publishes/revokes public snapshot publications (`listAnalysisPublications`, `publishAnalysisSnapshot`, `revokeAnalysisPublication`) and opens the published URL. |
| `AnalysisShareButton.tsx` | Per-Article member sharing: create/revoke an `ArticleInvitation` scoped to `{ accountId, workspaceId, articleId }`. |
| `ArticleLinkGate.tsx` | Handles an incoming Desktop "Article link" deep-link request: runs the workspace/account authority transition and login flow before opening the linked Article. |
| `domain.ts` | `AnalysisArticleSource` (`human` \| `dopedb.acp.claude` \| `dopedb.acp.codex`), column/value/query types, `AnalysisArticleRecord`, `AnalysisRun`, `AnalysisPublication`, and related wire contracts. |
| `productAnalytics.ts` | `beginManualAnalysisRunOutcome` — per its header comment, deliberately has no path for article text, SQL, parameters, result rows, or error bodies to reach the analytics contract; only closed state and run receipts. |
| `queryKeys.ts` | `analysisQueryKeys` — every key is rooted in the authenticated workspace scope key, because (per its header comment) hosted accounts may legitimately share the same client-generated Article id across scopes. |
| `tauriAdapter.ts` | `listAnalysisArticles`, `updateAnalysisArticle`, `deleteAnalysisArticle`, `listAnalysisArticleRevisions`/`Runs`, `getLocalAnalysisArticleResult`, `runAnalysisArticle`, `cancelAnalysisArticleRun`, `onAnalysisArticleChanged`, publication (`listAnalysisPublications`, `publishAnalysisSnapshot`, `revokeAnalysisPublication`, `analysisPublicationUrl`), and sharing/link types (`ArticleSharingScope`, `ArticleInvitation`, `DesktopArticleLink`). |
| `useAnalysisArticlesController.ts` | Owns the "intentionally small" (per header comment) Article workflow: select, edit one HTML document, manually rerun its one saved query, recover the local result, and inspect immutable history. |
| `useArticleOutline.ts` | Derives a heading outline by observing the already-rendered, server-sanitized document DOM; per its header comment it only navigates headings in this exact reader and never executes content. |

## For AI Agents

### Working In This Directory

- Never add an executable-block, schedule, signal, or live-query path to the
  public publication surface (`AnalysisPublicationPanel.tsx`,
  `publishAnalysisSnapshot`) — public articles are immutable HTML snapshots per
  ADR 0007; only Desktop, through `AnalysisArticleReader.tsx`'s manual rerun,
  may execute the saved query.
- Keep `productAnalytics.ts` limited to closed lifecycle outcomes; do not add
  article text, SQL, parameters, or row data to any event captured there.
- `queryKeys.ts` keys must stay scoped by the workspace scope key, not the bare
  Article id, to avoid cross-account cache collisions.

### Testing Requirements

- No test file in this directory; not part of `pnpm test` or the 208-test budget.

### Common Patterns

- `AnalysisArticleReader.tsx` imports the shared `AnalysisArticleBody` from
  `src/design-system/components/AnalysisArticleBody` and wraps it in `memo()`
  so the module the reader shares with Workspace Web stays import-free of
  Desktop-only dependencies (its own header comment).

## Dependencies

### Internal

- `src/features/knowledge/domain.ts` (`EnvironmentConnection`, `KnowledgeEnvironment`).
- `src/features/workspaces/{cache,domain,loginRequest,queries,tauriAdapter}.ts` (auth/account/workspace transition for `ArticleLinkGate.tsx`).
- `src/features/productAnalytics/{client,outcomes}.ts`.
- `src/design-system/components/AnalysisArticleBody` (shared with Workspace Web).
- Rust counterpart: `src-tauri/src/features/analysis_articles/transport.rs` (verified present).

### External

- `@tanstack/react-query`, `@tauri-apps/plugin-opener` (`openUrl`), `@tauri-apps/api/event` (`listen`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
