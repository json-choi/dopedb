<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/scripts

## Purpose
Operational and CI tooling for the Workspace Cloud Worker: applying and
verifying D1 migrations with content-hash receipts, a deployment-time
PostgreSQL-syntax preflight gate, and the isolated D1 contract harness. These scripts run
outside the Next.js/Worker runtime, invoked by `pnpm` scripts, CI, or
`scripts/deploy-workspace-cloudflare.mjs` at the repo root.

## Key Files
| File | Description |
|------|-------------|
| `migrate-d1.mjs` | Applies/checks D1 migrations under `../d1-migrations/*.sql`. Verifies the Wrangler-authenticated account matches `wrangler.jsonc`'s `account_id` (skipped with `--local`), diffs the checked-in migration files against a `workspace_schema_migration` ledger table (sha256 per file) and Wrangler's own `d1_migrations` table, and fails closed (`D1 migration bytes or ordering differ from the deployed history`) on any mismatch. Refuses to adopt/reset a database with existing tables but no ledger. Applies pending migrations inside a temporary migrations dir (each file gets an `INSERT INTO workspace_schema_migration` appended) so the receipt is atomic per migration. Flags: `--check` (report only), `--local [--persist-to <absolute dir>]`. |
| `migrate-production.sh` | Thin production guard in front of `migrate-d1.mjs`: refuses to run unless `WORKSPACE_DEPLOYMENT_ENV=production`, refuses if `DATABASE_URL`/`DATABASE_URL_UNPOOLED` is set (production uses the D1 binding, not a connection string), then `exec`s `migrate-d1.mjs "$@"` (so `--local --persist-to <dir>` still works for the test harness). |
| `check-d1-runtime.mjs` | Deployment gate for the Next.js app code, not for migrations. Parses every `.ts`/`.tsx` under `../app` and `../lib` (via `@babel/parser`), inspects each `` sql`...` `` tagged template for PostgreSQL-only syntax (`pg_advisory*`, `jsonb_*`, `gen_random_uuid`, `ILIKE`, `FOR UPDATE`/`SKIP LOCKED`, casts, etc.) that D1's SQLite dialect cannot run, and also flags `../lib/db.ts` if it still references `neon-http`, `@neondatabase/serverless`, or `databaseUrl` ("legacy runtime driver"). Exits non-zero with a file:line list on any finding; used as a deploy preflight, not a migration check. |
| `test-d1-migrations.mjs` | Integration test for `migrate-production.sh`/`migrate-d1.mjs` against a disposable local D1 (`wrangler d1 execute --local --persist-to <temp dir>`, workerd-backed). Runs the production migration entry point twice to prove idempotent replay, asserts `migrate-d1.mjs --check` then reports `0 pending`, tampers one row's `sha256` in `workspace_schema_migration`, and asserts `migrate-production.sh` now fails with `D1 migration bytes or ordering differ`. Also proves a pre-existing but unrecognized local D1 (a stray `CREATE TABLE` with no ledger) is rejected with `refusing automatic adoption or reset`, and finally runs the `vitest.contracts.config.ts` suite. Invoked as `bash scripts/test-provider-import-d1.sh` from the repo root, which just `exec`s `node workspace-cloud/scripts/test-d1-migrations.mjs`. |

## For AI Agents

### Working In This Directory
- **Content-hash ledger, not filename ordering.** `migrate-d1.mjs` creates and
  maintains `workspace_schema_migration(file TEXT PRIMARY KEY, sha256 TEXT,
  applied_at TEXT)` inside the target D1 database itself. Every applied
  migration file's exact bytes are sha256-hashed and compared, in order,
  against both this ledger and Wrangler's own `d1_migrations` table
  (`verifyD1MigrationPrefix`). Any drift — reordered files, edited bytes in an
  already-applied migration, a ledger that doesn't share a byte-identical
  prefix with the checked-in files — is a hard failure, not a warning; there
  is no filename-only fast path. A pre-existing database with tables but no
  `workspace_schema_migration` table is refused outright rather than adopted.
- Editing any `../d1-migrations/*.sql` file that has already shipped, or
  reordering/renumbering migration files, is exactly what this ledger is
  designed to reject — expect `migrate-d1.mjs --check` and
  `test-d1-migrations.mjs` to fail on purpose in that case. New migrations
  must be the next sequential `NNNN_name.sql` with no gap
  (`readMigrations` enforces `Number(name.slice(0,4)) === index`).
- Re-run `bash scripts/test-provider-import-d1.sh` (repo root) after touching
  `migrate-d1.mjs`, `migrate-production.sh`, or any file under
  `../d1-migrations/`, per the root `AGENTS.md`/`CLAUDE.md` database-deployment
  rule — a local `pnpm build` does not exercise the real migration entry
  point.

### Testing Requirements
- `pnpm db:migrate` → `node scripts/migrate-d1.mjs` (apply pending D1
  migrations, remote by default).
- `pnpm db:preflight` → `node scripts/migrate-d1.mjs --check` (report pending
  count only, no writes).
- `pnpm db:migrate:production` → `bash scripts/migrate-production.sh` (same,
  gated on `WORKSPACE_DEPLOYMENT_ENV=production` and the absence of a
  `DATABASE_URL*`).
- `pnpm db:check` → `drizzle-kit check --config=drizzle.d1.config.ts` (not a
  script in this directory, but part of the same migration-check surface).
- `pnpm test:d1-import` → `node scripts/test-d1-migrations.mjs` (spins up its
  own disposable local D1; no external services required beyond `wrangler`).
- Repo-root `bash scripts/test-provider-import-d1.sh` execs
  `node workspace-cloud/scripts/test-d1-migrations.mjs` directly — this is the
  command named by the root `AGENTS.md`/`CLAUDE.md` "DB deployment path
  changes" validation rule.
- `check-d1-runtime.mjs` is run by `.github/workflows/ci.yml` (as
  `pnpm --dir workspace-cloud exec node scripts/check-d1-runtime.mjs`) and by
  `../../scripts/deploy-workspace-cloudflare.mjs` as a pre-deploy gate; it has
  no dedicated `package.json` script name of its own in this package.

### Common Patterns
- D1-facing scripts (`migrate-d1.mjs`, `test-d1-migrations.mjs`) shell out to
  Wrangler via `spawnSync("pnpm", ["exec", "wrangler", ...])` rather than a JS
  client, and pass `--local --persist-to <absolute temp dir>` to run against a
  disposable workerd-backed D1 instead of the real remote database; see
  `test-d1-migrations.mjs`'s `mkdtemp(...)` + `migrate-production.sh --local
  --persist-to <dir>` pattern.
- Failure paths write raw Wrangler stdout/stderr only to a local,
  mode-`0600` log file (`.wrangler/d1-migration-error.log` in
  `migrate-d1.mjs`) and keep the thrown error message generic.
- `WORKSPACE_DEPLOYMENT_ENV=production` and `CI=true` are the two env
  conventions gating production-only/CI-only behavior across
  `migrate-production.sh` and `test-d1-migrations.mjs`.

## Dependencies

### Internal
- `../d1-migrations/*.sql` — the checked-in D1 migration files `migrate-d1.mjs`
  and `test-d1-migrations.mjs` verify and apply.
- `../wrangler.jsonc` — read by `migrate-d1.mjs` for the `WORKSPACE_DB` D1
  binding (`database_name: "dopedb-workspace"`, a UUID `database_id`) and
  `account_id`.
- `../lib/db.ts` — inspected (not imported) by `check-d1-runtime.mjs` for a
  leftover Postgres/Neon driver reference.
- `../app/**`, `../lib/**` — scanned by `check-d1-runtime.mjs` for
  PostgreSQL-only SQL inside `` sql`...` `` tags.
- `../vitest.contracts.config.ts` — invoked by `test-d1-migrations.mjs`.
- Repo-root `../../scripts/test-provider-import-d1.sh` and
  `../../scripts/deploy-workspace-cloudflare.mjs` call into this directory's
  scripts.

### External
- `wrangler` (4.129.0) — D1 CLI, driven via `spawnSync` in `migrate-d1.mjs`
  and `test-d1-migrations.mjs`.
- `@babel/parser` (8.0.4) — used only by `check-d1-runtime.mjs` to parse
  `.ts`/`.tsx` source into an AST.
- `vitest` (4.1.11) — invoked as a subprocess by
  `test-d1-migrations.mjs`, not
  imported directly.
- Node built-ins: `node:child_process`
  `spawnSync` (all Wrangler/Vitest-invoking scripts), `node:crypto`
  `createHash` (`migrate-d1.mjs`), `node:fs`/`node:fs/promises`,
  `node:path`, `node:url`, `node:os`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
