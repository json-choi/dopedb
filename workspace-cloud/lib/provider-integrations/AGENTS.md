<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/lib/provider-integrations

## Purpose
Provider integration authority and managed-credential lease lifecycle: who may act on one provider
integration right now, what a discovered resource is allowed to become, and how a short-lived
managed lease is issued, revoked, and cleaned up. `../provider-integrations.ts` re-exports this
directory's public surface as the stable import path for routes. Long-lived provider credentials
are opened only inside `integration.ts`/`integration-repository.ts` via `../secret-envelope.ts` and
are never returned to a client; a managed lease issued from here is per-member and short-lived, not
a saved or reusable credential.

## Key Files
| File | Description |
|------|-------------|
| `authority.ts` | Core `ProviderMutationAuthority` SQL: proves a live session, matching member/role, and the exact provider integration generation before any mutation. |
| `discovery-receipts.ts` | Atomic issuance/consumption bookkeeping for provider discovery receipts, kicking the background scheduler after writes. |
| `domain.ts` | Provider-neutral domain composition over the GCP Cloud SQL, Neon, and PlanetScale resource adapters (`import-projection.ts`, `neon-core.ts`, `gcp-cloud-sql-core.ts`, `planetscale.ts`). |
| `integration-repository.ts` | Reads one active provider integration row and checks GCP local-verification-target strictness. |
| `integration.ts` | Opens/reseals provider credentials for use, and drives PlanetScale credential-refresh claim/finalize/remote-start/reconnect flows. |
| `lease-cleanup.ts` | Bulk expired-lease cleanup and forced active-lease revocation for one integration. |
| `lease-issuance.ts` | Issues and revokes a PlanetScale-backed workspace credential lease, validating the target resource first. |
| `lease-revocation-window.ts` | Read-only preflight counting active leases and the earliest safe retry time before a mutation that cannot invalidate an already-issued live credential. |

## For AI Agents

### Working In This Directory
- Every mutation here binds to one exact `generation` counter read from `authority.ts`'s snapshot; a caller must re-read authority rather than reuse a stale generation across an await boundary.
- `integration.ts` is the only module in this directory that opens a decrypted provider credential; keep new secret-bearing logic there rather than spreading `../secret-envelope.ts` calls across other files.
- Before a provider mutation that cannot invalidate an already-issued lease, check `lease-revocation-window.ts` first, matching the existing PlanetScale and Neon call sites.
- New provider adapters plug into `domain.ts` alongside the existing GCP/Neon/PlanetScale composition rather than being called directly from routes.

### Testing Requirements
- `../d1-managed-lease-scenarios.harness.ts` and `../d1-integration-scenarios.harness.ts` exercise `lease-cleanup.ts`, `lease-issuance.ts`, and the disconnect/mutation stores against D1 (part of `pnpm test:contracts`).

### Common Patterns
- Every write pairs its `atomicD1` scope with `authority.ts`'s `providerMutationAuthoritySql`, so authorization and the durable consequence commit in the same D1 batch.

## Dependencies

### Internal
- `../d1/atomic.ts`, `../d1/database.ts`, `../d1/json.ts`, `../d1/schema/values.ts` for D1 persistence.
- `../secret-envelope.ts` for credential sealing/opening.
- `../providers/import-projection.ts`, `../providers/neon-core.ts`, `../providers/gcp-cloud-sql-core.ts`, `../providers/planetscale.ts`, `../providers/adapter-contract.ts` for provider-specific resource shapes.
- `../workspace-background-scheduler.ts` for post-write background wake-up.

### External
- `drizzle-orm` for query construction.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
