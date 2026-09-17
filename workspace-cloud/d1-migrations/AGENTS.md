<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/d1-migrations

## Purpose
The live, production Cloudflare D1 (SQLite) migration set for the Workspace
control plane. `../wrangler.jsonc` binds `WORKSPACE_DB` (database
`dopedb-workspace`) with `"migrations_dir": "d1-migrations"`, and `../lib/schema.ts`
states plainly that "Cloudflare D1 owns Workspace control-plane state" — this
is the schema and migration history the running app actually reads and
writes. `drizzle.d1.config.ts` (one directory up) generates
new migrations here from `../lib/d1/schema/index.ts`.

## Key Files
| File | Description |
|------|-------------|
| `0000_workspace_baseline.sql` | Creates the full baseline table set without a schema namespace (SQLite has none) — accounts, organizations, members, invitations, knowledge/code-index tables, workspace resources, etc. |
| `0001_workspace_guards.sql` | Database-owned evidence/sequencing invariants applied after the baseline schema: `BEFORE UPDATE`/`BEFORE DELETE` triggers that reject mutation of append-only tables (`workspace_resource_version`, `workspace_resource_conflict`, `workspace_resource_conflict_resolution`, `knowledge_graph_revision`, `workspace_analysis_article_revision`, `workspace_analysis_article_query_receipt`), an immutable-payload trigger for `workspace_metadata_backup`, an append-only sync-event trigger, and a revoke-only update trigger for `workspace_analysis_publication`. |
| `0002_storage_types.sql` | Re-establishes PostgreSQL-level type strictness that SQLite/D1 does not enforce natively: per-table `BEFORE INSERT`/`BEFORE UPDATE` triggers that reject inexact numeric values, since D1 transports integers through JavaScript numbers. |
| `0003_atomic_scope.sql` | Adds `workspace_atomic_scope`: a command's validated snapshot exists only inside one atomic D1 batch, which must delete its own scope row before committing (errors roll back the insert). |
| `0004_member_evidence_detachment.sql` | A `BEFORE DELETE` trigger on `member` that detaches only the nullable actor reference before SQLite's composite-FK `SET NULL` would otherwise also clear `organization_id` — replicating the column-scoped `SET NULL` behavior the Postgres schema relied on. Requires runners to already be revoked. |
| `0005_backup_chunks.sql` | Adds `workspace_backup_chunk` to hold bounded pieces of encrypted snapshot envelopes that exceed D1's 2 MB row limit, plus insert/update/delete guard triggers keeping chunks in the same transaction and retention cascade as their metadata row. |
| `0006_retention_purge.sql` | Narrows the append-only delete guards from `0001`/prior so evidence deletion is possible only inside the exact due-workspace retention-purge batch, adding a matching delete guard on `organization` itself. |
| `0007_unusual_lionheart.sql` | Generated Desktop authorization-code table, hashed code/approval uniqueness, browser-session/user foreign keys, and constrained client/challenge fields. |

| `0008_remove_device_authorization.sql` | Removes the unused device-code authorization table; Desktop PKCE uses its own authorization-code table. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `meta/` | drizzle-kit generated snapshots and the applied-migration ledger (`_journal.json`, SQLite dialect, tags `0000_workspace_baseline` through `0008_remove_device_authorization`). Not hand-edited. |

## For AI Agents

### Working In This Directory
- Treat every `.sql` file here as append-only once it has a matching
  `meta/_journal.json` entry. `../scripts/migrate-d1.mjs` requires filenames to
  match `^\d{4}_[a-z0-9_]+\.sql$` with no gaps in the four-digit prefix,
  sha256-hashes each file's bytes, and compares that against a
  `workspace_schema_migration` ledger table it creates inside the D1 database
  itself (`file`, `sha256`, `applied_at` columns) plus wrangler's own
  `d1_migrations` table. If an already-applied file's bytes, hash, or order no
  longer match that ledger it fails closed with `D1 migration bytes or
  ordering differ from the deployed history` instead of silently reapplying or
  skipping it, and a database whose tables predate the ledger is refused with
  `refusing automatic adoption or reset` — see `../scripts/AGENTS.md`. **Never
  edit an already-applied migration file**; add a new `NNNN_description.sql`
  one instead.
- Generate new migrations with `pnpm --dir workspace-cloud db:generate`
  (`drizzle-kit generate --config=drizzle.d1.config.ts`, whose `out:
  "./d1-migrations"` targets this exact directory) against
  `../lib/d1/schema/index.ts`; do not hand-write a new numbered file without
  running that generator first.
- This database stores DopeDB's own workspace-management state, not the
  connected external database's application-level users, roles, or grants.
  `workspace_credential_lease` (`0000`) records only DopeDB-issued references
  to its own managed short-lived credentials (`external_credential_id`,
  `access_mode`, `active_slot`, `expires_at`, `revoked_at`); `workspace_connection_grant`
  (`0000`) records DopeDB's own member-to-connection capability
  (`view`/`read`/`use`/`manage`), not the target database's roles or ACLs. Per
  root `AGENTS.md`/`CLAUDE.md`, connecting, reconnecting, importing, repairing,
  or issuing/revoking credentials must never rewrite a pre-existing
  application user, role membership, grant, default privilege, or ACL —
  nothing in this schema does that; those objects exist only inside the
  connected database itself.
- New tables/columns that must reject inexact numbers or enforce
  Postgres-shaped invariants D1 does not have natively (as `0002_storage_types.sql`
  and `0001_workspace_guards.sql` do) need their own trigger migration, not
  application-layer-only validation, since D1 is reachable outside the app
  via `wrangler d1 execute`.
- The production entry point for applying these migrations is
  `../scripts/migrate-production.sh` (gated on `WORKSPACE_DEPLOYMENT_ENV=production`
  and rejects any `DATABASE_URL`/`DATABASE_URL_UNPOOLED`, since production
  uses only the D1 binding); `pnpm --dir workspace-cloud db:migrate:production`
  runs it.

### Testing Requirements
- `pnpm --dir workspace-cloud test:d1-import`, equivalently repo-root
  `bash scripts/test-provider-import-d1.sh` (that script `exec`s
  `workspace-cloud/scripts/test-d1-migrations.mjs` directly) — this is the
  isolated D1 test script required by root `CLAUDE.md`/`AGENTS.md` for any
  database-deployment change. It exercises this directory's migrations
  end-to-end against a disposable local `workerd` D1: fresh apply, an exact
  idempotent replay, rejection of a tampered migration hash, and refusal to
  silently adopt or reset an unrelated local database.
- `pnpm --dir workspace-cloud db:preflight` checks pending/applied state
  without writing anything.
- A local build or preflight pass alone is not deployment evidence; a real
  deployment still needs `pnpm workspace:cloud:verify-deployment <worker-version-id>`
  per root `AGENTS.md`.

### Common Patterns
- Every guard/invariant that Postgres previously enforced structurally (schema
  constraints, column-scoped `ON DELETE SET NULL`, type coercion) is
  reintroduced here as an explicit SQLite trigger with a comment naming the
  Postgres behavior it replicates, rather than assumed to hold implicitly.
- `--> statement-breakpoint` markers separate statements for drizzle-kit's D1
  migrator, which applies one statement per `d1 execute` call.

## Dependencies

### Internal
- `../drizzle.d1.config.ts` (schema source `../lib/d1/schema/index.ts`, `out` pointing here).
- `../lib/schema.ts`, `../lib/d1/schema/` (the live schema these migrations implement).
- `../wrangler.jsonc` (`WORKSPACE_DB` D1 binding, `migrations_dir: "d1-migrations"`).
- `../scripts/migrate-d1.mjs`, `../scripts/migrate-production.sh`, `../scripts/test-d1-migrations.mjs` (see `../scripts/AGENTS.md`).

### External
- `drizzle-kit` (SQLite/D1 dialect, migration generation).
- `wrangler` (`d1 migrations apply`, `d1 execute`) as the actual applier at runtime.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
