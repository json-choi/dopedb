<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/scripts

## Purpose
Operational and CI tooling for the Workspace Cloud Worker: applying and
verifying D1 migrations with content-hash receipts, a deployment-time
PostgreSQL-syntax preflight gate, a standalone (currently unwired) Drizzle/
Postgres migration runner, and the guard + harness scripts that run the
isolated PostgreSQL provider-import integration suite. These scripts run
outside the Next.js/Worker runtime, invoked by `pnpm` scripts, CI, or
`scripts/deploy-workspace-cloudflare.mjs` at the repo root.

## Key Files
| File | Description |
|------|-------------|
| `migrate-d1.mjs` | Applies/checks D1 migrations under `../d1-migrations/*.sql`. Verifies the Wrangler-authenticated account matches `wrangler.jsonc`'s `account_id` (skipped with `--local`), diffs the checked-in migration files against a `workspace_schema_migration` ledger table (sha256 per file) and Wrangler's own `d1_migrations` table, and fails closed (`D1 migration bytes or ordering differ from the deployed history`) on any mismatch. Refuses to adopt/reset a database with existing tables but no ledger. Applies pending migrations inside a temporary migrations dir (each file gets an `INSERT INTO workspace_schema_migration` appended) so the receipt is atomic per migration. Flags: `--check` (report only), `--local [--persist-to <absolute dir>]`. |
| `migrate-production.sh` | Thin production guard in front of `migrate-d1.mjs`: refuses to run unless `WORKSPACE_DEPLOYMENT_ENV=production`, refuses if `DATABASE_URL`/`DATABASE_URL_UNPOOLED` is set (production uses the D1 binding, not a connection string), then `exec`s `migrate-d1.mjs "$@"` (so `--local --persist-to <dir>` still works for the test harness). |
| `migrate.mjs` | Standalone Postgres/Drizzle migration runner (`drizzle-orm/postgres-js`, table `drizzle.__drizzle_migrations`). Validates the applied migration history's hash/timestamp lineage against `../drizzle/*` before running `migrate()`, takes a `pg_advisory_lock`, and never logs connection URLs, SQL, or rows. **Not referenced by any `package.json` script, not imported by another script, and not exercised by any test** — it targets the pre-D1 Postgres control plane and is invoked manually only, if at all. Verify with the owner before relying on it or deleting it. |
| `check-d1-runtime.mjs` | Deployment gate for the Next.js app code, not for migrations. Parses every `.ts`/`.tsx` under `../app` and `../lib` (via `@babel/parser`), inspects each `` sql`...` `` tagged template for PostgreSQL-only syntax (`pg_advisory*`, `jsonb_*`, `gen_random_uuid`, `ILIKE`, `FOR UPDATE`/`SKIP LOCKED`, casts, etc.) that D1's SQLite dialect cannot run, and also flags `../lib/db.ts` if it still references `neon-http`, `@neondatabase/serverless`, or `databaseUrl` ("legacy runtime driver"). Exits non-zero with a file:line list on any finding; used as a deploy preflight, not a migration check. |
| `provider-import-postgres-harness-guard.mjs` | Source-safety guard library (no tests of its own execution beyond `.node.mjs`) for the PostgreSQL provider-import integration harness under `../lib/provider-import-postgres.harness.ts` and `../lib/provider-import-postgres-harness/*`. Exports: `canonicalLogicalDatabaseTarget`/`validateHarnessEnvironment` (rejects a harness DB URL that resolves to the same host/port/database as any of eleven common app `DATABASE_URL`-style env vars, ignoring credentials and a Neon `-pooler` alias, and requires `PROVIDER_IMPORT_TEST_DATABASE_ISOLATED=1` plus a 16–256 char sentinel), and `validateHarnessSourceTree` (a hand-rolled JS tokenizer, not an AST parser, that enforces per-file line-count ratchets from `PROVIDER_IMPORT_POSTGRES_HARNESS_SOURCE_LIMITS`, a 3,000-line total cap, exactly one unmodified root `describe.runIf(enabled)`/`it(...)` pair with no `.each`/`.concurrent`/`.skipIf`/aliasing tricks, an unconditional `database.cleanup()` inside the root `finally`, and that `vitest.provider-harness.config.ts`'s `include` list matches the guarded file manifest exactly). |
| `provider-import-postgres-harness-guard.node.mjs` | `node:test` suite for the guard module above. Copies the guarded sources into a temp dir, mutates one file per case (hidden test declarations via aliasing/namespacing/computed access, commented-out or bypassable cleanup, a config `include` drift), and asserts `validateHarnessSourceTree` throws the expected message. Also verifies `canonicalLogicalDatabaseTarget` collapses a pooler alias, and that the environment guard rejects a short sentinel, a disabled isolation flag, a non-Postgres URL, an incomplete URL, and every aliased app-DB env var. Run via `node --test`, i.e. `pnpm test:postgres-harness-guard`. |
| `run-provider-import-postgres-harness.mjs` | Runner for the actual PostgreSQL provider-import integration suite: calls `validateHarnessSourceTree()` then `validateHarnessEnvironment(process.env)` from the guard module and exits `2` with a generic refusal message on either failure (no leaked detail), supports `--check-guard-only` to stop after the guard checks, then `spawnSync`s `pnpm exec vitest run --config vitest.provider-harness.config.ts` with `BETTER_AUTH_URL=https://dopedb.invalid` and `WORKSPACE_CLOUD_RUN_POSTGRES_IMPORT_HARNESS=1` set, `stdio: "inherit"`. The harness itself (`../lib/provider-import-postgres.harness.ts`, not in this directory) exercises importing an existing PostgreSQL database as a DopeDB connection end to end — provider auth/authority scenarios, connection versioning, credential key rotation, analysis-article lifecycle/sharing/member-removal, sync, source-revision, and workspace-lifecycle scenarios — against a dedicated, independently confirmed-isolated Postgres database (never the app's own). |
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
- Changing anything under `../lib/provider-import-postgres-harness/` or
  `../lib/provider-import-postgres.harness.ts` (line counts, the root
  test/describe shape, the `finally`-block cleanup, or
  `vitest.provider-harness.config.ts`'s `include` list) must keep
  `provider-import-postgres-harness-guard.mjs`'s invariants satisfied; the
  guard's own test (`provider-import-postgres-harness-guard.node.mjs`) is the
  fastest way to check that before running the full integration suite.
- `migrate.mjs` targets a Postgres connection string
  (`DATABASE_URL`/`DATABASE_URL_UNPOOLED`), not D1, and is not wired into any
  `package.json` script or CI step found in this repository. Treat it as
  unmaintained/manual-only; confirm with the repository owner before adding a
  script reference to it or deleting it, per the root `AGENTS.md` rule against
  silently dropping or reviving unreferenced tooling.

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
- `pnpm test:postgres-harness-guard` → `node --test
  scripts/provider-import-postgres-harness-guard.node.mjs`.
- `pnpm test:postgres-import` → `node
  scripts/run-provider-import-postgres-harness.mjs` (needs a dedicated,
  independently isolated PostgreSQL database — see
  `validateHarnessEnvironment` above; fails fast without one).
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
  `migrate-d1.mjs`) and keep the thrown error message generic — the same
  discipline `migrate.mjs`'s `reportFailure` uses to withhold connection
  details from Postgres errors.
- `WORKSPACE_DEPLOYMENT_ENV=production` and `CI=true` are the two env
  conventions gating production-only/CI-only behavior across
  `migrate-production.sh` and `test-d1-migrations.mjs`.

## Dependencies

### Internal
- `../d1-migrations/*.sql` — the checked-in D1 migration files `migrate-d1.mjs`
  and `test-d1-migrations.mjs` verify and apply.
- `../drizzle/*` (migration SQL + `meta/`) — consumed only by the unwired
  `migrate.mjs`.
- `../wrangler.jsonc` — read by `migrate-d1.mjs` for the `WORKSPACE_DB` D1
  binding (`database_name: "dopedb-workspace"`, a UUID `database_id`) and
  `account_id`.
- `../lib/db.ts` — inspected (not imported) by `check-d1-runtime.mjs` for a
  leftover Postgres/Neon driver reference.
- `../app/**`, `../lib/**` — scanned by `check-d1-runtime.mjs` for
  PostgreSQL-only SQL inside `` sql`...` `` tags.
- `../lib/provider-import-postgres.harness.ts` and
  `../lib/provider-import-postgres-harness/*` — the guarded/exercised harness
  source for `provider-import-postgres-harness-guard.mjs` and
  `run-provider-import-postgres-harness.mjs`.
- `../vitest.provider-harness.config.ts`, `../vitest.contracts.config.ts` —
  Vitest configs invoked by `run-provider-import-postgres-harness.mjs` and
  `test-d1-migrations.mjs` respectively.
- Repo-root `../../scripts/test-provider-import-d1.sh` and
  `../../scripts/deploy-workspace-cloudflare.mjs` call into this directory's
  scripts.

### External
- `wrangler` (4.129.0) — D1 CLI, driven via `spawnSync` in `migrate-d1.mjs`
  and `test-d1-migrations.mjs`.
- `drizzle-orm` (`drizzle-orm/migrator`, `drizzle-orm/postgres-js`) and
  `postgres` (3.4.9) — used only by `migrate.mjs`.
- `@babel/parser` (8.0.4) — used only by `check-d1-runtime.mjs` to parse
  `.ts`/`.tsx` source into an AST.
- `vitest` (4.1.11) — invoked as a subprocess by
  `run-provider-import-postgres-harness.mjs` and `test-d1-migrations.mjs`, not
  imported directly.
- Node built-ins: `node:test`/`node:assert/strict`
  (`provider-import-postgres-harness-guard.node.mjs`), `node:child_process`
  `spawnSync` (all Wrangler/Vitest-invoking scripts), `node:crypto`
  `createHash` (`migrate-d1.mjs`), `node:fs`/`node:fs/promises`,
  `node:path`, `node:url`, `node:os`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
