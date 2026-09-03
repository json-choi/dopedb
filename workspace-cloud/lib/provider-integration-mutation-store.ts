// The only durable create/reconnect boundary for provider integrations. Provider
// discovery and OAuth happen before this function; every durable consequence is
// conditional on one final, locked authorization snapshot.
import "server-only";

import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  providerMutationAuthoritySql,
  type ProviderMutationAuthority,
} from "./provider-integrations/authority";
import {
  workspaceAuditEvent,
  workspaceConnection,
  workspaceProviderIntegration,
  workspaceProviderPrincipalClaim,
} from "./schema";

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
 * The only durable local-verification projection. It is provider-neutral JSONB
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
      AND integration."revocation_claim_id" = ${input.reconnectClaimId}::uuid`;
  }
  return sql`
    AND integration."status" = ${existing.status}
    AND integration."generation" = ${existing.generation}
    AND integration."revocation_pending_at" IS NULL
    ${existing.revokedAt
      ? sql`AND integration."revoked_at" = ${existing.revokedAt}`
      : sql`AND integration."revoked_at" IS NULL`}`;
}

function desiredClaims(input: PersistProviderIntegrationInput) {
  if (input.principalClaims.length === 0) {
    return sql`SELECT NULL::text AS "principal_fingerprint",
                      NULL::text AS "target_fingerprint",
                      NULL::text AS "access_kind"
               WHERE FALSE`;
  }
  return sql`VALUES ${sql.join(input.principalClaims.map((claim) => sql`(
    ${claim.principalFingerprint}, ${claim.targetFingerprint}, ${claim.accessKind}
  )`), sql`, `)}`;
}

// This deliberately is one data-modifying statement instead of a Neon batch:
// every claim, connection revision and audit row depends on `mutation`, whose
// WHERE/INSERT SELECT holds the member gate, exact live session and generation.
export async function persistProviderIntegration(
  input: PersistProviderIntegrationInput,
): Promise<PersistProviderIntegrationResult> {
  if (!validLocalVerificationTarget(input.provider, input.localVerificationTarget)) {
    return { ok: false };
  }
  // JSONB `null` is not SQL NULL. The schema constraint deliberately treats
  // provider-neutral targets as absent for Neon and PlanetScale, so preserve
  // that distinction at the sole durable mutation boundary.
  const localVerificationTarget = input.localVerificationTarget === null
    ? sql`NULL`
    : sql`${JSON.stringify(input.localVerificationTarget)}::jsonb`;
  const authority = providerMutationAuthoritySql({
    ...input.authority,
    ...(input.existing ? {
      integration: {
        id: input.integrationId,
        provider: input.provider,
        generation: input.existing.generation,
        claimId: input.reconnectClaimId ?? null,
      },
    } : {}),
  });
  const mutation = input.existing
    ? sql`
      UPDATE ${workspaceProviderIntegration} AS integration
      SET "status" = 'active',
          "external_account_id" = ${input.externalAccountId},
          "display_name" = ${input.displayName},
          "encrypted_credential" = ${input.encryptedCredential},
          "credential_expires_at" = ${input.credentialExpiresAt},
          "granted_scope" = ${input.grantedScope},
          "local_verification_target" = ${localVerificationTarget},
          "revoked_at" = NULL,
          "revocation_pending_at" = NULL,
          "revocation_claimed_at" = NULL,
          "revocation_claim_id" = NULL,
          "refresh_phase" = 'idle',
          "refresh_claimed_at" = NULL,
          "refresh_claim_id" = NULL,
          "refresh_generation" = NULL,
          "refresh_remote_started_at" = NULL,
          "disconnect_phase" = 'idle',
          "disconnect_generation" = NULL,
          "generation" = integration."generation" + 1,
          "updated_at" = ${input.now}
      WHERE integration."id" = ${input.integrationId}::uuid
        AND integration."organization_id" = ${input.authority.organizationId}
        ${expectedGeneration(input)}
        AND ${authority}
      RETURNING integration."id", integration."organization_id"`
    : sql`
      INSERT INTO ${workspaceProviderIntegration}
        ("id", "organization_id", "provider", "external_account_id",
         "display_name", "encrypted_credential", "credential_expires_at",
         "granted_scope", "local_verification_target", "created_by_user_id", "updated_at")
      SELECT ${input.integrationId}::uuid, ${input.authority.organizationId},
             ${input.provider}, ${input.externalAccountId}, ${input.displayName},
             ${input.encryptedCredential}, ${input.credentialExpiresAt}, ${input.grantedScope},
             ${localVerificationTarget},
             ${input.authority.userId}, ${input.now}
      WHERE ${authority}
      RETURNING "id", "organization_id"`;
  const claimCtes = input.principalClaims.length === 0 ? sql`` : sql`,
    desired_claims("principal_fingerprint", "target_fingerprint", "access_kind") AS (
      ${desiredClaims(input)}
    ),
    upserted_claims AS (
      INSERT INTO ${workspaceProviderPrincipalClaim}
        ("principal_fingerprint", "organization_id", "integration_id",
         "target_fingerprint", "access_kind", "created_at", "updated_at")
      SELECT desired_claims."principal_fingerprint", mutation."organization_id",
             mutation."id", desired_claims."target_fingerprint",
             desired_claims."access_kind", ${input.now}, ${input.now}
      FROM desired_claims CROSS JOIN mutation
      ON CONFLICT ("integration_id", "access_kind") DO UPDATE
      SET "principal_fingerprint" = EXCLUDED."principal_fingerprint",
          "target_fingerprint" = EXCLUDED."target_fingerprint",
          "updated_at" = EXCLUDED."updated_at"
      RETURNING "access_kind"
    ),
    deleted_stale_claims AS (
      DELETE FROM ${workspaceProviderPrincipalClaim} AS claim
      USING mutation
      WHERE claim."integration_id" = mutation."id"
        AND EXISTS (SELECT 1 FROM upserted_claims)
        AND NOT EXISTS (
          SELECT 1 FROM desired_claims
          WHERE desired_claims."access_kind" = claim."access_kind"
        )
      RETURNING claim."principal_fingerprint"
    )`;
  const result = await db.execute<{ id: string }>(sql`
    WITH mutation AS (${mutation})
    ${claimCtes},
    bumped_connections AS (
      UPDATE ${workspaceConnection} AS connection
      SET "revision" = connection."revision" + 1,
          "updated_at" = ${input.now}
      FROM mutation
      WHERE connection."organization_id" = mutation."organization_id"
        AND connection."provider_integration_id" = mutation."id"
        AND connection."deleted_at" IS NULL
      RETURNING connection."id"
    ),
    audit_event AS (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      SELECT mutation."organization_id", ${input.authority.userId},
             'provider.connect', 'provider_integration', mutation."id"::text,
             jsonb_build_object(
               'provider', ${input.provider}::text,
               'revokedLeases', ${input.revokedLeases}::integer,
               'production', ${input.production}::boolean,
               'productionApproved', ${input.production === true}::boolean
             ), ${input.requestId}::uuid
      FROM mutation
      RETURNING "resource_id"
    )
    SELECT "id"::text AS "id" FROM mutation
  `);
  const id = result.rows[0]?.id;
  return id ? { ok: true, id } : { ok: false };
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
  const result = await db.execute<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "refresh_claim_id" = ${input.claimId}::uuid,
        "refresh_claimed_at" = ${input.now},
        "refresh_generation" = ${input.generation},
        "refresh_phase" = 'claimed',
        "refresh_remote_started_at" = NULL
    WHERE integration."id" = ${input.integrationId}::uuid
      AND integration."provider" = 'planetScale'
      AND integration."generation" = ${input.generation}
      AND integration."status" = 'active'
      AND integration."revoked_at" IS NULL
      AND integration."revocation_pending_at" IS NULL
      AND integration."revocation_claim_id" IS NULL
      AND (integration."refresh_phase" = 'idle'
        OR (integration."refresh_phase" = 'claimed'
          AND integration."refresh_claimed_at" < ${input.now} - interval '5 minutes'))
      AND ${providerMutationAuthoritySql({
        ...input.authority,
        requireManager: true,
        integration: { id: input.integrationId, provider: "planetScale", generation: input.generation, claimId: null },
      })}
    RETURNING integration."id"::text AS "id"
  `);
  return result.rows.length === 1;
}

/** Write the external-I/O fence in its own transaction before contacting OAuth. */
export async function markPlanetScaleCredentialRefreshRemoteStarted(input: {
  integrationId: string; generation: bigint; claimId: string; now: Date;
}): Promise<boolean> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "status" = 'reconnect_required',
        "refresh_phase" = 'remote_started',
        "refresh_remote_started_at" = ${input.now}
    WHERE integration."id" = ${input.integrationId}::uuid
      AND integration."provider" = 'planetScale'
      AND integration."generation" = ${input.generation}
      AND integration."refresh_generation" = ${input.generation}
      AND integration."refresh_claim_id" = ${input.claimId}::uuid
      AND integration."refresh_phase" = 'claimed'
      AND integration."status" = 'active'
      AND integration."revoked_at" IS NULL
      AND integration."revocation_pending_at" IS NULL
      AND integration."revocation_claim_id" IS NULL
    RETURNING integration."id"::text AS "id"
  `);
  return result.rows.length === 1;
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
  const result = await db.execute<{ id: string }>(sql`
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
    WHERE integration."id" = ${input.integrationId}::uuid
      AND integration."provider" = 'planetScale'
      AND integration."generation" = ${input.generation}
      AND integration."refresh_generation" = ${input.generation}
      AND integration."refresh_claim_id" = ${input.claimId}::uuid
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
    RETURNING integration."id"::text AS "id"
  `);
  return result.rows.length === 1;
}

/** A post-I/O failure is ambiguous and can only be repaired by explicit OAuth reconnect. */
export async function requirePlanetScaleCredentialReconnect(input: {
  integrationId: string; generation: bigint; claimId: string; now: Date;
}): Promise<boolean> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "status" = 'reconnect_required',
        "refresh_phase" = 'reconnect_required',
        "refresh_remote_started_at" = COALESCE(integration."refresh_remote_started_at", ${input.now}),
        "updated_at" = ${input.now}
    WHERE integration."id" = ${input.integrationId}::uuid
      AND integration."provider" = 'planetScale'
      AND integration."generation" = ${input.generation}
      AND integration."refresh_generation" = ${input.generation}
      AND integration."refresh_claim_id" = ${input.claimId}::uuid
      AND integration."refresh_phase" IN ('remote_started', 'reconnect_required')
      AND integration."revoked_at" IS NULL
    RETURNING integration."id"::text AS "id"
  `);
  return result.rows.length === 1;
}

/** Disconnect starts non-issuable and keeps its generation/claim as the fence. */
export async function claimProviderIntegrationDisconnect(input: {
  authority: ProviderMutationAuthority;
  integrationId: string;
  claimId: string;
  now: Date;
}): Promise<{ provider: string; generation: bigint } | null> {
  const result = await db.execute<{ provider: string; generation: bigint }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "revocation_pending_at" = ${input.now},
        "revocation_claimed_at" = ${input.now},
        "revocation_claim_id" = ${input.claimId}::uuid,
        "disconnect_phase" = 'claimed',
        "disconnect_generation" = integration."generation"
    WHERE integration."id" = ${input.integrationId}::uuid
      AND integration."organization_id" = ${input.authority.organizationId}
      AND integration."status" IN ('active', 'reconnect_required')
      AND integration."revoked_at" IS NULL
      AND integration."revocation_pending_at" IS NULL
      AND integration."revocation_claim_id" IS NULL
      AND integration."refresh_phase" IN ('idle', 'reconnect_required')
      AND integration."disconnect_phase" = 'idle'
      AND ${providerMutationAuthoritySql({ ...input.authority })}
    RETURNING integration."provider" AS "provider", integration."generation" AS "generation"
  `);
  return result.rows[0] ?? null;
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
  const result = await db.execute<{
    provider: string; generation: bigint; claimId: string; phase: string; status: string;
  }>(sql`
    SELECT integration."provider" AS "provider",
           integration."disconnect_generation" AS "generation",
           integration."revocation_claim_id"::text AS "claimId",
           integration."disconnect_phase" AS "phase",
           integration."status" AS "status"
    FROM ${workspaceProviderIntegration} AS integration
    WHERE integration."id" = ${input.integrationId}::uuid
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
    FOR UPDATE OF integration
  `);
  const row = result.rows[0];
  if (!row || !["active", "reconnect_required"].includes(row.status) || ![
    "claimed", "lease_cleanup_pending", "leases_revoked", "provider_revoke_started",
    "provider_revoke_ambiguous", "provider_revoked",
  ].includes(row.phase)) return null;
  return {
    provider: row.provider,
    generation: row.generation,
    claimId: row.claimId,
    phase: row.phase as "claimed" | "lease_cleanup_pending" | "leases_revoked" | "provider_revoke_started"
      | "provider_revoke_ambiguous" | "provider_revoked",
  };
}

/** Only no-I/O claimed disconnects can become issuable again. */
export async function releaseProviderIntegrationDisconnectClaim(input: {
  organizationId: string; integrationId: string; claimId: string;
}): Promise<void> {
  await db.execute(sql`
    UPDATE ${workspaceProviderIntegration}
    SET "revocation_pending_at" = NULL, "revocation_claimed_at" = NULL,
        "revocation_claim_id" = NULL, "disconnect_phase" = 'idle',
        "disconnect_generation" = NULL
    WHERE "id" = ${input.integrationId}::uuid
      AND "organization_id" = ${input.organizationId}
      AND "revocation_claim_id" = ${input.claimId}::uuid
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
  const result = await db.execute<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "disconnect_phase" = ${input.to}, "updated_at" = ${input.now}
    WHERE integration."id" = ${input.integrationId}::uuid
      AND integration."organization_id" = ${input.organizationId}
      AND integration."generation" = ${input.generation}
      AND integration."disconnect_generation" = ${input.generation}
      AND integration."revocation_claim_id" = ${input.claimId}::uuid
      AND integration."revocation_pending_at" IS NOT NULL
      AND integration."revoked_at" IS NULL
      AND integration."disconnect_phase" = ${input.from}
    RETURNING integration."id"::text AS "id"
  `);
  return result.rows.length === 1;
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
  const result = await db.execute<{ id: string }>(sql`
    UPDATE ${workspaceProviderIntegration} AS integration
    SET "status" = 'reconnect_required',
        "disconnect_phase" = 'provider_revoke_ambiguous',
        "updated_at" = ${input.now}
    WHERE integration."id" = ${input.integrationId}::uuid
      AND integration."organization_id" = ${input.organizationId}
      AND integration."generation" = ${input.generation}
      AND integration."disconnect_generation" = ${input.generation}
      AND integration."revocation_claim_id" = ${input.claimId}::uuid
      AND integration."revocation_pending_at" IS NOT NULL
      AND integration."revoked_at" IS NULL
      AND integration."disconnect_phase" = 'provider_revoke_started'
    RETURNING integration."id"::text AS "id"
  `);
  return result.rows.length === 1;
}

export function markProviderIntegrationProviderRevoked(input: {
  organizationId: string; integrationId: string; generation: bigint; claimId: string; now: Date;
}) {
  return transitionProviderIntegrationDisconnect({ ...input, from: "provider_revoke_started", to: "provider_revoked" });
}
