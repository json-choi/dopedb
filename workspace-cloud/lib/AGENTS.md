<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/lib

## Purpose
Server-only core of the DopeDB Workspace Cloud control plane (Cloudflare Workers + D1). It owns
workspace, membership, connection, grant, lease, provider-integration, Analysis Article, and backup
state; issues short-lived managed credentials; and defines the versioned HTTPS contracts an
independently deployed Desktop client decodes. It must never call a provider's API directly, never
expose a saved connection as an always-on MCP endpoint, and connecting/reconnecting/importing/
repairing/disconnecting must never rewrite a pre-existing application database user, role, grant,
default privilege, or ACL (see root `CLAUDE.md`/`AGENTS.md`).

## Key Files

### Auth & Session
| File | Description |
|------|-------------|
| `access.ts` | Better Auth access-control statement and workspace roles (adds a `view`-only `viewer` role on top of `memberAc`). |
| `auth-client.ts` | Client-side Better Auth instance (`multiSession`, `deviceAuthorization`, `organization` plugins). |
| `auth.ts` | Server Better Auth instance: D1 adapter, bearer/device/multi-session/organization plugins; strips provider tokens before persistence. |
| `authoritative-session.ts` | Session read that keeps browser-cookie and native-Bearer authentication mutually exclusive and observes durable revocation. |
| `cron-auth.ts` | Constant-time bearer authentication shared by every internal cron route. |
| `desktop-deep-link.ts` | Stable, token-free `dopedb://` deep-link targets and a short-lived Desktop access-return intent. |
| `device-session-policy.ts` | Filters device sessions to exclude the current one before a mass revoke. |
| `useDeviceAccounts.ts` | Client hook projecting the Better Auth multi-session list for device-account UI. |
| `workload-identity.ts` | Obtains a workload OIDC token from the Cloudflare Worker binding (never a client-supplied header). |

### Workspaces & Members
| File | Description |
|------|-------------|
| `invitation-email.ts` | Optional Resend email transport for Better Auth organization invitations. |
| `pending-invitations.ts` | Reconciles email-bound Better Auth invitations at the first authenticated workspace read. |
| `workspace-audit-id.ts` | Derives a stable UUIDv5-shaped id for one idempotent audit consequence. |
| `workspace-authorization.ts` | Server-side resource authorization; resolves session and membership from the database and fails closed. |
| `workspace-background-scheduler.ts` | Event-driven wake-up boundary that kicks durable background workspace work. |
| `workspace-lifecycle.ts` | Owner-only workspace deletion scheduling, cancellation, and retention-window status. |
| `workspace-locale-server.ts` | Server helper resolving the active `WorkspaceLocale` from request headers. |
| `workspace-locale.ts` | `en`/`ko` locale contract: header/cookie names and pathname helpers. |
| `workspace-member-store.ts` | Atomic member role-change mutation, including ownership-transfer rules. |
| `workspace-messages.ts` | i18n message catalog for the Workspace Web UI. |
| `workspace-permissions.ts` | Role name and capability enum definitions (`viewer`..`owner`; `view`/`read`/`write`/`manage`/`delete`). |
| `workspace-provider-copy.ts` | Localized (`ko`) copy for provider error messages, keyed by the English source string. |
| `workspace-retention-purge.ts` | Final atomic workspace purge query and the deletion-unblocked precondition guard. |
| `workspace-server-log.ts` | The only application server log sink; every event has a closed categorical shape (no bodies, identifiers, SQL, credentials, or `Error` objects). |

### Connections, Grants & Leases
| File | Description |
|------|-------------|
| `connection-conflict-decision.ts` | Pure function deciding whether a version conflict keeps the current revision or applies a candidate. |
| `provider-catalog.ts` | Public catalog of provider adapters cleared for discovery/import/managed issuance (`gcpCloudSql`, `neon`, `planetScale`, `vault`). |
| `provider-credential-envelope.ts` | Seals/opens provider credentials with a key-id fingerprint so key rotation can fence old ciphertexts. |
| `provider-discovery-proof.ts` | Issues/verifies an opaque, short-lived proof binding a browser-returned resource selection to server-sealed selectors. |
| `provider-discovery-receipt-store.ts` | Scheduled bounded cleanup of consumed/expired provider discovery receipts. |
| `provider-import-store.ts` | Validates and consumes a discovery receipt and creates the resulting connection in one D1 transaction. |
| `provider-integration-disconnect-store.ts` | Finalizes a provider integration disconnect (credential scrub + lease revocation count) atomically. |
| `provider-integration-mutation-store.ts` | Sole durable create/reconnect boundary for provider integrations, conditional on one locked authorization snapshot. |
| `provider-integrations.ts` | Public barrel re-exporting the `provider-integrations/` authority, discovery-receipts, domain, integration, and lease submodules. |
| `provider-local-authority.ts` | Read-only redacted integration projection used only by the device-local provider binding route. |
| `provider-local-target.ts` | Read-only tenant-scoped authority for a desktop-local provider credential import target. |
| `provider-operation-authority.ts` | Authority-verification queries shared by the provider-operation lifecycle modules. |
| `provider-operation-bootstrap.ts` | Bootstrap step of the provider-operation plan/approve/execute lifecycle. |
| `provider-operation-execution.ts` | Claims, starts, and cancels remote execution of a provider operation. |
| `provider-operation-managed-access.ts` | Provider-operation queries specific to managed-access mode changes. |
| `provider-operation-marker.ts` | HMAC-based ownership marker proving a provider operation is still owned by its original planner. |
| `provider-operation-plan.ts` | Records and decides (approve/reject) a provider-operation plan. |
| `provider-operation-reconciliation.ts` | Applies the reconciliation outcome after a provider operation's remote execution finishes. |
| `provider-operation-records.ts` | Durable provider-operation planning boundary; every insert/replay is conditional on one member/session/integration snapshot. |
| `provider-operation-store.ts` | Stable facade re-exporting the `provider-operation-*` persistence modules. |
| `provider-operation-switch.ts` | Completes a Neon branch switch by atomically retargeting the connection and revoking the old lease epoch. |
| `provider-provisioning-target.ts` | Ephemeral, secret-free authority for one saved managed connection; every mutation and lease re-authorizes it independently. |
| `revocation-gates.ts` | Durable, UUID-owned authorization-mutation claim gates guarding grant/lease/connection changes. |
| `workspace-connections.ts` | Strict parser and public serializer for shared connection templates; rejects (rather than silently drops) secret-bearing fields. |
| `workspace-grant-store.ts` | Mutates connection-grant capabilities (`view`/`read`/`use`/`manage`) for a member. |
| `workspace-managed-mode-store.ts` | Disables workspace managed access and revokes its leases atomically. |
| `workspace-snapshot-restore.ts` | Atomically restores a secretless connection template from a backup snapshot; existing identities surface as reviewable conflicts. |
| `workspace-versioning-store.ts` | Append-only persistence for connection versions plus conflict list/resolve operations. |
| `workspace-versioning.ts` | Canonical, secret-free connection version payload shape and strict optimistic-revision parsing (no DB access). |

### Analysis Articles
| File | Description |
|------|-------------|
| `public-analysis-publication.ts` | One integrity-checked, rate-limited read path for public Analysis Article snapshots. |
| `workspace-analysis-article-contracts.ts` | Current credential-free Analysis Article wire contract (sources, column types). |
| `workspace-analysis-article-http.ts` | Tenant-scoped Analysis Article read projections shared by API routes. |
| `workspace-analysis-article-store.ts` | Atomic persistence for Analysis Article definitions, bound to one Environment revision and one connection revision. |
| `workspace-analysis-articles.ts` | Parses/validates a shared Analysis Article create request and produces its sanitized public shape. |
| `workspace-analysis-column-parser.ts` | Parses and validates Analysis Article result-column metadata (type/role/sensitivity/masking). |
| `workspace-analysis-html.ts` | `sanitize-html` allowlist for Analysis Article body HTML, including a constrained SVG subset. |
| `workspace-analysis-publication-store.ts` | Approval-gated persistence for fixed public Analysis Article snapshots. |
| `workspace-analysis-publications.ts` | Immutable public HTML snapshot shape; deliberately excludes SQL, connection identity, result rows, and any rerun command. |
| `workspace-analysis-run-store.ts` | Atomic persistence for explicit Desktop-run Analysis Articles; stores authority receipts only, never result rows. |
| `workspace-analysis-runner-capability.ts` | Issues/hashes the exact-possession capability proving a foreground Desktop runner registration. |
| `workspace-analysis-runner-store.ts` | Possession-bound registration for member-owned, foreground-only Desktop Analysis runners. |
| `workspace-analysis-runs.ts` | Runtime-neutral validation for one explicit Desktop-triggered Analysis run request. |
| `workspace-analysis-validation.ts` | Shared low-level validation primitives (exact-key records, unsafe-display character checks) for Analysis input. |

### Backups & Encryption
| File | Description |
|------|-------------|
| `secret-envelope-core.ts` | Small AES-256-GCM envelope primitive binding ciphertext to a record id via authenticated additional data. |
| `secret-envelope.ts` | Server-only wrapper that separates the encryption key from database ciphertext. |
| `workspace-backup-core.ts` | Canonical workspace metadata snapshot shape; excludes provider grants, target credentials, and result rows. |
| `workspace-backup-store.ts` | Atomic backup insert/tombstone persistence over chunked envelope storage. |
| `workspace-backup.ts` | Server-only workspace snapshot encryption; plaintext exists only between a DB read and an envelope/restore operation. |
| `workspace-data-key-rotation.ts` | Owner-approved, resumable workspace data-encryption-key rotation with safe-retry batching. |
| `workspace-data-key.ts` | Durable per-workspace data-encryption-key versions; plaintext key material is request-local and zeroized. |
| `workspace-kms-core.ts` | Pure validation regexes/types for Cloud KMS key names, versions, and Workload Identity Federation audience. |
| `workspace-kms.ts` | Cloud KMS envelope boundary authenticated only via the production workload OIDC token and WIF. |

### Product Analytics
| File | Description |
|------|-------------|
| `clarity-plugin.ts` | Microsoft Clarity `WebAnalyticsPlugin` adapter (start/stop/track). |
| `product-analytics-binding.ts` | Forwards requests to the production-only `PRODUCT_ANALYTICS` Cloudflare Worker binding; the sink has no public route. |
| `product-analytics.ts` | Strict product-outcome event validation and the optional Cloudflare analytics sink; never persists raw analytics. |
| `web-analytics.ts` | Browser analytics event contract and plugin fan-out; only reviewed enums are accepted, no arbitrary properties or identifiers. |

### HTTP, Errors & Validation
| File | Description |
|------|-------------|
| `bounded-json-response.ts` | Provider-neutral bounded JSON response reader; never trusts `Content-Length` or echoes an upstream body in errors. |
| `env.ts` | Lazy server-only environment variable access; fails closed in request handlers, lets static pages build without secrets. |
| `http.ts` | `privateJson`/`privateResponse` helpers that force `cache-control: private, no-store`. |
| `rate-limit.ts` | Shared bounded request-budget storage (D1-backed) for public and authenticated routes. |

### Core & Wire Contracts
| File | Description |
|------|-------------|
| `control-plane-contracts.ts` | Versioned public HTTPS envelope types shared with Desktop, decoded identically by an independently deployed Rust client. |
| `db.ts` | Proxy over the Drizzle D1 client exposing a raw-SQL `execute`; multi-statement mutations use `atomicD1`, never callback transactions. |
| `schema.ts` | Re-exports `./d1/schema`; historical PostgreSQL migration tooling uses `drizzle/schema.postgres.ts` explicitly instead. |

### Tests & Contract Harnesses
| File | Description |
|------|-------------|
| `control-plane-contracts.harness.ts` | Decodes the versioned control-plane fixture and composes the GCP-bootstrap, workload-identity, and site-analytics contract checks; a `test:contracts` entry point. |
| `d1-analysis-run-scenarios.harness.ts` | Verifies Analysis Article runner registration/revocation and run create/cancel/complete against a live D1 instance. |
| `d1-analysis-scenarios.harness.ts` | Verifies Analysis Article create/mutate/delete, composing the runner and run scenario helpers. |
| `d1-backup-scenarios.harness.ts` | Verifies workspace DEK rotation and encrypted backup insert/tombstone against D1, mocking the KMS API. |
| `d1-integration-scenarios.harness.ts` | Verifies provider integration disconnect and mutation-store finalize paths against D1. |
| `d1-lifecycle-scenarios.harness.ts` | Verifies workspace deletion scheduling, cancellation, and retention purge against D1. |
| `d1-managed-lease-scenarios.harness.ts` | Verifies managed credential lease reservation/finalization/cleanup and revocation-gate claim/renew/release against D1. |
| `d1-operation-scenarios.harness.ts` | Verifies provider-operation plan/decide/claim/start/cancel, composing the branch-switch scenarios. |
| `d1-permission-scenarios.harness.ts` | Verifies connection grant increase/removal, member role change, and managed-access disable against D1. |
| `d1-route-scenarios.harness.ts` | Exercises the knowledge environment-connection bind route and workspace sync route handlers directly. |
| `d1-runner-scenarios.harness.ts` | Verifies Analysis runner register/revoke/cleanup-after-member-removal against D1. |
| `d1-storage.harness.ts` | Miniflare-backed vitest suite for D1 schema patterns and `atomicD1` batch semantics; the second `test:contracts` entry point. |
| `d1-switch-scenarios.harness.ts` | Verifies the Neon branch-switch provider-operation plan/execute/complete path against D1. |
| `d1-versioning-scenarios.harness.ts` | Verifies connection version create/mutate/conflict/resolve and snapshot restore against D1, using revocation gates. |
| `d1-workspace-scenarios.harness.ts` | Top-level D1 scenario composer that runs the permission, operation, retention, and backup scenario suites together. |
| `provider-import-postgres.harness.ts` | Vitest entry composing the isolated-PostgreSQL scenario suite in `provider-import-postgres-harness/`. |
| `site-analytics.harness.ts` | Asserts the public website analytics wire contract admits no customer identifiers or arbitrary properties. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `d1/` | D1 (Cloudflare SQLite) client, `atomicD1` batch helper, and the full Drizzle schema (see `d1/AGENTS.md`). |
| `knowledge/` | Project Knowledge: GitHub App source browsing, source/graph inventory, personal-workspace scope (see `knowledge/AGENTS.md`). |
| `provider-import-postgres-harness/` | Isolated-PostgreSQL scenario suite for the historical migration path, run via `test:postgres-import` (see `provider-import-postgres-harness/AGENTS.md`). |
| `provider-integrations/` | Provider integration authority, discovery receipts, and managed-credential lease issuance/cleanup (see `provider-integrations/AGENTS.md`). |
| `providers/` | Per-provider adapters: GCP Cloud SQL, Neon, PlanetScale, Vault (see `providers/AGENTS.md`). |

## For AI Agents

### Working In This Directory
- Connect/reconnect/import/repair/disconnect code must never change a pre-existing application user, role, grant, default privilege, or ACL. This is verified in code: `providers/gcp-cloud-connection-policy.ts` and `providers/gcp-cloud-bootstrap-database.ts` grant predefined roles without touching existing owners or ACLs, and `providers/neon-core.ts` notes the control-plane API role inherits `neon_superuser`, so managed leases create a separate constrained SQL role instead of reusing it.
- Modules imported by a Client Component (`auth-client.ts`, `useDeviceAccounts.ts`) must stay free of `"server-only"` imports and of secret-bearing logic.
- A mutation that must be atomic with its authorization check uses `atomicD1` (`d1/atomic.ts`) with a `scope` SQL selecting at most one `payload` row, not a callback transaction.
- Long-lived secrets are sealed with `secret-envelope.ts` / `provider-credential-envelope.ts` before persistence and are never returned from a route; `workspace-server-log.ts` enforces the same exclusion for log lines.
- Provider adapters narrow arbitrary upstream JSON into an allowlisted shape (`providers/adapter-contract.ts`, `providers/provider-types.ts`) before it reaches storage or a client response.
- "Runtime-neutral" modules (e.g. `workspace-versioning.ts`, `providers/neon-identifiers.ts`) avoid Node and `server-only` imports so the same code executes inside browser-side contract tests.

### Testing Requirements
- `pnpm test:contracts` (vitest, `vitest.contracts.config.ts`) runs `control-plane-contracts.harness.ts` and `d1-storage.harness.ts`; the former transitively pulls in every `d1-*-scenarios.harness.ts`, the GCP/workload-identity harnesses, and `site-analytics.harness.ts`.
- `pnpm test:postgres-import` (`scripts/run-provider-import-postgres-harness.mjs`) runs the isolated PostgreSQL scenario suite in `provider-import-postgres-harness/`, gated by the source/environment safety checks in `pnpm test:postgres-harness-guard`.
- `pnpm test:d1-import` (`scripts/test-d1-migrations.mjs`) exercises the D1 migration entry point.
- New tests here count against the repository's 208-test budget only when they add new `it`/`test` cases; see root `tests/critical-test-budget.json`.

### Common Patterns
- A facade module re-exports a cohesive group of internal modules under one stable import path, e.g. `provider-operation-store.ts` and `provider-integrations.ts`.
- Every durable mutation pairs its state change with an audit-event insert in the same atomic batch (see `workspace-versioning-store.ts`, `provider-operation-records.ts`).
- Scenario harnesses under `d1-*-scenarios.harness.ts` are plain async functions taking a `D1Database` and authority fixture, composed by `d1-workspace-scenarios.harness.ts` rather than each declaring its own `describe`/`it`.

## Dependencies

### Internal
- `../app/api/**` route handlers are the primary callers of this directory's server-only modules.
- `../drizzle/schema.postgres.ts` and `../drizzle/provider-credential-key-rotation.ts` back the historical PostgreSQL harness only.
- `../../site/lib/analytics` shares the `web-analytics.ts` contract, verified by `site-analytics.harness.ts`.

### External
- `better-auth` and `@better-auth/drizzle-adapter` for identity, session, organization, and device authorization.
- `drizzle-orm` (`drizzle-orm/d1`, `drizzle-orm/sqlite-core`) for the D1 schema and queries.
- `@neondatabase/serverless`, `sanitize-html`, `@microsoft/clarity`, `@cloudflare/workers-types`.
- `vitest` and `miniflare` for the contract/scenario harnesses.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
