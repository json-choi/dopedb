// The only durable create/reconnect boundary for provider integrations. Provider
// discovery and OAuth happen before this function; every durable consequence is
// conditional on one final, locked authorization snapshot.
import "server-only";

import { sql } from "drizzle-orm";
import { queryD1 } from "./d1/database";
import { atomicD1 } from "./d1/atomic";
import {
  providerMutationAuthoritySql,
  type ProviderMutationAuthority,
} from "./provider-integrations/authority";
import { workspaceProviderIntegration } from "./d1/schema";

export type ProviderIntegrationGeneration = {
  id: string;
  status: string;
  revokedAt: Date | null;
  revocationPendingAt: Date | null;
  generation: bigint;
};

export type ProviderPrincipalClaim = {
  principalFingerprint: string;
  targetFingerprint: string;
  accessKind: "read" | "write" | "schema";
};

/**
 * The only durable local-verification projection. It is provider-neutral JSON
 * but currently has one narrow GCP shape, written with the credential mutation
 * so its generation is an exact authority pin rather than a later read guess.
 */
export type LocalVerificationTarget = Readonly<{
  kind: "gcpCloudSql";
  projectId: string;
  instanceId: string;
}>;

export type PersistProviderIntegrationInput = {
  authority: ProviderMutationAuthority;
  integrationId: string;
  provider: "neon" | "gcpCloudSql" | "planetScale" | "vault";
  externalAccountId: string;
  displayName: string;
  encryptedCredential: string;
  credentialExpiresAt: Date | null;
  grantedScope: string;
  localVerificationTarget: LocalVerificationTarget | null;
  now: Date;
  requestId: string;
  revokedLeases: number;
  existing?: ProviderIntegrationGeneration;
  reconnectClaimId?: string;
  principalClaims: ProviderPrincipalClaim[];
  production: boolean | null;
};

function validLocalVerificationTarget(
  provider: PersistProviderIntegrationInput["provider"],
  target: LocalVerificationTarget | null,
) {
  if (provider !== "gcpCloudSql") return target === null;
  return target !== null
    && Object.keys(target).length === 3
    && Object.hasOwn(target, "kind")
    && Object.hasOwn(target, "projectId")
    && Object.hasOwn(target, "instanceId")
    && target.kind === "gcpCloudSql"
    && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(target.projectId)
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,97}$/.test(target.instanceId);
}

export type PersistProviderIntegrationResult =
  | { ok: true; id: string }
  | { ok: false };

function expectedGeneration(input: PersistProviderIntegrationInput) {
  const existing = input.existing;
  if (!existing) return sql``;
  if (input.reconnectClaimId) {
    return sql`
      AND integration."status" IN ('active', 'reconnect_required')
      AND integration."revoked_at" IS NULL
      AND integration."revocation_pending_at" IS NOT NULL
      AND integration."revocation_claim_id" = ${input.reconnectClaimId}`;
  }
  return sql`
    AND integration."status" = ${existing.status}
    AND integration."generation" = ${existing.generation}
    AND integration."revocation_pending_at" IS NULL
    ${existing.revokedAt
      ? sql`AND integration."revoked_at" = ${existing.revokedAt}`
      : sql`AND integration."revoked_at" IS NULL`}`;
}

// Every claim, connection revision and audit consumes the same atomic authority snapshot.
export async function persistProviderIntegration(
  input: PersistProviderIntegrationInput,
): Promise<PersistProviderIntegrationResult> {
  if (!validLocalVerificationTarget(input.provider, input.localVerificationTarget)) {
    return { ok: false };
  }
  // JSON `null` is not SQL NULL. The schema constraint deliberately treats
  // provider-neutral targets as absent for Neon and PlanetScale, so preserve
  // that distinction at the sole durable mutation boundary.
  const localVerificationTarget = input.localVerificationTarget === null
    ? sql`NULL`
    : sql`${JSON.stringify(input.localVerificationTarget)}`;
  const authority = providerMutationAuthoritySql({
    ...input.authority,
    requireManager: true,
    ...(input.existing ? {
      integration: {
        id: input.integrationId,
        provider: input.provider,
        generation: input.existing.generation,
        claimId: input.reconnectClaimId ?? null,
      },
    } : {}),
  });
  const existingGuard = input.existing ? sql`AND EXISTS (
      SELECT 1 FROM workspace_provider_integration integration
      WHERE integration.id = ${input.integrationId} AND integration.organization_id = ${input.authority.organizationId}
        ${expectedGeneration(input)})` : sql``;
  const claims = sql`SELECT value ->> 'principalFingerprint' AS principal_fingerprint,
    value ->> 'targetFingerprint' AS target_fingerprint, value ->> 'accessKind' AS access_kind
    FROM json_each(${JSON.stringify(input.principalClaims)})`;
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload WHERE ${authority} ${existingGuard}`,
    statements: (scope) => [
      input.existing ? sql`UPDATE workspace_provider_integration SET status = 'active',
          external_account_id = ${input.externalAccountId}, display_name = ${input.displayName},
          encrypted_credential = ${input.encryptedCredential}, credential_expires_at = ${input.credentialExpiresAt},
          granted_scope = ${input.grantedScope}, local_verification_target = ${localVerificationTarget},
          revoked_at = NULL, revocation_pending_at = NULL, revocation_claimed_at = NULL, revocation_claim_id = NULL,
          refresh_phase = 'idle', refresh_claimed_at = NULL, refresh_claim_id = NULL,
          refresh_generation = NULL, refresh_remote_started_at = NULL, disconnect_phase = 'idle',
          disconnect_generation = NULL, generation = generation + 1, updated_at = ${input.now}
        WHERE id = ${input.integrationId} AND EXISTS (${scope}) RETURNING id`
      : sql`INSERT INTO workspace_provider_integration (id, organization_id, provider, external_account_id,
          display_name, encrypted_credential, credential_expires_at, granted_scope, local_verification_target,
          created_by_user_id, updated_at)
        SELECT ${input.integrationId}, ${input.authority.organizationId}, ${input.provider}, ${input.externalAccountId},
          ${input.displayName}, ${input.encryptedCredential}, ${input.credentialExpiresAt}, ${input.grantedScope},
          ${localVerificationTarget}, ${input.authority.userId}, ${input.now} FROM (${scope}) RETURNING id`,
      sql`INSERT INTO workspace_provider_principal_claim (principal_fingerprint, organization_id, integration_id,
          target_fingerprint, access_kind, created_at, updated_at)
        SELECT desired.principal_fingerprint, ${input.authority.organizationId}, ${input.integrationId},
          desired.target_fingerprint, desired.access_kind, ${input.now}, ${input.now}
        FROM (${claims}) desired CROSS JOIN (${scope}) WHERE TRUE
        ON CONFLICT (integration_id, access_kind) DO UPDATE SET principal_fingerprint = excluded.principal_fingerprint,
          target_fingerprint = excluded.target_fingerprint, updated_at = excluded.updated_at`,
      sql`DELETE FROM workspace_provider_principal_claim WHERE integration_id = ${input.integrationId}
        AND ${input.principalClaims.length} > 0 AND EXISTS (${scope})
        AND access_kind NOT IN (SELECT access_kind FROM (${claims}))`,
      sql`UPDATE workspace_connection SET revision = revision + 1, updated_at = ${input.now}
        WHERE organization_id = ${input.authority.organizationId} AND provider_integration_id = ${input.integrationId}
          AND deleted_at IS NULL AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${input.authority.organizationId}, ${input.authority.userId}, 'provider.connect', 'provider_integration',
          ${input.integrationId}, ${JSON.stringify({ provider: input.provider, revokedLeases: input.revokedLeases,
            production: input.production, productionApproved: input.production === true })}, ${input.requestId} FROM (${scope})`,
    ],
  });
  const id = result.rows[0]?.[0]?.id;
  return typeof id === "string" ? { ok: true, id } : { ok: false };
}

/**
 * Acquire the pre-I/O refresh claim. Only `claimed` can be recovered after five
 * minutes; no worker may steal a `remote_started` refresh because PlanetScale
 * does not provide an idempotency or fencing key for token rotation.
 */
export async function claimPlanetScaleCredentialRefresh(input: {
  authority: ProviderMutationAuthority;
  integrationId: string;
  generation: bigint;
  now: Date;
  claimId: string;
}): Promise<boolean> {
  const result = await queryD1<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "refresh_claim_id" = ${input.claimId},
        "refresh_claimed_at" = ${input.now},
        "refresh_generation" = ${input.generation},
        "refresh_phase" = 'claimed',
        "refresh_remote_started_at" = NULL
    WHERE integration."id" = ${input.integrationId}
      AND integration."provider" = 'planetScale'
      AND integration."generation" = ${input.generation}
      AND integration."status" = 'active'
      AND integration."revoked_at" IS NULL
      AND integration."revocation_pending_at" IS NULL
      AND integration."revocation_claim_id" IS NULL
      AND (integration."refresh_phase" = 'idle'
        OR (integration."refresh_phase" = 'claimed'
          AND integration."refresh_claimed_at" < strftime('%Y-%m-%dT%H:%M:%fZ', ${input.now}, '-5 minutes')))
      AND ${providerMutationAuthoritySql({
        ...input.authority,
        requireManager: true,
        integration: { id: input.integrationId, provider: "planetScale", generation: input.generation, claimId: null },
      })}
    RETURNING "id"
  `);
  return result.length === 1;
}

/** Write the external-I/O fence in its own transaction before contacting OAuth. */
export async function markPlanetScaleCredentialRefreshRemoteStarted(input: {
  integrationId: string; generation: bigint; claimId: string; now: Date;
}): Promise<boolean> {
  const result = await queryD1<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "status" = 'reconnect_required',
        "refresh_phase" = 'remote_started',
        "refresh_remote_started_at" = ${input.now}
    WHERE integration."id" = ${input.integrationId}
      AND integration."provider" = 'planetScale'
      AND integration."generation" = ${input.generation}
      AND integration."refresh_generation" = ${input.generation}
      AND integration."refresh_claim_id" = ${input.claimId}
      AND integration."refresh_phase" = 'claimed'
      AND integration."status" = 'active'
      AND integration."revoked_at" IS NULL
      AND integration."revocation_pending_at" IS NULL
      AND integration."revocation_claim_id" IS NULL
    RETURNING "id"
  `);
  return result.length === 1;
}

/** Finalize only the exact remote-started generation/claim. */
export async function finalizePlanetScaleCredentialRefresh(input: {
  authority: ProviderMutationAuthority;
  integrationId: string;
  generation: bigint;
  claimId: string;
  encryptedCredential: string;
  credentialExpiresAt: Date;
  grantedScope: string;
  now: Date;
}): Promise<boolean> {
  const result = await queryD1<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "status" = 'active',
        "encrypted_credential" = ${input.encryptedCredential},
        "credential_expires_at" = ${input.credentialExpiresAt},
        "granted_scope" = ${input.grantedScope},
        "generation" = integration."generation" + 1,
        "updated_at" = ${input.now},
        "refresh_claimed_at" = NULL,
        "refresh_claim_id" = NULL,
        "refresh_generation" = NULL,
        "refresh_phase" = 'idle',
        "refresh_remote_started_at" = NULL
    WHERE integration."id" = ${input.integrationId}
      AND integration."provider" = 'planetScale'
      AND integration."generation" = ${input.generation}
      AND integration."refresh_generation" = ${input.generation}
      AND integration."refresh_claim_id" = ${input.claimId}
      AND integration."refresh_phase" = 'remote_started'
      AND integration."status" = 'reconnect_required'
      AND integration."revoked_at" IS NULL
      AND integration."revocation_pending_at" IS NULL
      AND integration."revocation_claim_id" IS NULL
      AND ${providerMutationAuthoritySql({
        ...input.authority,
        requireManager: true,
        integration: {
          id: input.integrationId,
          provider: "planetScale",
          generation: input.generation,
          claimId: null,
        },
      })}
    RETURNING "id"
  `);
  return result.length === 1;
}

/** A post-I/O failure is ambiguous and can only be repaired by explicit OAuth reconnect. */
export async function requirePlanetScaleCredentialReconnect(input: {
  integrationId: string; generation: bigint; claimId: string; now: Date;
}): Promise<boolean> {
  const result = await queryD1<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "status" = 'reconnect_required',
        "refresh_phase" = 'reconnect_required',
        "refresh_remote_started_at" = COALESCE(integration."refresh_remote_started_at", ${input.now}),
        "updated_at" = ${input.now}
    WHERE integration."id" = ${input.integrationId}
      AND integration."provider" = 'planetScale'
      AND integration."generation" = ${input.generation}
      AND integration."refresh_generation" = ${input.generation}
      AND integration."refresh_claim_id" = ${input.claimId}
      AND integration."refresh_phase" IN ('remote_started', 'reconnect_required')
      AND integration."revoked_at" IS NULL
    RETURNING "id"
  `);
  return result.length === 1;
}

/** Disconnect starts non-issuable and keeps its generation/claim as the fence. */
export async function claimProviderIntegrationDisconnect(input: {
  authority: ProviderMutationAuthority;
  integrationId: string;
  claimId: string;
  now: Date;
}): Promise<{ provider: string; generation: bigint } | null> {
  const result = await queryD1<{ provider: string; generation: number }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "revocation_pending_at" = ${input.now},
        "revocation_claimed_at" = ${input.now},
        "revocation_claim_id" = ${input.claimId},
        "disconnect_phase" = 'claimed',
        "disconnect_generation" = integration."generation"
    WHERE integration."id" = ${input.integrationId}
      AND integration."organization_id" = ${input.authority.organizationId}
      AND integration."status" IN ('active', 'reconnect_required')
      AND integration."revoked_at" IS NULL
      AND integration."revocation_pending_at" IS NULL
      AND integration."revocation_claim_id" IS NULL
      AND integration."refresh_phase" IN ('idle', 'reconnect_required')
      AND integration."disconnect_phase" = 'idle'
      AND ${providerMutationAuthoritySql({ ...input.authority })}
    RETURNING "provider", "generation"
  `);
  return result[0] ? { provider: result[0].provider, generation: BigInt(result[0].generation) } : null;
}

/**
 * A bounded request-resume path deliberately reuses the original durable claim
 * instead of stealing it. This lets a fresh authenticated manager finalize a
 * post-I/O disconnect without making the integration issuable in between.
 */
export async function resumeProviderIntegrationDisconnect(input: {
  authority: ProviderMutationAuthority;
  integrationId: string;
}): Promise<{
  provider: string; generation: bigint; claimId: string;
  phase: "claimed" | "lease_cleanup_pending" | "leases_revoked" | "provider_revoke_started"
    | "provider_revoke_ambiguous" | "provider_revoked";
} | null> {
  const result = await queryD1<{
    provider: string; generation: number; claimId: string; phase: string; status: string;
  }>(sql`
    SELECT integration."provider" AS "provider",
           integration."disconnect_generation" AS "generation",
           integration."revocation_claim_id" AS "claimId",
           integration."disconnect_phase" AS "phase",
           integration."status" AS "status"
    FROM ${workspaceProviderIntegration} AS integration
    WHERE integration."id" = ${input.integrationId}
      AND integration."organization_id" = ${input.authority.organizationId}
      AND integration."status" IN ('active', 'reconnect_required')
      AND integration."revoked_at" IS NULL
      AND integration."revocation_pending_at" IS NOT NULL
      AND integration."revocation_claim_id" IS NOT NULL
      AND integration."disconnect_generation" IS NOT NULL
      AND integration."generation" = integration."disconnect_generation"
      AND integration."disconnect_phase" IN (
        'claimed', 'lease_cleanup_pending', 'leases_revoked', 'provider_revoke_started',
        'provider_revoke_ambiguous', 'provider_revoked'
      )
      AND ${providerMutationAuthoritySql({ ...input.authority })}
  `);
  const row = result[0];
  if (!row || !["active", "reconnect_required"].includes(row.status) || ![
    "claimed", "lease_cleanup_pending", "leases_revoked", "provider_revoke_started",
    "provider_revoke_ambiguous", "provider_revoked",
  ].includes(row.phase)) return null;
  return {
    provider: row.provider,
    generation: BigInt(row.generation),
    claimId: row.claimId,
    phase: row.phase as "claimed" | "lease_cleanup_pending" | "leases_revoked" | "provider_revoke_started"
      | "provider_revoke_ambiguous" | "provider_revoked",
  };
}

/** Only no-I/O claimed disconnects can become issuable again. */
export async function releaseProviderIntegrationDisconnectClaim(input: {
  organizationId: string; integrationId: string; claimId: string;
}): Promise<void> {
  await queryD1(sql`
    UPDATE ${workspaceProviderIntegration}
    SET "revocation_pending_at" = NULL, "revocation_claimed_at" = NULL,
        "revocation_claim_id" = NULL, "disconnect_phase" = 'idle',
        "disconnect_generation" = NULL
    WHERE "id" = ${input.integrationId}
      AND "organization_id" = ${input.organizationId}
      AND "revocation_claim_id" = ${input.claimId}
      AND "revoked_at" IS NULL
      AND "disconnect_phase" = 'claimed'
  `);
}

type DisconnectPhase = "claimed" | "lease_cleanup_pending" | "leases_revoked" | "provider_revoke_started"
  | "provider_revoke_ambiguous" | "provider_revoked";

async function transitionProviderIntegrationDisconnect(input: {
  organizationId: string; integrationId: string; generation: bigint; claimId: string;
  from: DisconnectPhase; to: DisconnectPhase; now: Date;
}) {
  const result = await queryD1<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "disconnect_phase" = ${input.to}, "updated_at" = ${input.now}
    WHERE integration."id" = ${input.integrationId}
      AND integration."organization_id" = ${input.organizationId}
      AND integration."generation" = ${input.generation}
      AND integration."disconnect_generation" = ${input.generation}
      AND integration."revocation_claim_id" = ${input.claimId}
      AND integration."revocation_pending_at" IS NOT NULL
      AND integration."revoked_at" IS NULL
      AND integration."disconnect_phase" = ${input.from}
    RETURNING "id"
  `);
  return result.length === 1;
}

export async function markProviderIntegrationDisconnectLeasesRevoked(input: {
  organizationId: string; integrationId: string; generation: bigint; claimId: string; now: Date;
}) {
  const advanced = await transitionProviderIntegrationDisconnect({
    ...input, from: "claimed", to: "leases_revoked",
  });
  return advanced || transitionProviderIntegrationDisconnect({
    ...input, from: "lease_cleanup_pending", to: "leases_revoked",
  });
}

/** Lease cleanup may be retried; this phase is not OAuth-revoke ambiguity. */
export function markProviderIntegrationLeaseCleanupPending(input: {
  organizationId: string; integrationId: string; generation: bigint; claimId: string; now: Date;
}) {
  return transitionProviderIntegrationDisconnect({ ...input, from: "claimed", to: "lease_cleanup_pending" });
}

export function markProviderIntegrationProviderRevokeStarted(input: {
  organizationId: string; integrationId: string; generation: bigint; claimId: string; now: Date;
}) {
  return transitionProviderIntegrationDisconnect({ ...input, from: "leases_revoked", to: "provider_revoke_started" });
}

export async function markProviderIntegrationProviderRevokeAmbiguous(input: {
  organizationId: string; integrationId: string; generation: bigint; claimId: string; now: Date;
}) {
  // A timeout after provider revoke starts is non-replayable. Make that state
  // visibly non-issuable too: a user can later authorize a fresh provider
  // credential, which fences this claim with a generation bump.
  const result = await queryD1<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "status" = 'reconnect_required',
        "disconnect_phase" = 'provider_revoke_ambiguous',
        "updated_at" = ${input.now}
    WHERE integration."id" = ${input.integrationId}
      AND integration."organization_id" = ${input.organizationId}
      AND integration."generation" = ${input.generation}
      AND integration."disconnect_generation" = ${input.generation}
      AND integration."revocation_claim_id" = ${input.claimId}
      AND integration."revocation_pending_at" IS NOT NULL
      AND integration."revoked_at" IS NULL
      AND integration."disconnect_phase" = 'provider_revoke_started'
    RETURNING "id"
  `);
  return result.length === 1;
}

export function markProviderIntegrationProviderRevoked(input: {
  organizationId: string; integrationId: string; generation: bigint; claimId: string; now: Date;
}) {
  return transitionProviderIntegrationDisconnect({ ...input, from: "provider_revoke_started", to: "provider_revoked" });
}
