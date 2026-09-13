<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# site/app

## Purpose
Next.js App Router tree for the marketing site: the landing page and its
sections, legal pages, and two small Worker API routes. Server components
compose the page by default; `"use client"` is scoped to components that need
interactivity, browser APIs, or WebGL.

## Key Files
| File | Description |
|------|-------------|
| `layout.tsx` | Root layout: loads the Pretendard/IBM Plex Mono fonts, reads the `x-site-lang` header, and mounts `SitePageEffects`. |
| `page.tsx` | The landing route: resolves language, builds `Metadata` and structured data, and composes `HomeSections`. |
| `homeContent.ts` | Bilingual (`en`/`ko`) landing copy and stable URLs (`repoUrl`, `releasesUrl`, `workspaceSiteUrl`, `downloadUrls`) — the landing page's content contract. |
| `HomeSections.tsx` | Server-side composition of every searchable landing section (`GalaxyHero`, `HomeDemoShowcase`, `HomeScopeWalkthrough`, plus marketing copy blocks). |
| `HomeChrome.tsx` | Header/footer navigation; ordinary server-rendered anchors, no client interactivity. |
| `GalaxyHero.tsx` | `"use client"`. Lazily mounts the Three.js galaxy background (`../lib/galaxyRenderer`); page content never blocks on WebGL. |
| `HomeDemoShowcase.tsx` | `"use client"`. Product screenshot showcase; the link works as a plain image link without JavaScript. |
| `HomeScopeWalkthrough.tsx` | `"use client"`. A deterministic, browser-only walkthrough story — no backend, credentials, SQL execution, or persistence. |
| `MarketingButton.tsx` | Shared marketing CTA/button/arrow primitives built on `TrackedLink`. |
| `PlatformDownloads.tsx` | `"use client"`. Progressive platform-download links; an unrecognized Mac CPU architecture is never guessed and instead routes to an explicit build chooser. |
| `SitePageEffects.tsx` | `"use client"`. Fires a site analytics pageview via `trackSiteEvent` on route/path change. |
| `TrackedLink.tsx` | `"use client"`. Only the reviewed closed set of CTA names/property pairs may attach an analytics event to a link; other links stay plain anchors. |
| `DopeDBMark.tsx` | `"use client"`. Wraps the shared `DopeDBMarkGraphic` from `src/design-system/` for site use. |
| `robots.ts` / `sitemap.ts` | Generated `robots.txt` / sitemap, including an explicit allow-list of AI search/retrieval crawlers. |
| `globals.css` | Global site styles (Tailwind v4 entry point for this project). |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `api/deployment/` | `route.ts` — unauthenticated `GET` returning `{ service, versionId }` from `CF_VERSION_METADATA`, used by `scripts/check-site-deployment.mjs` to verify a deployed Worker version. |
| `api/site-events/` | `route.ts` — `POST` endpoint that accepts only same-origin requests (`origin`/`sec-fetch-site` checked), rate-limits by the edge client address without storing it, and forwards a validated analytics point to `readSiteAnalytics`. |
| `components/` | `LegalDocument.tsx` — shared accessible layout (navigation, reading width) for policy pages; page-specific content stays in the route file. |
| `privacy/` | `page.tsx` — the public privacy policy, also used by Google OAuth verification; describes only implemented data paths. |
| `terms/` | `page.tsx` — the public service terms for the desktop app, workspace service, and optional provider integrations. |

## For AI Agents

### Working In This Directory
- Keep new interactive sections `"use client"` only where required; the landing page's SEO and no-JS baseline depend on `page.tsx`/`HomeSections.tsx` staying server components.
- `api/site-events/route.ts`'s same-origin check (`origin` must be `https://dopedb.dev`, `sec-fetch-site` must be `same-origin`) and its refusal to persist the edge client address are load-bearing privacy properties; do not loosen them.
- `TrackedLink`'s closed vocabulary of tracked names/targets (see `site/lib/AGENTS.md`) must stay in sync between `TrackedLink.tsx` and `../lib/analytics.ts`.
- `privacy/page.tsx` and `terms/page.tsx` describe only data paths the product actually implements; update them in the same change as any feature that changes what data is collected or how support requests are handled.

### Testing Requirements
- `pnpm site:build` for a production build check of this route tree; no dedicated unit tests live here.

### Common Patterns
- Bilingual content on a route is typically a `Record<"en" | "ko", {...}>` object read against the resolved language, as in `homeContent.ts`, `privacy/page.tsx`, and `terms/page.tsx`.

## Dependencies

### Internal
- `../lib/analytics.ts`, `../lib/galaxyRenderer.ts`; `../../src/design-system/components/DopeDBMarkGraphic`.

### External
- `next/image`, `next/link`, `next/navigation`, `lucide-react`, `@opennextjs/cloudflare` (`getCloudflareContext`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
