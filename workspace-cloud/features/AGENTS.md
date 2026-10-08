<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-10-08 -->

# workspace-cloud/features

## Purpose
Feature modules for the workspace-cloud control-plane app that span a page and its
data layer, grouped by product capability rather than by file type. The only module
is `articleSharing/`, which renders and administers Analysis Article
handoff/invitation flows (server components, one client accept button, and a
server-only SQL data layer). Workspace administration screens (members, DB access,
providers, backups and deletion, account sessions) are not built here: they are
DopeDB Desktop Settings surfaces (`../../src/features/workspaceAdmin/`, see
`../../docs/adr/0009-desktop-workspace-administration.md`) that call this app's
`app/api/v1/...` routes. Nothing in this tree calls a cloud provider's API.

## Key Files

### articleSharing/
| File | Role | Description |
|------|------|-------------|
| `HandoffPage.tsx` | Server component | Authenticates the visitor, resolves either a direct Article scope or a pending invitation via `acceptance.ts`/`store.ts`, and renders the sign-in/handoff/desktop-open screen (`dopedb://article/...` deep link plus web download link). |
| `InvitationAcceptButton.tsx` | Client component | `"use client"` button that POSTs `/api/v1/article-invitations/{id}` to accept an invitation, then navigates to the resolved Article path; shows pending/failed states. |
| `acceptance.ts` | Server-only data module | `inspectArticleInvitation` (read-only preview) and `acceptArticleInvitation` (one transactional SQL statement that adds the recipient as an Analyst member and grants `read` on the Article's connection) against `workspace_control.workspace_article_invitation`. |
| `copy.ts` | i18n copy | `articleSharingCopy` en/ko string table consumed by the components above and by `app/analyses/[slug]/*`, `app/not-found.tsx`, and `app/error.tsx` (not the shared `workspace-messages` catalog). |
| `store.ts` | Server-only data module | `loadArticleSharing`, `createArticleInvitation` (48h expiry, 50-invite cap), `revokeArticleInvitation`, and the shared `liveArticleSql` query that resolves an Article to its current workspace/connection/environment binding; also owns `articlePath`/`invitationUrl` path helpers and `parseInvitationEmail`. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `articleSharing/` | Analysis Article invitation handoff: server-rendered accept/open page, one client accept button, and the server-only SQL data layer for invitations and sharing metadata. |

## For AI Agents

### Working In This Directory
- The tree's only network call is `InvitationAcceptButton.tsx`'s same-origin POST to `app/api/v1/article-invitations/{id}`; server-side reads and writes go through `../../lib/db` directly. No file here calls a provider API.
- `articleSharing/store.ts` and `acceptance.ts` are `"server-only"` and run one durable SQL statement per mutation (advisory-lock + CTE) rather than multiple round trips — read the full statement before changing invitation semantics; it never recreates removed membership or grants on a re-accept.
- Do not rebuild browser workspace administration here. Members, connection grants, provider setup/import/repair, Neon branches, backups, lifecycle, and account sessions belong to Desktop Settings (ADR 0009); this app serves only their `/api/v1/...` contract and the browser-only provider authorization pages under `app/auth/provider/`.

### Testing Requirements
- No colocated `*.test.ts`/`*.spec.ts`/`*.harness.ts` files exist under `features/` (verified by search). `pnpm workspace:cloud:build` is the only check that type-checks this directory (Next.js build). This app's dedicated Vitest suites (`pnpm --dir workspace-cloud test:contracts`, `test:d1-import`) only include harness files under `lib/`, not anything in `features/`.
- Manually exercise changed screens per the root `CLAUDE.md`/`AGENTS.md` UI-change rule; there is no automated coverage substitute here.

### Common Patterns
- `HandoffPage.tsx` resolves the session and locale itself and redirects a signed-out visitor to the localized sign-in page with a `returnTo` for the same handoff path, rather than rendering a partial page.
- `articleSharing/` keeps its own small `copy.ts` table instead of the shared `../../lib/workspace-messages` catalog.

## Dependencies

### Internal
- `../../lib/db`, `../../lib/env` — server-only DB client and origin URL (used by `articleSharing/store.ts`, `acceptance.ts`, and `HandoffPage.tsx`).
- `../../lib/authoritative-session` — session resolution in `articleSharing/HandoffPage.tsx`.
- `../../lib/workspace-locale`, `../../lib/workspace-locale-server` — locale path helpers.
- `../../app/components/*` (`Brand`, `LocaleSwitcher`, `WorkspaceLocale`) and `../../../src/design-system/components/WorkspaceIdentity` (`Identity*` shell/card/button primitives) — shared UI rendered by the components in this tree.
- Callers: `app/article-invitations/[invitationId]/page.tsx` and `app/open-article/[workspaceId]/[articleId]/page.tsx` (`HandoffPage`), `app/api/v1/article-invitations/[invitationId]/route.ts` (`acceptance.ts`), and `.../analyses/[articleId]/sharing/route.ts` (`store.ts`).

### External
- `react` (`useState`) — `InvitationAcceptButton.tsx`.
- `next/headers`, `next/navigation` — `articleSharing/HandoffPage.tsx` (server component).
- `drizzle-orm` (`sql` template tag) — `articleSharing/store.ts` and `acceptance.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
