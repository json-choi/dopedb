<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/lib/providers

## Purpose
Per-provider adapters for GCP Cloud SQL, Neon, PlanetScale, and HashiCorp Vault: discovery,
read-only import, and (where supported) short-lived managed credential issuance, each narrowed
into the shared `adapter-contract.ts`/`provider-types.ts` allowlist before a result reaches storage
or a client. Setup and managed access must never create, upload, or persist a customer
service-account key (GCP uses Workload Identity Federation only) and must never rewrite a
pre-existing database user, role, or ACL — verified in `gcp-cloud-connection-policy.ts` and
`gcp-cloud-bootstrap-database.ts`. The Neon control-plane API role inherits `neon_superuser`
(`neon-core.ts`), so every managed lease creates its own constrained SQL role instead of reusing it.

## Key Files

### Shared Contracts
| File | Description |
|------|-------------|
| `adapter-contract.ts` | Provider-neutral import boundary: fingerprints and persists an already-narrowed resource; provider API responses and credentials never cross it. |
| `provider-types.ts` | Provider-neutral types for redacted resource discovery and one-time database leases (`ManagedEngine`, `ManagedAccessMode`, `ManagedSslMode`, `ProviderRequestError`). |
| `import-projection.ts` | Per-provider resource reconstruction into the shared redacted `ProviderImportProjection`; records only whether an admin may later enable the separately gated managed-write path. |

### GCP Cloud SQL
| File | Description |
|------|-------------|
| `gcp-cloud-bootstrap-application.ts` | Explicit Google setup: provisions the approved target and verifies runtime access without rewriting existing users or database ACLs. |
| `gcp-cloud-bootstrap-core.ts` | Idempotent Google Cloud bootstrap for one workspace/Cloud SQL instance; the returned durable config holds only WIF coordinates and service-account identities. |
| `gcp-cloud-bootstrap-database.ts` | Cloud SQL connection setup that preserves every existing database user and ACL. |
| `gcp-cloud-bootstrap-iam.ts` | Grants/verifies the temporary Workload Identity Federation IAM bindings used only during setup. |
| `gcp-cloud-bootstrap-journal.ts` | Persists a sealed, resumable bootstrap-recovery record (`providerSetupSession`) for manual review after an interrupted setup. |
| `gcp-cloud-bootstrap-recovery.ts` | Parses a prior interrupted setup record for manual review only; performs no role mutation. |
| `gcp-cloud-bootstrap.harness.ts` | Behavioral coverage of the Google response → setup readiness boundary using only synthetic identities and tokens. |
| `gcp-cloud-bootstrap.ts` | Stable facade re-exporting the GCP bootstrap application/core/IAM/journal/recovery functions and types. |
| `gcp-cloud-connection-policy.ts` | Non-destructive managed data access: grants PostgreSQL predefined roles without changing owners, ACLs, or default privileges; requires PostgreSQL 14+. |
| `gcp-cloud-managed-http.ts` | Bounded, retry-aware transport shared by Cloud SQL discovery and managed-credential issuance; callers own resource and authorization policy. |
| `gcp-cloud-oauth-callback.ts` | Routes the one shared OAuth callback URI to sign-in or Cloud SQL setup via a database-backed, one-use state, kept apart from ordinary sign-in states. |
| `gcp-cloud-oauth.ts` | Short-lived Google Cloud administrator authorization used only to discover and bootstrap keyless WIF; never requests or stores a refresh token. |
| `gcp-cloud-schema-authority.ts` | Exact Google IAM check for the dedicated Cloud SQL schema principal, performed by the read principal before a schema lease is issued. |
| `gcp-cloud-sql-core.ts` | Pure GCP Cloud SQL trust and resource validation; the integration stores only WIF coordinates and service-account identities, never a key. |
| `gcp-cloud-sql.ts` | GCP Cloud SQL adapter using workload identity and WIF; never creates, uploads, or persists a customer service-account key. |

### Neon
| File | Description |
|------|-------------|
| `neon-api.ts` | Neon control-plane adapter: discovers a project hierarchy from an encrypted API key and briefly obtains an owner session to create/revoke a constrained role. |
| `neon-bootstrap.ts` | Read-only Neon policy inspection and approval-gated, idempotent hardening; browsers receive only codes and redacted descriptions. |
| `neon-branch-api.ts` | Neon branch inventory, mutation, and reconciliation adapter. |
| `neon-branch-delete-plan.ts` | Runtime-neutral, secret-free plan for deleting one Neon branch; only a live, ready, DopeDB-owned leaf with no workspace authority may be planned, and execution always uses Neon's recoverable delete. |
| `neon-branch-inventory-api.ts` | Neon branch inventory discovery shared by branch mutation and managed access. |
| `neon-branch-mutation.ts` | Runtime-neutral allowlist for the secret-bearing Neon branch-create response; roles, passwords, connection URIs, and unknown fields are never projected out. |
| `neon-branch-operation-application.ts` | Feature-owned dispatcher for durable Neon branch operations; each use case owns its own plan → approval → execution/reconciliation sequence. |
| `neon-branch-operation-command.ts` | Exact command envelope accepted by the Neon branch-operation HTTP boundary, decoupling the application service from `Request`/response primitives. |
| `neon-branch-plan.ts` | Runtime-neutral, secret-free planning contract for one Neon branch create; durable storage and provider I/O stay server-only. |
| `neon-branch-switch-plan.ts` | Runtime-neutral, secret-free plan for moving one managed connection to another verified Neon branch; execution must revoke the old lease epoch before committing the new revision. |
| `neon-branches.ts` | Pure allowlist projection for Neon branch inventory shared by the API route and the critical regression suite. |
| `neon-core.ts` | Pure Neon validation, identity, and SQL construction; notes the control-plane API role inherits `neon_superuser`, so managed leases create constrained SQL roles instead. |
| `neon-identifiers.ts` | Runtime-neutral Neon resource identifier validation (`neonSegment`), free of Node/`server-only` imports for browser-side contract tests. |
| `neon-managed-access.ts` | Neon managed-access adapter: database boundary verification and short-lived role issuance. |
| `neon-role-policy.ts` | Runtime-neutral DopeDB role-naming policy for Neon (`neonLeaseRoleName`), free of Node/`server-only` imports. |
| `neon.ts` | Stable Neon facade re-exporting `neon-api.ts`, `neon-branch-api.ts`, and `neon-managed-access.ts`; control-plane API and database-role execution stay in separate adapters. |

### PlanetScale
| File | Description |
|------|-------------|
| `planetscale-core.ts` | Pure PlanetScale response normalization shared by the server adapter and tests; maps PlanetScale's `postgresql` kind to DopeDB's `postgres` engine id. |
| `planetscale.ts` | PlanetScale OAuth and database credential API adapter; narrows provider responses immediately so tokens/one-time passwords never enter logs or storage. |

### Vault
| File | Description |
|------|-------------|
| `vault-contracts.ts` | Vault credential and request shapes, including the maximum database lease duration. |
| `vault.ts` | Vault managed access: allowlisted broker boundary, AppRole login, short-lived database credential issuance, verification, and revocation. |

### Workload Identity
| File | Description |
|------|-------------|
| `workload-identity.harness.ts` | Verifies the service-binding/public-HTTP boundary and the exact production identity accepted for Google federation using ephemeral real signatures. |
| `workload-oidc.ts` | Verifies the fixed production workload token via RS256/JWKS against the configured identity Worker; issuer discovery cannot redirect to another origin, and client headers never supply this credential. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `neon-branch-operations/` | Durable Neon branch create/delete/switch use cases (plan → approve → execute → reconcile) plus their shared command context and read-side inventory. Covered inline below (no separate `AGENTS.md`). |

### `neon-branch-operations/` files
| File | Description |
|------|-------------|
| `contracts.ts` | Shared command context and transport-neutral result shapes for the durable Neon branch use cases; HTTP response construction stays in the route boundary. |
| `create.ts` | Plan, approval, remote-start fencing, and reconciliation for Neon branch creation, including recovery of a partially recorded credential fence. |
| `delete.ts` | Plan, approval, remote-start fencing, and reconciliation for deleting a DopeDB-owned Neon branch; preserves provider ambiguity for later recovery. |
| `inventory.ts` | Read-side projection for the durable Neon operation inventory; owns presentation flags derived from persisted operation and authority state. |
| `live-contexts.ts` | Fresh provider and workspace snapshots used to plan, approve, and execute Neon branch mutations; every caller revalidates against these exact shapes. |
| `switch.ts` | Plan, approval, execution, and atomic connection retargeting for Neon branch switches; the remote-start fence always precedes lease revocation and commit. |

## For AI Agents

### Working In This Directory
- A new or changed GCP setup path must keep passing `gcp-cloud-connection-policy.ts`'s and `gcp-cloud-bootstrap-database.ts`'s "no pre-existing user/ACL rewrite" guarantee; a service-account key must never be created, uploaded, or persisted.
- A new Neon managed-access path must create its own constrained SQL role rather than reuse the control-plane API's `neon_superuser`-inherited role (`neon-core.ts`).
- Keep "runtime-neutral" modules (`neon-identifiers.ts`, `neon-role-policy.ts`) free of Node and `server-only` imports so they keep running in browser-side contract tests.
- Every durable Neon branch operation follows plan → approve → remote-start fence → execute/reconcile; `neon-branch-operations/switch.ts` always revokes the old lease before committing the new connection revision — replicate this ordering for any new durable operation.
- `import-projection.ts` and `adapter-contract.ts` are the only place a provider's raw discovery response should be narrowed into the shared projection; do not project a provider response ad hoc elsewhere.

### Testing Requirements
- `gcp-cloud-bootstrap.harness.ts` and `workload-identity.harness.ts` are pulled in by `../control-plane-contracts.harness.ts`, one of the two `pnpm test:contracts` entry points.
- `../d1-switch-scenarios.harness.ts` and `../d1-operation-scenarios.harness.ts` exercise the Neon branch-operation lifecycle against D1 (`pnpm test:contracts`).
- `../provider-import-postgres-harness/provider-operation-scenarios.ts` exercises provider-operation authority against the isolated PostgreSQL fixture (`pnpm test:postgres-import`).

### Common Patterns
- Each provider splits into a `*-core.ts` (pure validation/identity, no `server-only`) and a stateful adapter (`server-only`, does the actual HTTP/DB work) — see `neon-core.ts`/`neon-api.ts` and `gcp-cloud-sql-core.ts`/`gcp-cloud-sql.ts`.
- A stable per-provider facade (`neon.ts`, `gcp-cloud-bootstrap.ts`) re-exports the internal modules a route actually needs.

## Dependencies

### Internal
- `../bounded-json-response.ts` for every provider HTTP call's response reading.
- `../provider-integrations/authority.ts` and `../provider-operation-store.ts` consume this directory's adapters from the operation lifecycle.
- `../workspace-server-log.ts` for redacted upstream-rejection logging (`gcp-cloud-bootstrap-core.ts`, `gcp-cloud-managed-http.ts`).
- `../secret-envelope.ts` for sealing setup-session and provider credentials.

### External
- `@neondatabase/serverless` for Neon SQL execution.
- `node:crypto` for hashing, HMAC, and RS256/JWKS verification (`workload-oidc.ts`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
