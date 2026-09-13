<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/drizzle

## Purpose
This directory holds a **historical PostgreSQL schema and its generated migration
history** for the workspace-cloud control plane. Every schema file under
`postgres-schema/` opens with `// Historical PostgreSQL migration/harness schema;
the application uses D1.` — the running Cloudflare Worker's control-plane state
lives in `../lib/d1/schema/` (SQLite, driven by `../drizzle.d1.config.ts`, migrated
via `pnpm db:generate` / `db:migrate` into `../d1-migrations/`), not here. This
Postgres schema and its two migrations are consumed only by a legacy/local
integration-test harness (`../lib/provider-import-postgres-harness/`, run through
`pnpm test:postgres-import`) and by `provider-credential-key-rotation.ts`, an
operator-only recovery utility. `../drizzle.config.ts` (`dialect: "postgresql"`,
`schema: "./drizzle/schema.postgres.ts"`, `out: "./drizzle"`) is the only
drizzle-kit config that targets this directory; no `package.json` script invokes
it directly (`db:generate`/`db:check` both point at `drizzle.d1.config.ts`
instead), so regenerating migrations here means running `drizzle-kit generate`
/ `drizzle-kit check` by hand with `--config=drizzle.config.ts`.

## Key Files
| File | Description |
|------|--------------|
| `schema.postgres.ts` | Barrel: re-exports every table module under `postgres-schema/` (20 files, import order shown in file). This is the `schema` drizzle-kit points at and what the Postgres test harness imports as `workspaceSchema`. |
| `0000_mvp_baseline.sql` | Generated migration 0: creates the `workspace_control` Postgres schema, the `pgcrypto` extension, and the initial 54 `CREATE TABLE` statements (Better Auth tables, connections, providers, knowledge/graph tables, leases, keys, operations, etc.). |
| `0001_article_sharing.sql` | Generated migration 1: adds `workspace_article_invitation` (private per-article invite, pinned to a connection id + revision, no query text or secret) and re-scopes the `workspace_connection_grant_capability` check constraint. |
| `provider-credential-key-rotation.ts` | Operator-only, transactional re-encryption of `workspace_provider_integration` / `provider_setup_session` credential envelopes to a new key. Never imported by the D1 Worker; exposes no HTTP route. Verified: locks the three provider tables, refuses to run if any `workspace_provider_operation` rows exist or provider setup sessions are live (it explicitly does not attempt operation-signing-key migration), requires a snapshot hash match before applying, re-encrypts and round-trip-verifies every row, then fences old runtimes out via a temporary CHECK constraint tied to the new key id. Imported by `../lib/provider-import-postgres-harness/credential-key-rotation-scenarios.ts`. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `meta/` | drizzle-kit bookkeeping for this schema: `_journal.json` lists 2 tracked migrations (`0000_mvp_baseline`, `0001_article_sharing`, both `dialect: "postgresql"`, `version: "7"`) and `0000_snapshot.json` / `0001_snapshot.json` are the full point-in-time schema snapshots drizzle-kit diffs against when generating the next migration. Do not hand-edit; regenerate via `drizzle-kit generate`. |
| `postgres-schema/` | One `workspaceControl.table(...)` module per domain area, all in the single Postgres schema `workspace_control` (defined in `namespace.ts`). See table below. |

**`postgres-schema/` files** (all tables live in the `workspace_control` Postgres schema):

| File | Tables | Description |
|------|--------|-------------|
| `namespace.ts` | — | Defines `export const workspaceControl = pgSchema("workspace_control")`, the schema object every other module builds its tables on. |
| `auth.ts` | `user`, `organization`, `session`, `account`, `verification`, `member`, `invitation`, `deviceCode`, `rateLimit` | Better Auth-shaped identity/org/session tables, grouped into an `authSchema` export. `member` carries a revocation-claim state machine (`revocationPendingAt`/`ClaimedAt`/`ClaimId`). |
| `connections.ts` | `workspaceConnection`, `workspaceConnectionGrant`, `workspaceProviderImportRequest` | `workspaceConnection` is a secretless connection template (host/port/db/sslmode, `credentialMode` `member_local`\|`managed`, content + row revision counters) — a check constraint enforces `member_local` connections stay `readonlyDefault=true, allowWrites=false`. `workspaceConnectionGrant` is a per-member capability grant (`view`\|`read`\|`use`\|`manage`). `workspaceProviderImportRequest` is an idempotency record for provider-resource imports. |
| `discovery.ts` | `workspaceProviderResource`, `workspaceProviderDiscoveryReceipt`, `workspaceProviderPrincipalClaim`, `providerOauthState`, `providerSetupSession` | Discovered-cloud-resource facts, single-use session-scoped discovery/OAuth receipts (SHA-256 hash only, never the raw state), and a global principal-fingerprint claim so one GCP service account can't be attached to two integrations concurrently. |
| `integrations.ts` | `workspaceProviderIntegration` | OAuth/service-account credential envelope with a bigint `generation` CAS token plus independent `refreshPhase` and `disconnectPhase` state machines (disconnect is modeled separately because provider-side revocation is irreversible even if local cleanup is retried). |
| `operations.ts` | `workspaceProviderOperation`, `workspaceProviderOperationApproval` | Durable, resumable Neon branch-operation workflow (`create`/`delete`/`switch`) with a redacted plan, `risk`-based approval policy (`production_data` forces `separate_admin`), a claim/remote-start/reconcile lifecycle, and exactly one terminal approval/rejection row per operation. |
| `leases.ts` | `workspaceCredentialLease` | Secret-free, per-member short-lived managed-credential lease and revocation/audit index; no token or password column. |
| `keys.ts` | `workspaceDataKey`, `workspaceDataKeyRotation`, `workspaceMetadataBackup` | KMS-wrapped workspace data-encryption keys (versioned, at most one active per org), a resumable claim-guarded rotation job, and encrypted metadata backups keyed either to the pre-DEK HKDF constant or to a specific `workspaceDataKey` version. |
| `projects.ts` | `knowledgeProject`, `knowledgeProjectEnvironment`, `knowledgeEnvironmentConnection` | Project/environment hierarchy (`riskClass`: production/staging/development/test/custom) and the join binding an environment to a `workspaceConnection` with a role/alias. |
| `sources.ts` | `knowledgeSource` | A GitHub repo+ref+commit pinned to a project environment; check constraints currently force `provider = 'github'` and `visibility = 'shared_graph'`. |
| `sync.ts` | `knowledgeSourceEvent`, `knowledgeSourceSyncJob` | Inbound GitHub webhook events and the claim-based indexing job state machine (`manifest`→`indexing`→`activating` phases, lease-based worker claims). |
| `code-index.ts` | `knowledgeCodeIndexFile`, `knowledgeCodeIndexActivationFragment`, `knowledgeCodeIndexActivationEntity` | Per-file code-index analysis state, batch progress fragments, and per-entity (`node`\|`edge`\|`evidence`) graph payloads produced by a sync job; entity rows enforce that `canonicalPayload` round-trips to the same JSON as `payload`. |
| `github.ts` | `knowledgeGithubInstallation`, `knowledgeGithubSetupState` | GitHub App installation records and single-use GitHub App setup state hashes. |
| `graphs.ts` | `knowledgeGraphRevision`, `knowledgeEnvironmentHead`, `knowledgeGrant`, `knowledgeGrantGraphRevision` | Immutable per-source knowledge-graph artifacts, the currently-active revision per environment+source, and expiring per-member grants pinning exactly which graph revisions a member may read. |
| `mappings.ts` | `knowledgeMappingProposal` | A proposed mapping from a graph node to a target identity, with `proposed`/`approved`/`rejected`/`stale` review state. |
| `analysis.ts` | `workspaceAnalysisRunner`, `workspaceAnalysisArticle`, `workspaceArticleInvitation`, `workspaceAnalysisArticleRevision` | See "Analysis Article shape" below. |
| `analysis-runs.ts` | `workspaceAnalysisArticleRun`, `workspaceAnalysisArticleQueryReceipt` | See below. |
| `publications.ts` | `workspaceAnalysisPublication` | See below. |
| `versions.ts` | `workspaceResourceVersion`, `workspaceResourceConflict`, `workspaceResourceConflictResolution` | Append-only optimistic-concurrency version log for `workspaceConnection` rows (`resourceType` is currently constrained to `'connection'`), plus conflict records and their append-only resolution decisions (`server`\|`candidate`\|`dismissed`). |
| `workspace.ts` | `workspaceDeletionReceipt`, `workspaceProfile`, `workspaceAuditEvent`, `workspaceSyncHead`, `workspaceSyncEvent` | Org lifecycle/deletion-grace-period bookkeeping, an audit-event log, and a gap-free per-org sequence (`workspaceSyncHead`) driving payload-free `workspaceSyncEvent` change notifications for desktop sync. |

### Analysis Article shape (verified against `docs/adr/0007-analysis-article-bi-domain.md`)

The ADR's description matches what these tables implement:
- `workspaceAnalysisArticle` is pinned to an exact `connectionId` + `connectionRevision`
  and an exact `projectEnvironmentId` + `environmentRevision`, and carries an
  integer `revision` counter — this is the "one exact read-only saved query pinned
  to a connection id + content revision" from the ADR. The article's title and
  sanitized HTML body are **not** separate columns; they live inside the
  `definition` `jsonb` blob (only checked to be a JSON object at the DB layer).
- `workspaceAnalysisArticleRevision` is the append-only immutable edit history the
  ADR calls for (`operation` constrained to `create`/`propose`/`update`/`delete`,
  each revision hashed and immutable once written).
- `workspaceAnalysisRunner` + `workspaceAnalysisArticleRun` +
  `workspaceAnalysisArticleQueryReceipt` implement the "authenticated Desktop
  manual rerun" and its receipts: a run is bound to one registered runner
  (device) and one article revision, and each query node's receipt records
  row/byte counts, duration, and a schema fingerprint hash — no result rows are
  stored.
- `workspaceAnalysisPublication` is the "optional immutable public HTML
  publication": a `snapshot` jsonb + `snapshotHash`, `visibility` restricted to
  `unlisted`/`public`, one active slug at a time (partial unique index on
  `slug` where not revoked), and version chaining via `replacesPublicationId` —
  unlike the article, this table does carry literal `title`/`description`
  columns alongside the snapshot.
- `workspaceArticleInvitation` (private sharing) is separate from
  `workspaceAnalysisPublication` (public sharing) and, per its own comment,
  "carries identity and resource pins, never query text or secrets."

## For AI Agents

### Working In This Directory
- This schema is legacy/historical, not the live control plane — confirm with
  `../lib/schema.ts` (`"Cloudflare D1 owns Workspace control-plane state.
  Historical PostgreSQL migration tooling uses drizzle/schema.postgres.ts
  explicitly."`) before assuming a change here affects the running Worker.
- To regenerate a migration after editing a `postgres-schema/*.ts` table, run
  `drizzle-kit generate --config=drizzle.config.ts` (or `check` to verify no
  pending diff) from `workspace-cloud/`; there is no shorter `pnpm` alias for
  this dialect. Do not hand-edit `meta/_journal.json` or the snapshot JSON files.
  This is the opposite of `pnpm db:generate`/`db:check`, which target the D1
  schema instead.
- Naming convention observed throughout: every table is
  `workspaceControl.table("snake_case_name", { camelCaseColumn: pgType("snake_case_column") ... }, (table) => [ ... constraints ])`.
  Cross-table foreign keys are almost always composite (`organizationId` +
  the referenced id) rather than a bare id reference, to keep every join
  tenant-scoped even when a UUID collision across orgs would otherwise be
  possible.
- Numeric identifiers that must survive a JS round-trip without precision loss
  (revision counters, generation/CAS tokens, sequences) use
  `bigint(..., { mode: "number" })` when they fit `Number.MAX_SAFE_INTEGER`
  (checked with an explicit `<= 9007199254740991` CHECK constraint) or
  `{ mode: "bigint" }` when they must not be coerced at all (e.g.
  `integrationGeneration`, GitHub `installationId`). There is no
  NUMERIC/MONEY column in this schema to which the root `CLAUDE.md`
  string-serialization rule would apply.
- Many tables carry a `revocationPendingAt`/`revocationClaimedAt`/
  `revocationClaimId` triple guarded by a CHECK constraint requiring all-or-
  nothing consistency (`member`, `workspaceConnection`,
  `workspaceProviderIntegration`) — follow that pattern for any new
  claim/lease-style row instead of inventing a new shape.

### Testing Requirements
- `pnpm test:contracts` (`vitest.contracts.config.ts`) runs only
  `lib/control-plane-contracts.harness.ts` and `lib/d1-storage.harness.ts` —
  verified by reading both files' imports: neither imports anything from this
  `drizzle/` directory; both exercise the D1 schema (`./d1/schema`). This
  suite does **not** cover the Postgres schema.
- `pnpm test:postgres-import` (`scripts/run-provider-import-postgres-harness.mjs`)
  is the suite that actually exercises this schema: it spawns
  `lib/provider-import-postgres.harness.ts`, which imports
  `lib/provider-import-postgres-harness/fixture.ts`, which does
  `import * as workspaceSchema from "../../drizzle/schema.postgres"` and opens
  a real `drizzle-orm/postgres-js` connection. It only runs against an
  explicitly provisioned, non-production database (guarded by
  `validateHarnessEnvironment`/`validateHarnessSourceTree` in
  `scripts/provider-import-postgres-harness-guard.mjs`, gated on
  `WORKSPACE_CLOUD_RUN_POSTGRES_IMPORT_HARNESS=1` plus
  `PROVIDER_IMPORT_TEST_DATABASE_URL`/`_SENTINEL`).
- `pnpm test:postgres-harness-guard`
  (`scripts/provider-import-postgres-harness-guard.node.mjs`) tests the guard
  script itself (source-tree/environment validation), not this schema's
  content.
- `lib/provider-import-postgres-harness/credential-key-rotation-scenarios.ts`
  is the only test file that imports `provider-credential-key-rotation.ts`
  directly; it runs as part of the same `test:postgres-import` harness.

### Common Patterns
- Every domain table module exports one or more `pgTable`-equivalent
  (`workspaceControl.table(...)`) constants plus, where a group of tables is
  semantically one unit, a plain object grouping them for import convenience
  (e.g. `authSchema` in `auth.ts`). No file exports a Zod schema or an
  inferred `$inferSelect`/`$inferInsert` type alias — consumers (the Postgres
  harness fixture) import the table objects directly and let `drizzle-orm`
  infer types at the call site.
- Regex-validated hash/identifier columns are the default way this schema
  enforces shape at the database layer instead of in application code, e.g.
  `sql`${table.definitionHash} ~ '^[0-9a-f]{64}$'`` for SHA-256 hex digests,
  or provider-specific identifier patterns (Neon resource ids, GCP project
  ids) on `workspaceProviderOperation`.

## Dependencies

### Internal
- `../lib/schema.ts` explicitly does **not** import this directory (it
  re-exports the D1 schema instead) but documents this directory's role.
- `../lib/provider-import-postgres-harness/fixture.ts` imports
  `schema.postgres.ts` as `workspaceSchema`.
- `../lib/provider-import-postgres-harness/credential-key-rotation-scenarios.ts`
  imports `provider-credential-key-rotation.ts`.
- `../drizzle.config.ts` points `schema`/`out` at this directory.

### External
- `drizzle-orm` `^0.45.2` (`drizzle-orm/pg-core` for schema definitions,
  `drizzle-orm/postgres-js` in the harness fixture).
- `drizzle-kit` `^0.31.10` (dev-only, generates/checks migrations here).
- `postgres` `3.4.9` (the `postgres-js` driver used by the harness fixture and
  typed as `postgres.Sql` in `provider-credential-key-rotation.ts`).
- `@neondatabase/serverless` `^1.1.0` is a workspace-cloud dependency for
  Neon/Postgres access elsewhere in the app, but no file in this directory
  imports it directly — the harness fixture uses `postgres`/`postgres-js`
  instead.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
