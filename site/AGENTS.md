<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# site

## Purpose
The public marketing site (`dopedb.dev`), an independent Next.js project (App
Router) deployed to Cloudflare Workers via OpenNext. It is a separate pnpm
project from the repository root (own `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`) and must not invent a broader product promise than
`docs/PRODUCT_POSITIONING.md` allows.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | Declares this as `dopedb-site`; Next 16, React 19, Three.js for the hero background; scripts for `dev`/`build`/`start` and Cloudflare `build:cloudflare`/`preview:cloudflare`/`deploy:cloudflare`/`cf:typegen`. |
| `middleware.ts` | Resolves `/ko` path or `?lang=ko` into an `x-site-lang` request header consumed by server components for locale selection. |
| `next.config.mjs` | Next.js build configuration for the site. |
| `open-next.config.ts` | OpenNext-for-Cloudflare adapter configuration used to build the Worker deployment. |
| `wrangler.jsonc` | Checked-in Cloudflare Worker configuration (name, routes, bindings) — source of truth per `docs/CLOUDFLARE_OPERATIONS.md`. |
| `cloudflare-bindings.d.ts` / `cloudflare-env.d.ts` | Generated/declared TypeScript types for the Worker's Cloudflare bindings and environment. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js App Router routes, page sections, and API routes (see `app/AGENTS.md`). |
| `lib/` | DOM-free site logic: analytics event validation and the Three.js galaxy renderer (see `lib/AGENTS.md`). |
| `public/` | Static assets served at the site root: icons, favicons, screenshots, `llms.txt` (see `public/AGENTS.md`). |

## For AI Agents

### Working In This Directory
- This project has its own dependency tree; run its scripts with `pnpm --dir site <script>` or the root-level `pnpm site:*` aliases, not by installing into the repo root.
- Public claims on this site must match `docs/PRODUCT_POSITIONING.md`; do not describe a capability the shipped product does not have.
- Locale content is bilingual (`en`/`ko`) resolved through `middleware.ts`'s `x-site-lang` header, not the repository's typed `t()` i18n system used elsewhere (this is a standalone Next project).

### Testing Requirements
- `pnpm site:build` (root alias for `pnpm --dir site build`) for a production build check. `pnpm workspace:cloud:build`-equivalent for this project is `pnpm site:cloud:deploy` for actual deployment; use `pnpm site:cloud:verify-deployment` to confirm a deployed Worker version has 100% production traffic before reporting a deployment as done (root `AGENTS.md` Validation section).
- No frontend unit tests live here; the 208-test critical budget is scoped to the desktop app (`src/`), not this project.

### Common Patterns
- Server components stay the default; `"use client"` is added only where interactivity or browser APIs are required (`GalaxyHero.tsx`, `PlatformDownloads.tsx`, `TrackedLink.tsx`, `HomeDemoShowcase.tsx`, `HomeScopeWalkthrough.tsx`, `SitePageEffects.tsx`, `DopeDBMark.tsx`).

## Dependencies

### Internal
- Imports the shared brand graphic from `../src/design-system/components/DopeDBMarkGraphic` (the only cross-project import into the desktop app's source tree).

### External
- Next.js 16, React 19, Three.js, `@opennextjs/cloudflare`, Tailwind v4 (via `@tailwindcss/postcss`), Wrangler.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
