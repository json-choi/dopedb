<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/lib/d1

## Purpose
Cloudflare D1 (SQLite) access layer for the Workspace control plane: the Drizzle client, the
atomic-batch primitive every conditional mutation relies on, chunked encrypted-backup storage, an
in-D1 request-budget counter, and the full Drizzle table schema (`schema/`).
## Key Files
| File | Description |
|------|-------------|
| `atomic.ts` | Runs one D1 batch that materializes a validated authority/resource snapshot into a scratch row, then a mutation conditional on that exact row; the scratch row is deleted in the same batch. |
| `backup-chunks.ts` | Splits/rejoins ASCII AES-envelope ciphertext into bounded chunks so a manifest and every chunk commit atomically. |
| `database.ts` | `workspaceD1()`/`createWorkspaceD1()` bind the Cloudflare `WORKSPACE_DB`; the Drizzle instance is built with the SQLite sync dialect over the full `schema/` export. |
| `json.ts` | `jsonEqual` (order-independent JSON comparison via `json_tree`) and `inD1Strings` (bounded ID-list membership via `json_each`), both as raw `SQL`. |
| `member-authority.ts` | `workspaceMemberAuthority` — one `SELECT` proving a live session, matching membership, and allowed role, meant to be consumed inside the same statement/batch as the authorized write. |
| `rate-limits.ts` | `consumeD1Budget` — a bounded request-budget counter backed by a D1 table, validating all numeric inputs before querying. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `schema/` | Drizzle `sqliteTable` definitions for every Workspace and Knowledge table, re-exported through `schema/index.ts`. Covered inline below (no separate `AGENTS.md`). |

### `schema/` files
| File | Description |
|------|-------------|
| `index.ts` | Re-exports every schema module below; this is what `../schema.ts` and `database.ts` import as `* as schema`. |
| `auth.ts` | Better Auth tables — `user`, `organization`, `session`, `account`, `verification`, `member`, `invitation`, `rateLimit` — bundled as `authSchema` for the Better Auth D1 adapter. |
| `desktop-auth.ts` | `desktopAuthorizationCode`: 120-second hashed code bound to S256 challenge, literal loopback redirect, client and approving browser session; consumed rows retain the approval proof until its ten-minute lifetime ends. |
| `workspace.ts` | `workspaceDeletionReceipt`, `workspaceProfile`, `workspaceAuditEvent`, `workspaceSyncHead`, `workspaceSyncEvent` — workspace identity, the append-only audit log, and the sync cursor/event tables Desktop polls. |
| `integrations.ts` | `workspaceProviderIntegration` — one provider (Neon/PlanetScale/GCP Cloud SQL/Vault) connection's durable identity, status, and generation counter. |
| `operations.ts` | `workspaceProviderOperation`, `workspaceProviderOperationApproval` — durable plan/approve/execute/reconcile state for one provider-side mutation (e.g. a Neon branch switch). |
| `discovery.ts` | `workspaceProviderResource`, `workspaceProviderDiscoveryReceipt`, `workspaceProviderPrincipalClaim`, `providerOauthState`, `providerSetupSession` — discovered/redacted resources, discovery receipts, OAuth state, and setup-session records. |
| `connections.ts` | `workspaceConnection`, `workspaceConnectionGrant`, `workspaceProviderImportRequest` — the shared secretless connection template, per-member grant capabilities, and pending import requests. |
| `versions.ts` | `workspaceResourceVersion`, `workspaceResourceConflict`, `workspaceResourceConflictResolution` — append-only revision history and conflict tracking for a connection's secretless payload. |
| `keys.ts` | `workspaceDataKey`, `workspaceDataKeyRotation`, `workspaceMetadataBackup`, `workspaceBackupChunk` — data-encryption-key versions, rotation-job state, and chunked encrypted backup storage (ciphertext only). |
| `leases.ts` | `workspaceCredentialLease` — issued short-lived managed-credential leases, linked to their integration and connection. |
| `projects.ts` | `knowledgeProject`, `knowledgeProjectEnvironment`, `knowledgeEnvironmentConnection` — Project Knowledge's project/environment grouping and its link to a workspace connection. |
| `github.ts` | `knowledgeGithubInstallation`, `knowledgeGithubSetupState` — a Project's GitHub App installation identity and pending setup state. |
| `sources.ts` | `knowledgeSource` — one Project Knowledge source repository/environment binding. |
| `graphs.ts` | `knowledgeGraphRevision`, `knowledgeEnvironmentHead`, `knowledgeGrant`, `knowledgeGrantGraphRevision` — built knowledge-graph revisions, the active head per environment, and grant-to-revision links. |
| `mappings.ts` | `knowledgeMappingProposal` — proposed mappings between a graph revision and an environment, pending review. |
| `analysis.ts` | `workspaceAnalysisRunner`, `workspaceAnalysisArticle`, `workspaceArticleInvitation`, `workspaceAnalysisArticleRevision` — foreground Desktop runner registrations and Analysis Article definitions/history. |
| `analysis-runs.ts` | `workspaceAnalysisArticleRun`, `workspaceAnalysisArticleQueryReceipt` — one explicit Desktop-triggered Analysis run's authority receipt and query receipt (never result rows). |
| `publications.ts` | `workspaceAnalysisPublication` — immutable public Analysis Article HTML snapshot records. |
| `sync.ts` | `knowledgeSourceEvent`, `knowledgeSourceSyncJob` — ordered webhook/source-sync event log and job state used for exact-commit replay safety. |
| `code-index.ts` | `knowledgeCodeIndexFile`, `knowledgeCodeIndexActivationFragment`, `knowledgeCodeIndexActivationEntity` — per-file code-index entries and their activation fragments/entities. |
| `values.ts` | Shared Drizzle `customType`s: `utcDate` (ISO-8601 text column mapped to `Date`), `utcNow`, `uuidDefault`, `integerBigInt`. |
| `patterns.ts` | SQL `GLOB`/length column-constraint builders (`matches`, `safeRelativePath`) used by every table's `check()` constraints. |

## For AI Agents

### Working In This Directory
- Every schema file imports its cross-table references directly (e.g. `connections.ts` imports `workspaceProviderIntegration` from `./integrations`) rather than through `index.ts`, avoiding a circular barrel import.
- Column-level string/format constraints go through `patterns.ts` (`matches`, `safeRelativePath`) so allowed character sets stay declared once and enforced by SQLite `CHECK`, not just at the application layer.
- A mutation that must observe an authorization snapshot atomically composes `member-authority.ts`'s `workspaceMemberAuthority` SQL as the `scope` argument to `atomic.ts`'s `atomicD1`.
- `database.ts` is the only place that resolves the Cloudflare `WORKSPACE_DB` binding; other modules receive a `D1Database` or use `../db.ts`'s wrapped client.

### Testing Requirements
- `d1-storage.harness.ts` (one sibling directory up) is a Miniflare-backed vitest suite exercising `patterns.ts` and `atomic.ts` directly; it is one of the two entry points of `pnpm test:contracts` (`vitest.contracts.config.ts`).
- Every other `../d1-*-scenarios.harness.ts` file exercises this schema indirectly through the store modules in `../`.

### Common Patterns
- Every table declares `id` via `uuidDefault` and timestamps via `utcDate`/`utcNow` from `values.ts`, keeping revision comparisons lexically ordered.
- Tables that participate in optimistic concurrency (`workspaceConnection`, Analysis Article revisions) pair a `versions.ts`/`analysis.ts` history table with a mutable head row.

## Dependencies

### Internal
- `../workspace-permissions.ts` supplies the `WorkspaceRoleName` type used by `member-authority.ts`.
- Nearly every store module in `../` (e.g. `workspace-versioning-store.ts`, `provider-operation-records.ts`) reads/writes through `database.ts` and `atomic.ts`.

### External
- `drizzle-orm` and `drizzle-orm/sqlite-core` for table definitions and the SQL tag.
- `@cloudflare/workers-types` for the `D1Database`/`D1PreparedStatement` types.
- `@opennextjs/cloudflare` (`getCloudflareContext`) to resolve the D1 binding at runtime.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
