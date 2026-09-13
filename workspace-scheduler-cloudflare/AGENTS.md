<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-scheduler-cloudflare

## Purpose
Independent pnpm sub-project implementing a minimal Cloudflare Worker that
wakes up the Cloudflare Workspace control plane on a schedule. Its D1
database stores exactly two rows (`credential`, `maintenance`): a due time, a
short execution lease, a generation counter, and a closed error kind — no
workspace, member, repository, provider, credential, graph, or Analysis data.
The cron checks D1 every minute and calls `app.dopedb.dev` only when a task is
actually due, keeping PostgreSQL authoritative while letting the underlying
Neon database stay suspended when there is no durable work. It is a wake-up
coordinator only, not a credential-validity boundary: each provider still
enforces its own signed-in member lease TTL, so an unavailable coordinator
degrades to a repaired missed wake-up rather than a user-visible connection
failure.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | `dopedb-workspace-scheduler-cloudflare`; `build`/`test`/`deploy` plus `db:migrate:local`/`db:migrate:remote` (`wrangler d1 migrations apply dopedb-workspace-scheduler`) and `types` (`wrangler types`). |
| `wrangler.jsonc` | Worker config: `workers_dev: true` but `preview_urls: false`, per-minute cron trigger, `SCHEDULER_DB` D1 binding, and required `KICK_TOKEN`/`WORKSPACE_CRON_SECRET` secrets. |
| `README.md` | Full protocol: `/v1/kick` requires the exact contract header and the `KICK_TOKEN` capability (a server-to-server secret, never a Desktop/browser one); the Worker calls existing internal routes with the separate `WORKSPACE_CRON_SECRET`; a `nextRunAt: null` receipt parks a row in a dormant state; five consecutive failures open a six-hour circuit breaker that a new kick resets; upstream calls and kick bodies are streamed under fixed byte caps with redirects refused, and logs contain only task name and closed failure enums. |
| `tsconfig.json`, `vitest.config.ts` | TypeScript and Vitest configuration. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | Worker cron handler, kick endpoint, and receipt parsing, documented inline below. |
| `migrations/` | D1 schema migrations, documented inline below. |

### `src/` (inline)
| File | Description |
|------|-------------|
| `index.ts` | Implements the cron tick and the `/v1/kick` HTTP endpoint against `workspace_background_task`. Owns the constants for body-size caps (`MAX_KICK_BODY_BYTES`/`MAX_UPSTREAM_BODY_BYTES`), lease duration (`LEASE_MS`), upstream timeout, min/max retry backoff, the 5-failure/6-hour circuit breaker, and the far-future `DORMANT_DUE_AT_MS` sentinel used to park a row. Exports `parseKick`/`parseSchedulerReceipt` and `__test` hooks for `index.harness.ts`. |
| `index.harness.ts` | Vitest contract test exercising the Worker's kick parsing and scheduler-receipt handling against a mocked D1-shaped row. |

### `migrations/` (inline)
| File | Description |
|------|-------------|
| `0001_mvp_baseline.sql` | Creates `workspace_background_task` (`WITHOUT ROWID, STRICT`) with a `task` primary key constrained to `'credential'`/`'maintenance'`, non-negative timing columns, a 36-character lease token format check, a bounded `failure_count` (0–20), a closed `last_error_kind` enum (`transport`/`response`/`receipt`/`storage`), and a check tying `lease_until_ms`/`lease_token` to be both-set or both-empty together. |

## For AI Agents

### Working In This Directory
- This Worker stores exactly the two named task rows — do not widen its D1 schema to hold workspace, member, repository, provider, credential, or graph data; that data belongs to the Workspace control plane, not the scheduler.
- Preserve the `WITHOUT ROWID, STRICT` table shape and its `CHECK` constraints (task enum, byte-length lease token, failure-count bound, paired lease columns) when adding a migration; add a new numbered migration file rather than editing `0001_mvp_baseline.sql`.
- Keep `KICK_TOKEN` (external trigger capability) and `WORKSPACE_CRON_SECRET` (internal upstream-call secret) as two distinct secrets with distinct purposes — do not collapse them into one.
- `preview_urls: false` and no custom route are intentional; do not add a public route without a corresponding product/security review.

### Testing Requirements
- `pnpm scheduler:cloudflare:test` (root) / `pnpm test` (here) runs `vitest run --config vitest.config.ts`, exercising `src/index.harness.ts`.
- `pnpm scheduler:cloudflare:build` (root) / `pnpm build` (here) runs `tsc --noEmit`.
- `pnpm scheduler:cloudflare:deploy` (root) / `pnpm deploy` (here) runs `wrangler deploy`; `db:migrate:local`/`db:migrate:remote` apply D1 migrations and are real state changes, not build checks.

### Common Patterns
- Every timing/size constant is a named `const` at the top of `src/index.ts` (e.g. `LEASE_MS`, `CIRCUIT_BREAKER_FAILURES`) rather than an inline literal — follow that convention for any new tunable.

## Dependencies

### Internal
- Calls the Cloudflare Workspace control-plane HTTP routes at `app.dopedb.dev` (`WORKSPACE_ORIGIN`); those routes and their contracts live in `workspace-cloud/` and `dopedb-protocol::control_plane`.

### External
- `wrangler` (Workers/D1 build/deploy/migrate/dev), `vitest`, `typescript`; Cloudflare D1 and Cron Triggers at runtime.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
