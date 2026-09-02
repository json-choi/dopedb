import "server-only";

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

import { db } from "../db";
import {
  workspaceAuditEvent,
  workspaceConnection,
  workspaceCredentialLease,
  workspaceProviderIntegration,
} from "../schema";
import {
  revokePlanetScaleLease,
  type PlanetScaleResource,
} from "../providers/planetscale";
import {
  neonRoleForLease,
  revokeNeonLease,
} from "../providers/neon";
import type { NeonResource } from "../providers/neon-core";
import { revokeVaultLease } from "../providers/vault";
import { ProviderRequestError } from "../providers/provider-types";
import {
  CLEANUP_CLAIM_STALE_SECONDS,
  type ExpiredLeaseCleanupResult,
  type LeaseRevocationFilter,
  type LeaseRevocationResult,
  managedLeaseCleanupRetryDelayMs,
  parseManagedProviderResource,
} from "./domain";
import {
  currentPlanetScaleAccessToken,
  neonCredential,
  vaultCredential,
} from "./integration";
import { kickWorkspaceBackgroundTask } from "../workspace-background-scheduler";

type LeaseCleanupRow = {
  id: string;
  organizationId: string;
  connectionId: string;
  connectionOrganizationId: string;
  connectionIntegrationId: string | null;
  integrationId: string;
  userId: string;
  provider: string;
  credentialId: string;
  credentialKind: string;
  providerAuditId: string | null;
  expiresAt: Date;
  providerResource: unknown;
  cleanupClaim?: {
    attempt: number;
  };
};

export function managedLeaseAuthorityMatches(input: {
  leaseOrganizationId: string;
  connectionOrganizationId: string;
  leaseIntegrationId: string;
  connectionIntegrationId: string | null;
  integrationOrganizationId: string;
  leaseProvider: string;
  integrationProvider: string;
}) {
  return input.connectionOrganizationId === input.leaseOrganizationId
    && input.connectionIntegrationId === input.leaseIntegrationId
    && input.integrationOrganizationId === input.leaseOrganizationId
    && input.integrationProvider === input.leaseProvider;
}

async function markLeaseRevoked(
  lease: LeaseCleanupRow,
) {
  const now = new Date();
  const cleanupFence = lease.cleanupClaim ? sql`
      AND lease."cleanup_attempts" = ${lease.cleanupClaim.attempt}
      AND lease."cleanup_claimed_at" IS NOT NULL` : sql``;
  const action = lease.cleanupClaim
    ? "credential.lease.cleanup"
    : "credential.lease.revoke";
  // Serializing by the same connection advisory key used by revocation gates
  // ensures the second statement gets a post-lock READ COMMITTED snapshot. Two
  // workers cleaning the last two legacy leases can no longer both observe the
  // other's pre-revoke row and skip the final deterministic demotion.
  const [, result] = await db.batch([
    db.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(
        'connection:' || lease."organization_id" || ':' || lease."connection_id"::text,
        0
      ))
      FROM ${workspaceCredentialLease} AS lease
      WHERE lease."id" = ${lease.id}::uuid
    `),
    db.execute<{ id: string }>(sql`
    WITH revoked AS (
      UPDATE ${workspaceCredentialLease} AS lease
      SET "revoked_at" = ${now}, "cleanup_claimed_at" = NULL,
          "cleanup_next_attempt_at" = NULL
      WHERE lease."id" = ${lease.id}::uuid
        AND lease."revoked_at" IS NULL
        ${cleanupFence}
      RETURNING lease."id", lease."organization_id", lease."connection_id",
                lease."provider", lease."provider_audit_id",
                lease."external_credential_id", lease."external_credential_kind",
                lease."cleanup_attempts"
    ), demoted_legacy_connection AS (
      UPDATE ${workspaceConnection} AS connection
      SET "credential_mode" = 'member_local',
          "provider_integration_id" = NULL,
          "provider_resource" = NULL,
          "provider_resource_id" = NULL,
          "readonly_default" = TRUE,
          "allow_writes" = FALSE,
          "revision" = connection."revision" + 1,
          "updated_at" = ${now}
      FROM revoked
      WHERE connection."id" = revoked."connection_id"
        AND connection."organization_id" = revoked."organization_id"
        AND connection."credential_mode" = 'managed'
        AND connection."provider_resource_id" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${workspaceCredentialLease} AS live_lease
          WHERE live_lease."organization_id" = connection."organization_id"
            AND live_lease."connection_id" = connection."id"
            -- DML CTE siblings share a snapshot; exclude this returned row.
            AND live_lease."id" <> revoked."id"
            AND live_lease."revoked_at" IS NULL
        )
      RETURNING connection."id"
    ), audited AS (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id", "created_at")
      SELECT revoked."organization_id", NULL, ${action}, 'credentialLease',
             revoked."id"::text,
             jsonb_strip_nulls(jsonb_build_object(
               'connectionId', revoked."connection_id"::text,
               'provider', revoked."provider",
               'providerAuditId', revoked."provider_audit_id",
               'externalCredentialId', revoked."external_credential_id",
               'externalCredentialKind', revoked."external_credential_kind",
               'cleanupAttempt', revoked."cleanup_attempts",
               'outcome', 'revoked'
             )),
             gen_random_uuid(), ${now}
      FROM revoked
      RETURNING "id"
    )
    SELECT revoked."id"::text AS "id" FROM revoked, audited
  `),
  ]);
  return result.rows.length === 1;
}

async function scheduleLeaseCleanupRetry(lease: LeaseCleanupRow) {
  const cleanupClaim = lease.cleanupClaim;
  if (!cleanupClaim) return false;
  const nextAttemptAt = new Date(
    Date.now() + managedLeaseCleanupRetryDelayMs(cleanupClaim.attempt),
  );
  const result = await db.execute<{ id: string }>(sql`
    WITH deferred AS (
      UPDATE ${workspaceCredentialLease} AS lease
      SET "cleanup_claimed_at" = NULL,
          "cleanup_next_attempt_at" = ${nextAttemptAt}
      WHERE lease."id" = ${lease.id}::uuid
        AND lease."cleanup_attempts" = ${cleanupClaim.attempt}
        AND lease."cleanup_claimed_at" IS NOT NULL
        AND lease."revoked_at" IS NULL
      RETURNING lease."id", lease."organization_id", lease."connection_id",
                lease."provider", lease."provider_audit_id",
                lease."external_credential_id", lease."external_credential_kind",
                lease."cleanup_attempts"
    ), audited AS (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      SELECT deferred."organization_id", NULL,
             'credential.lease.cleanup_deferred', 'credentialLease',
             deferred."id"::text,
             jsonb_strip_nulls(jsonb_build_object(
               'connectionId', deferred."connection_id"::text,
               'provider', deferred."provider",
               'providerAuditId', deferred."provider_audit_id",
               'externalCredentialId', deferred."external_credential_id",
               'externalCredentialKind', deferred."external_credential_kind",
               'cleanupAttempt', deferred."cleanup_attempts",
               'nextAttemptAt', ${nextAttemptAt},
               'outcome', 'deferred'
             )),
             gen_random_uuid()
      FROM deferred
      RETURNING "id"
    )
    SELECT deferred."id"::text AS "id" FROM deferred, audited
  `);
  return result.rows.length === 1;
}

async function recordLeaseRevocationDeferred(lease: LeaseCleanupRow) {
  const rows = await db.insert(workspaceAuditEvent).values({
    organizationId: lease.organizationId,
    actorUserId: null,
    action: "credential.lease.revoke_deferred",
    resourceType: "credentialLease",
    resourceId: lease.id,
    redactedSummary: {
      connectionId: lease.connectionId,
      provider: lease.provider,
      ...(lease.providerAuditId ? { providerAuditId: lease.providerAuditId } : {}),
      externalCredentialId: lease.credentialId,
      externalCredentialKind: lease.credentialKind,
      outcome: "deferred",
    },
    requestId: crypto.randomUUID(),
  }).returning({ id: workspaceAuditEvent.id });
  return rows.length === 1;
}

async function revokeLeaseRows(
  leases: LeaseCleanupRow[],
): Promise<LeaseRevocationResult> {
  if (leases.length === 0) return { revoked: 0, deferred: 0 };
  const integrationIds = [...new Set(leases.map((item) => item.integrationId))];
  const integrations = await db.select({
    id: workspaceProviderIntegration.id,
    organizationId: workspaceProviderIntegration.organizationId,
    provider: workspaceProviderIntegration.provider,
    externalAccountId: workspaceProviderIntegration.externalAccountId,
    encryptedCredential: workspaceProviderIntegration.encryptedCredential,
    credentialExpiresAt: workspaceProviderIntegration.credentialExpiresAt,
    generation: workspaceProviderIntegration.generation,
    updatedAt: workspaceProviderIntegration.updatedAt,
  }).from(workspaceProviderIntegration).where(and(
    inArray(workspaceProviderIntegration.id, integrationIds),
    inArray(workspaceProviderIntegration.status, ["active", "reconnect_required"]),
    isNull(workspaceProviderIntegration.revokedAt),
  ));
  const integrationMap = new Map(integrations.map((item) => [item.id, item]));
  const now = Date.now();
  let revoked = 0;
  let deferred = 0;

  for (const lease of leases) {
    const integration = integrationMap.get(lease.integrationId);
    const expired = lease.expiresAt.valueOf() <= now;
    try {
      if (
        !integration
        || !managedLeaseAuthorityMatches({
          leaseOrganizationId: lease.organizationId,
          connectionOrganizationId: lease.connectionOrganizationId,
          leaseIntegrationId: lease.integrationId,
          connectionIntegrationId: lease.connectionIntegrationId,
          integrationOrganizationId: integration.organizationId,
          leaseProvider: lease.provider,
          integrationProvider: integration.provider,
        })
      ) {
        throw new Error("Lease database authority is inconsistent");
      }
      if (integration.provider === "gcpCloudSql") {
        // IAM login tokens have no revocation API. Once expired they are safe to
        // retire from the audit index; live tokens remain an explicit deferral.
        if (!expired) {
          if (await recordLeaseRevocationDeferred(lease)) deferred += 1;
          continue;
        }
      } else if (lease.credentialKind === "pending") {
        if (!expired) {
          if (await recordLeaseRevocationDeferred(lease)) deferred += 1;
          continue;
        }
        if (integration.provider === "neon") {
          const resource = parseManagedProviderResource(
            integration.provider,
            lease.providerResource,
          );
          await revokeNeonLease(
            neonCredential(integration),
            resource as NeonResource,
            neonRoleForLease(lease.userId, lease.id),
          );
        }
        // Other pending records never persisted an external credential identifier.
      } else {
        const resource = parseManagedProviderResource(
          integration.provider,
          lease.providerResource,
        );
        if (
          integration.provider === "planetScale"
          && (lease.credentialKind === "role" || lease.credentialKind === "password")
        ) {
          await revokePlanetScaleLease(
            currentPlanetScaleAccessToken(integration),
            resource as PlanetScaleResource,
            lease.credentialKind,
            lease.credentialId,
          );
        } else if (
          integration.provider === "neon"
          && lease.credentialKind === "role"
        ) {
          await revokeNeonLease(
            neonCredential(integration),
            resource as NeonResource,
            lease.credentialId,
          );
        } else if (
          integration.provider === "vault"
          && lease.credentialKind === "role"
        ) {
          await revokeVaultLease(
            vaultCredential(integration),
            lease.credentialId,
          );
        } else if (integration.provider !== "gcpCloudSql") {
          throw new Error("Lease provider is unavailable");
        }
      }
      if (await markLeaseRevoked(lease)) revoked += 1;
    } catch (error) {
      // A Vault 404 may come from AppRole login or a moved auth/database mount,
      // not from the exact lease-revoke call. Never report that credential as
      // revoked until Vault accepted the synchronous revoke request.
      if (
        lease.provider !== "vault"
        && error instanceof ProviderRequestError
        && error.status === 404
      ) {
        if (await markLeaseRevoked(lease)) revoked += 1;
        continue;
      }
      const recorded = lease.cleanupClaim
        ? await scheduleLeaseCleanupRetry(lease)
        : await recordLeaseRevocationDeferred(lease);
      if (recorded) {
        deferred += 1;
      }
    }
  }
  return { revoked, deferred };
}

export async function revokeActiveLeases(
  filter: LeaseRevocationFilter,
): Promise<LeaseRevocationResult> {
  const predicates = [
    eq(workspaceCredentialLease.organizationId, filter.organizationId),
    isNull(workspaceCredentialLease.revokedAt),
  ];
  if (filter.leaseId) {
    predicates.push(eq(workspaceCredentialLease.id, filter.leaseId));
  }
  if (filter.userId) predicates.push(eq(workspaceCredentialLease.userId, filter.userId));
  if (filter.connectionId) {
    predicates.push(eq(workspaceCredentialLease.connectionId, filter.connectionId));
  }
  if (filter.integrationId) {
    predicates.push(eq(workspaceCredentialLease.integrationId, filter.integrationId));
  }
  if (filter.mutationOnly) {
    predicates.push(inArray(workspaceCredentialLease.accessMode, ["write", "schema"]));
  } else if (filter.accessMode) {
    predicates.push(eq(workspaceCredentialLease.accessMode, filter.accessMode));
  }
  const leases = await db.select({
    id: workspaceCredentialLease.id,
    organizationId: workspaceCredentialLease.organizationId,
    connectionId: workspaceCredentialLease.connectionId,
    connectionOrganizationId: workspaceConnection.organizationId,
    connectionIntegrationId: workspaceConnection.providerIntegrationId,
    integrationId: workspaceCredentialLease.integrationId,
    userId: workspaceCredentialLease.userId,
    provider: workspaceCredentialLease.provider,
    credentialId: workspaceCredentialLease.externalCredentialId,
    credentialKind: workspaceCredentialLease.externalCredentialKind,
    providerAuditId: workspaceCredentialLease.providerAuditId,
    expiresAt: workspaceCredentialLease.expiresAt,
    providerResource: workspaceConnection.providerResource,
  }).from(workspaceCredentialLease)
    .innerJoin(
      workspaceConnection,
      eq(workspaceCredentialLease.connectionId, workspaceConnection.id),
    )
    .where(and(...predicates))
    .orderBy(asc(workspaceCredentialLease.expiresAt));
  const result = await revokeLeaseRows(leases);
  if (result.deferred > 0) {
    // A synchronous revoke can be deferred until provider expiry or retry. Wake
    // the credential-only task once; its receipt records the exact next due time.
    await kickWorkspaceBackgroundTask({ task: "credential" });
  }
  return result;
}

type ClaimedLeaseRow = {
  id: string;
  organizationId: string;
  connectionId: string;
  connectionOrganizationId: string;
  connectionIntegrationId: string | null;
  integrationId: string;
  userId: string;
  provider: string;
  credentialId: string;
  credentialKind: string;
  providerAuditId: string | null;
  expiresAt: Date | string;
  providerResource: unknown;
  cleanupAttempt: number | string;
};

async function claimExpiredManagedLeases(input: {
  integrationId?: string;
  limit: number;
}): Promise<LeaseCleanupRow[]> {
  const rankedIntegrationFilter = input.integrationId
    ? sql`AND ranked_lease."integration_id" = ${input.integrationId}::uuid`
    : sql``;
  const candidateIntegrationFilter = input.integrationId
    ? sql`AND lease."integration_id" = ${input.integrationId}::uuid`
    : sql``;
  const result = await db.execute<ClaimedLeaseRow>(sql`
    WITH ranked AS (
      SELECT ranked_lease."id",
             ranked_lease."cleanup_attempts",
             COALESCE(
               ranked_lease."cleanup_next_attempt_at",
               ranked_lease."expires_at"
             ) AS ready_at,
             ROW_NUMBER() OVER (
               PARTITION BY ranked_lease."organization_id"
               ORDER BY ranked_lease."cleanup_attempts" ASC,
                        COALESCE(
                          ranked_lease."cleanup_next_attempt_at",
                          ranked_lease."expires_at"
                        ) ASC,
                        ranked_lease."expires_at" ASC,
                        ranked_lease."id" ASC
             ) AS tenant_rank
      FROM ${workspaceCredentialLease} AS ranked_lease
      INNER JOIN ${workspaceConnection} AS ranked_connection
        ON ranked_connection."id" = ranked_lease."connection_id"
      WHERE ranked_lease."revoked_at" IS NULL
        AND ranked_lease."expires_at" <= CURRENT_TIMESTAMP
        AND (
          ranked_lease."cleanup_next_attempt_at" IS NULL
          OR ranked_lease."cleanup_next_attempt_at" <= CURRENT_TIMESTAMP
        )
        AND (
          ranked_lease."cleanup_claimed_at" IS NULL
          OR ranked_lease."cleanup_claimed_at"
            < CURRENT_TIMESTAMP
              - (${CLEANUP_CLAIM_STALE_SECONDS} * INTERVAL '1 second')
        )
        ${rankedIntegrationFilter}
    ),
    candidates AS (
      SELECT lease."id"
      FROM ${workspaceCredentialLease} AS lease
      INNER JOIN ranked ON ranked."id" = lease."id"
      WHERE lease."revoked_at" IS NULL
        AND lease."expires_at" <= CURRENT_TIMESTAMP
        AND (
          lease."cleanup_next_attempt_at" IS NULL
          OR lease."cleanup_next_attempt_at" <= CURRENT_TIMESTAMP
        )
        AND (
          lease."cleanup_claimed_at" IS NULL
          OR lease."cleanup_claimed_at"
            < CURRENT_TIMESTAMP
              - (${CLEANUP_CLAIM_STALE_SECONDS} * INTERVAL '1 second')
        )
        ${candidateIntegrationFilter}
      ORDER BY ranked."cleanup_attempts" ASC,
               ranked.tenant_rank ASC,
               ranked.ready_at ASC,
               lease."id" ASC
      FOR UPDATE OF lease SKIP LOCKED
      LIMIT ${input.limit}
    ),
    claimed AS (
      UPDATE ${workspaceCredentialLease} AS lease
      SET "cleanup_claimed_at" = CURRENT_TIMESTAMP,
          "cleanup_attempts" = lease."cleanup_attempts" + 1
      FROM candidates
      WHERE lease."id" = candidates."id"
      RETURNING lease."id",
                lease."organization_id",
                lease."integration_id",
                lease."user_id",
                lease."provider",
                lease."external_credential_id",
                lease."external_credential_kind",
                lease."provider_audit_id",
                lease."expires_at",
                lease."connection_id",
                lease."cleanup_attempts"
    )
    SELECT claimed."id" AS "id",
           claimed."organization_id" AS "organizationId",
           claimed."connection_id"::text AS "connectionId",
           connection."organization_id" AS "connectionOrganizationId",
           connection."provider_integration_id"::text AS "connectionIntegrationId",
           claimed."integration_id" AS "integrationId",
           claimed."user_id" AS "userId",
           claimed."provider" AS "provider",
           claimed."external_credential_id" AS "credentialId",
           claimed."external_credential_kind" AS "credentialKind",
           claimed."provider_audit_id" AS "providerAuditId",
           claimed."expires_at" AS "expiresAt",
           connection."provider_resource" AS "providerResource",
           claimed."cleanup_attempts" AS "cleanupAttempt"
    FROM claimed
    INNER JOIN ${workspaceConnection} AS connection
      ON connection."id" = claimed."connection_id"
    INNER JOIN ranked ON ranked."id" = claimed."id"
    ORDER BY ranked."cleanup_attempts" ASC,
             ranked.tenant_rank ASC,
             ranked.ready_at ASC,
             claimed."id" ASC
  `);
  return result.rows.map((row) => {
    const expiresAt = row.expiresAt instanceof Date
      ? row.expiresAt
      : new Date(row.expiresAt);
    const cleanupAttempt = Number(row.cleanupAttempt);
    if (
      Number.isNaN(expiresAt.valueOf())
      || !Number.isSafeInteger(cleanupAttempt)
      || cleanupAttempt < 1
    ) {
      throw new Error("Invalid managed lease cleanup claim");
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      connectionId: row.connectionId,
      connectionOrganizationId: row.connectionOrganizationId,
      connectionIntegrationId: row.connectionIntegrationId,
      integrationId: row.integrationId,
      userId: row.userId,
      provider: row.provider,
      credentialId: row.credentialId,
      credentialKind: row.credentialKind,
      providerAuditId: row.providerAuditId,
      expiresAt,
      providerResource: row.providerResource,
      cleanupClaim: { attempt: cleanupAttempt },
    };
  });
}

export async function cleanupExpiredManagedLeases(input: {
  integrationId?: string;
  limit?: number;
} = {}): Promise<ExpiredLeaseCleanupResult> {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid managed lease cleanup limit");
  }
  const leases = await claimExpiredManagedLeases({
    integrationId: input.integrationId,
    limit,
  });
  return {
    scanned: leases.length,
    ...await revokeLeaseRows(leases),
  };
}
