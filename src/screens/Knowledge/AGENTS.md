<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/screens/Knowledge

## Purpose
Renders one Knowledge Project environment's focused view: connected sources
(GitHub/local folder), environment connections, and Analysis Articles. Per
ADR 0007, an Analysis Article shares only sanitized HTML and one exact
read-only saved query; result rows and rerun stay on the exact-grant Desktop
(see `docs/adr/0007-analysis-article-bi-domain.md`).

## Key Files
| File | Description |
|------|-------------|
| `index.tsx` | Default-exported `Knowledge` screen: environment focus routing (sources vs. analyses), workspace auth/login/selection requests, product-analytics event emission. |
| `AnalysisArticles.tsx` | Composes Article commands, editorial reading (`AnalysisArticleEditor`/`AnalysisArticleReader`), and immutable execution history via `useAnalysisArticlesController`. |

## For AI Agents

### Working In This Directory
- Mounted by `WorkbenchContent.tsx` when `route.knowledgeEnvironmentFocus` is
  set, wrapped in a `RenderRecoveryBoundary` (see `KnowledgeRecovery` fallback
  in that file) keyed on `focus.requestId`.
- Composes `features/knowledge/*` (domain, tauriAdapter, inventory,
  queryKeys, `bindEnvironmentConnection`), `features/analysisArticles/*`, and
  `features/workspaces/*` (auth state, login/selection requests) —
  do not duplicate workspace-auth or environment-binding logic here.
- Analysis Article publication must stay within ADR 0007's boundary: no
  arbitrary executable blocks, schedules, signals, or hosted DB proxying.
- Manual UI check: run `pnpm dev:app`, open a Knowledge Project's sources and
  analysis views.

### Testing Requirements
- No dedicated automated test for this screen; covered indirectly by
  `pnpm test` and `pnpm build`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
