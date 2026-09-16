<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud

## Purpose
Workspace Web: the authenticated web and API control plane for DopeDB
workspaces, deployed as its own Next.js 16 (App Router) application built with
`@opennextjs/cloudflare` onto Cloudflare Workers (`app.dopedb.dev`), separate
from the Tauri desktop app in `../src`/`../src-tauri` and from the marketing
`../site`. It is a distinct trust boundary: Cloudflare D1 (via the `WORKSPACE_DB`
binding declared in `wrangler.jsonc`) is the live store for workspace identity,
membership, audit metadata, secret-free shared connection templates, and
encrypted provider-integration material. Per the product's shared-access axis
(root `AGENTS.md`/`CLAUDE.md`), this app must never store a member-local
database password, an ordinary query result row, or any other long-lived
secret in a shared record; managed access is issued as short-lived,
member-specific credentials at request time. A companion Cloudflare Worker in
`infrastructure/` (a separate deploy target) mints the short-lived Workload
Identity Federation tokens this app and the analytics Worker use to reach GCP;
it is not part of the Next.js build.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | App name `dopedb-workspace-cloud`; Next.js 16, React 19, Drizzle ORM 0.45, `better-auth`, `@neondatabase/serverless`, `sanitize-html`; devDependencies include `wrangler`, `@opennextjs/cloudflare`, `drizzle-kit`, `vitest`, `miniflare`. Scripts cover `dev`/`build`/`start`, D1 migration (`db:*`), Postgres-harness tests (`test:postgres-*`), Cloudflare build/deploy (`build:cloudflare`, `preview:cloudflare`, `deploy:cloudflare`), and the separate identity Worker (`build:identity`, `deploy:identity`). |
| `next.config.mjs` | Sets `outputFileTracingRoot`/`turbopack.root` to the repo root, rewrites `/ko` and `/ko/:path*` to the locale-independent path, and emits a strict `Content-Security-Policy` plus HSTS/`X-Frame-Options: DENY`/`Referrer-Policy: no-referrer` on every response; Microsoft Clarity domains are added to the CSP only when `NEXT_PUBLIC_CLARITY_PROJECT_ID` is a valid project id at build time. |
| `middleware.ts` | Derives the request locale from the path, stores it in a one-year cookie, forwards it as a header for server components, and forces `cache-control: private, no-store` on `/analyses/*`, `/article-invitations/*`, and `/open-article/*` (revocable/identity-bearing pages that must never be cached). |
| `wrangler.jsonc` | Deploy config for the main Worker `dopedb-workspace` (custom domain `app.dopedb.dev`, no `workers_dev`/`preview_urls`). Declares the `WORKSPACE_DB` D1 binding (`migrations_dir: "d1-migrations"`), service bindings to `dopedb-product-analytics` and to this same Worker's identity companion (`WORKLOAD_IDENTITY` → `dopedb-workspace-identity`, entrypoint `WorkspaceIdentity`), and the fixed OIDC vars consumed by `infrastructure/`. |
| `wrangler.identity.jsonc` | Deploy config for the separate `dopedb-workspace-identity` Worker built from `infrastructure/` — see `infrastructure/AGENTS.md`. |
| `open-next.config.ts` | `defineCloudflareConfig()` with no overrides; the actual Cloudflare adapter entry point for `build:cloudflare`/`preview:cloudflare`/`deploy:cloudflare`. |
| `drizzle.config.ts` | drizzle-kit config for the **historical/harness** Postgres schema (`dialect: "postgresql"`, schema `./drizzle/schema.postgres.ts`, out `./drizzle`) — not wired to any `db:*` script; see `drizzle/AGENTS.md`. |
| `drizzle.d1.config.ts` | drizzle-kit config for the **live** D1 schema (`dialect: "sqlite"`, schema `./lib/d1/schema/index.ts`, out `./d1-migrations`) — the target of `pnpm db:generate`/`db:check`; see `d1-migrations/AGENTS.md`. |
| `tsconfig.json` | Strict Next.js TS project (`ES2022`, bundler resolution, `@/*` path alias to this directory); explicitly excludes `identity-env.d.ts` and `infrastructure/identity-worker.ts`, which build under `infrastructure/tsconfig.identity.json` instead. |
| `postcss.config.mjs` | Tailwind v4 via `@tailwindcss/postcss` only. |
| `vitest.contracts.config.ts` | Runs `lib/control-plane-contracts.harness.ts` and `lib/d1-storage.harness.ts` under `pnpm test:contracts` (repo root alias: `pnpm check:knowledge`). Aliases `server-only` to `node:fs` so server-only modules import cleanly under Node/Vitest. |
| `vitest.provider-harness.config.ts` | Runs only `lib/provider-import-postgres.harness.ts`, invoked by `run-provider-import-postgres-harness.mjs` under `pnpm test:postgres-import`, never directly. |
| `cloudflare-env.d.ts` | Wrangler-generated ambient `CloudflareEnv` bindings for the main Worker (regenerate with `pnpm cf:typegen`, never hand-edit). |
| `cloudflare-bindings.d.ts` | Hand-written narrow re-exports of `Fetcher`/`Service`/`WorkerVersionMetadata`/`D1Database` types from `@cloudflare/workers-types`, kept separate so importing them doesn't shadow the browser DOM's `Request`/`Response` globals used elsewhere in the app. |
| `identity-env.d.ts` | Wrangler-generated ambient `IdentityEnv` bindings for the separate identity Worker (regenerate per `infrastructure/AGENTS.md`, never hand-edit). |
| `deployment-public.json` | The only build-time public value read into a production Cloudflare build: `NEXT_PUBLIC_CLARITY_PROJECT_ID`. Runtime secrets never enter the build this way. |
| `README.md` | Local-setup and product-behavior notes: this app is a separate trust boundary from the Tauri desktop, the `WORKSPACE_DB` D1 binding is used directly (no Postgres connection string/emulation in production), and the opt-in web analytics consent/CSP/event-contract model. |
| `.env.example` | Documented local environment variables (Google OAuth client, `BETTER_AUTH_SECRET`/`URL`, `WORKSPACE_CREDENTIAL_KEY`, Workspace KMS key/WIF settings, `CRON_SECRET`, background scheduler settings, GitHub Knowledge App settings) with placeholder, non-functional values only. |
| `.gitignore` | Ignores `.open-next/`, `.wrangler/`, and `.dev.vars*` (local Wrangler secrets). |
| `pnpm-workspace.yaml` | pnpm settings for this sub-project: `allowBuilds` for `esbuild`/`workerd`, pinned `overrides` (`postcss`, `sharp`, a `nanoid` floor, an `esbuild-kit` transitive pin), and a 1440-minute (`minimumReleaseAgeStrict`) minimum package-release age gate. |
| `pnpm-lock.yaml` | Lockfile for this sub-project's own dependency graph. |
| `next-env.d.ts` | Next.js-generated ambient type reference (`.next/types/routes.d.ts`, `.next/types/root-params.d.ts`); regenerated automatically, never hand-edited. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js App Router tree: every `route.ts`/`page.tsx`, plus their screen-local components (see `app/AGENTS.md`). |
| `lib/` | Server-only core: auth/session, workspace/connection/grant/lease domain logic, provider-integration adapters, Analysis Article storage, D1 schema, and the versioned HTTP contracts (see `lib/AGENTS.md`). |
| `features/` | Client-side feature modules (`articleSharing/`, `connectionAccess/`, `providerAccess/`) composed by `app/settings/*` and article-handoff pages (see `features/AGENTS.md`). |
| `drizzle/` | Historical/harness-only PostgreSQL schema and its two migrations; the live schema is `lib/d1/schema/` (see `drizzle/AGENTS.md`). |
| `d1-migrations/` | The live, production Cloudflare D1 migration set the deployed Worker actually reads and writes (see `d1-migrations/AGENTS.md`). |
| `infrastructure/` | Source for the separate `dopedb-workspace-identity` Cloudflare Worker (GCP Workload Identity Federation token issuance) (see `infrastructure/AGENTS.md`). |
| `scripts/` | D1 migration/deploy tooling and the isolated PostgreSQL provider-import test harness runner/guard (see `scripts/AGENTS.md`). |

## For AI Agents

### Working In This Directory
- This is a separate pnpm project inside the repo (its own `pnpm-lock.yaml`/`pnpm-workspace.yaml`); run its scripts with `pnpm --dir workspace-cloud <script>` or the repo-root `pnpm workspace:cloud:*` aliases, not from the repo root directly.
- D1 (`lib/d1/schema/`, migrated via `d1-migrations/`) is the live production schema; the PostgreSQL schema under `drizzle/` is historical/harness-only — confirm which one a change targets before editing (see `drizzle/AGENTS.md` and `d1-migrations/AGENTS.md`).
- `app/analyses/[slug]/PublicAnalysisArticle.tsx` imports `AnalysisArticleBody` directly from the sibling Tauri desktop app's `../../src/design-system/components/AnalysisArticleBody.tsx` (also referenced by a Tailwind `@source` scan in `app/globals.css`) — this is a real, intentional cross-project dependency for the shared Analysis Article rendering primitive, not an accident; keep it in sync with the desktop `src/design-system/` component if either changes.
- Public Analysis Article publications are immutable HTML snapshots that never execute the saved query at read time (see `docs/adr/0007-analysis-article-bi-domain.md` at the repo root); `middleware.ts` additionally forces `cache-control: private, no-store` on `/analyses/*`, `/article-invitations/*`, and `/open-article/*` so a revoked publication or a private handoff link cannot be served from a shared cache.
- Long-lived secrets are never written into a shared/workspace record; managed provider credentials are issued as short-lived, member-specific leases at request time (see `lib/AGENTS.md`, `features/AGENTS.md` `providerAccess/`, and the connection-lease routes in `app/AGENTS.md`).
- Follow the repo-root `AGENTS.md`/`CLAUDE.md` rule that connecting, reconnecting, importing, repairing, or issuing/revoking credentials must never rewrite a pre-existing application user, role membership, grant, default privilege, or ACL; this app's D1 schema only ever records DopeDB's own workspace-management state (see `d1-migrations/AGENTS.md`).
- No provider API is ever called directly from application code outside the officially adapted flows this app owns (OAuth/API-key provider integrations for GCP Cloud SQL, Neon, PlanetScale, Vault); the AI-provider "official CLI only" rule in root `CLAUDE.md` is a separate boundary and does not apply to this sub-project's own database-provider integrations.

### Testing Requirements
- `pnpm workspace:cloud:build` (repo root) / `pnpm --dir workspace-cloud build` — Next.js build; the baseline check for any change here.
- `pnpm --dir workspace-cloud test:contracts` (repo-root alias `pnpm check:knowledge`) — Vitest wire-contract/serialization suite (`lib/control-plane-contracts.harness.ts`, `lib/d1-storage.harness.ts`); does not exercise `app/**` route handlers directly.
- `bash scripts/test-provider-import-d1.sh` (repo root; execs `workspace-cloud/scripts/test-d1-migrations.mjs`, equivalently `pnpm --dir workspace-cloud test:d1-import`) — run for any change to `d1-migrations/`, `scripts/migrate-d1.mjs`, or `scripts/migrate-production.sh`; exercises the production migration entry point against an isolated, disposable local D1.
- `pnpm --dir workspace-cloud test:postgres-import` / `test:postgres-harness-guard` — the isolated PostgreSQL provider-import integration suite and its own source/environment guard (see `scripts/AGENTS.md`); requires an explicitly provisioned, non-production database.
- `pnpm workspace:cloud:verify-deployment <worker-version-id>` (repo root, runs `scripts/check-workspace-deployment.mjs`) — required before reporting a deployment as successful; confirms the named Worker version is receiving 100% of production traffic and matches the live production-domain deployment receipt. A local build or test pass alone is never deployment evidence.
- `pnpm lint` (repo root; `lint:hooks` → `eslint src workspace-cloud site --ext .ts,.tsx --max-warnings 0`) lints this directory's `.ts`/`.tsx` files with zero warnings allowed, despite its script name.
- Any UI change under `app/` or `features/` also needs a manual check per root `AGENTS.md`/`CLAUDE.md`; there is no route-level HTTP integration test suite for `app/api/**` in this repository.

### Common Patterns
- Server-only data/session logic lives in `lib/`; `app/**/route.ts` and `page.tsx` files are thin HTTP/RSC boundaries over it, and client-only feature logic lives in `features/`. See `app/AGENTS.md` for the six-step mutating-route pattern (origin check → capability authorization → optimistic-revision check → scoped DB lookup → body validation → versioned/gated commit) that most `route.ts` files follow.
- Wire contracts are hand-validated at both the sender and receiver (strict parsers rejecting unexpected shape) rather than trusted from a shared type import alone — see `features/AGENTS.md`'s note on `providerAccess/` parsers and `lib/AGENTS.md`'s contract files.

## Dependencies

### Internal
- `../src/design-system/components/AnalysisArticleBody.tsx` — the one verified cross-project import from the Tauri desktop app's frontend (see note above).
- `../docs/adr/0007-analysis-article-bi-domain.md` — the ADR this app's Analysis Article sharing/publication model implements.
- `../scripts/deploy-workspace-cloudflare.mjs`, `../scripts/check-workspace-deployment.mjs`, `../scripts/test-provider-import-d1.sh` — repo-root automation that builds, deploys, and verifies this sub-project.
- `product-analytics-cloudflare/` — the separate sub-project `wrangler.jsonc` declares a service binding to (`PRODUCT_ANALYTICS`), and whose own Worker consumes the identity Worker's `AnalyticsIdentity` entrypoint alongside this app's `WorkspaceIdentity` one.

### External
- `next` 16, `react`/`react-dom` 19, `drizzle-orm` 0.45 + `drizzle-kit`, `better-auth` + `@better-auth/drizzle-adapter`, `@neondatabase/serverless`, `sanitize-html`, `pretendard` (font).
- `wrangler`, `@opennextjs/cloudflare`, `miniflare` (devDependencies; Cloudflare build/deploy/local-runtime tooling).
- `vitest` (contract and provider-harness test runners).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->

## Vitest 4.1.11 pin (reviewed 2026-09-17)

`vitest` stays at 4.1.11 here while the repository root and the two Worker
sub-projects are on 5.0.0. The gap is a recorded decision, not an open defect —
no failing command, flag, timeout, mock, or teardown was reproducible:

- Nothing binds this app to a Vitest major. `@cloudflare/vitest-pool-workers`
  appears nowhere in the repository, and the two current Miniflare users
  (`lib/d1-storage.harness.ts` and `lib/provider-import-postgres-harness.setup.ts`)
  drive it as a plain library under the default Node pool. Both configs set only
  `resolve.alias`, `test.include`, `setupFiles`, and the explicit 180s timeouts.
- Every runner is invoked as `vitest run --config <file>`, the same shape the
  other three projects use, so no CLI flag or timeout behaviour differs by
  version.
- No Vitest 5 breaking change reaches these suites: all 91 `.resolves`/
  `.rejects` assertions are awaited, `vi.mock`/`vi.hoisted` appear only at
  module top level, every mock and spy is created inside a test or an assertion
  helper where the new `clearMocks` default drops nothing, and
  `test.sequential`, `expect.poll`, `resolveConfig`, `VITEST_POOL_ID`,
  `toHaveTextContent`, and the browser-mode APIs are unused.
- `pnpm --dir workspace-cloud test:contracts` passes on 4.1.11 (2 files, 10
  cases, ~28s) with no skipped case, timeout, or leftover `workerd`/`vitest`
  process.
- Neither runner is on a CI path: `ci.yml`'s `provider-postgres` job runs the
  D1 migration, Cloud SQL, and harness-guard scripts, and `scripts/test-all.sh`
  has no workspace-cloud vitest phase.

Raise the pin when a reproducible failure or a concrete maintenance need
appears, or let the weekly Dependabot `workspace-cloud-dependencies` group do
it. Vitest 5 additionally needs Node >= 22.12 (CI uses 24, so that is met) and
turns `vite` into a required non-optional peer; this package declares no `vite`,
and pnpm already resolves that peer the same way it does for
`workspace-scheduler-cloudflare`, which runs 5.0.0 without declaring one.
