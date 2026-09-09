import "server-only";

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

import { d1Db as db } from "../d1/database";
import { atomicD1 } from "../d1/atomic";
import { utcNow } from "../d1/schema/values";
import {
  workspaceAuditEvent,
  workspaceConnection,
  workspaceCredentialLease,
  workspaceProviderIntegration,
} from "../d1/schema";
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

async function persistLeaseCleanup(lease: LeaseCleanupRow, nextAttemptAt?: Date) {
  const cleanupFence = lease.cleanupClaim ? sql`
    AND cleanup_attempts = ${lease.cleanupClaim.attempt} AND cleanup_claimed_at IS NOT NULL` : sql``;
  const action = nextAttemptAt ? "credential.lease.cleanup_deferred"
    : lease.cleanupClaim ? "credential.lease.cleanup" : "credential.lease.revoke";
  const result = await atomicD1({
    scope: sql`SELECT json_object('summary', json_patch(json_object(
        'connectionId', connection_id, 'provider', provider,
        'externalCredentialId', external_credential_id, 'externalCredentialKind', external_credential_kind,
        'cleanupAttempt', cleanup_attempts, 'outcome', ${nextAttemptAt ? "deferred" : "revoked"}),
        json_object('providerAuditId', provider_audit_id, 'nextAttemptAt', ${nextAttemptAt ?? null}))) AS payload
      FROM workspace_credential_lease WHERE id = ${lease.id} AND organization_id = ${lease.organizationId}
        AND connection_id = ${lease.connectionId} AND integration_id = ${lease.integrationId}
        AND revoked_at IS NULL ${cleanupFence}`,
    statements: (scope) => [
      sql`UPDATE workspace_credential_lease SET cleanup_claimed_at = NULL,
          cleanup_next_attempt_at = ${nextAttemptAt ?? null},
          revoked_at = ${nextAttemptAt ? sql`revoked_at` : utcNow}
        WHERE id = ${lease.id} AND EXISTS (${scope}) RETURNING id`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${lease.organizationId}, NULL, ${action}, 'credentialLease', ${lease.id},
          payload -> 'summary', ${crypto.randomUUID()} FROM (${scope})`,
    ],
  });
  return result.rows[0].length === 1;
}

async function markLeaseRevoked(lease: LeaseCleanupRow) {
  return persistLeaseCleanup(lease);
}

async function scheduleLeaseCleanupRetry(lease: LeaseCleanupRow) {
  if (!lease.cleanupClaim) return false;
  return persistLeaseCleanup(lease, new Date(Date.now() + managedLeaseCleanupRetryDelayMs(lease.cleanupClaim.attempt)));
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
    sql`${workspaceProviderIntegration.id} IN (SELECT value FROM json_each(${JSON.stringify(integrationIds)}))`,
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
  const integrationFilter = input.integrationId ? sql`AND lease.integration_id = ${input.integrationId}` : sql``;
  const result = await atomicD1({
    scope: sql`WITH ranked AS (
      SELECT lease.id, lease.cleanup_attempts, COALESCE(lease.cleanup_next_attempt_at, lease.expires_at) AS ready_at,
        row_number() OVER (PARTITION BY lease.organization_id ORDER BY lease.cleanup_attempts,
          COALESCE(lease.cleanup_next_attempt_at, lease.expires_at), lease.expires_at, lease.id) AS tenant_rank
      FROM workspace_credential_lease lease JOIN workspace_connection connection ON connection.id = lease.connection_id
      WHERE lease.revoked_at IS NULL AND lease.expires_at <= ${utcNow}
        AND (lease.cleanup_next_attempt_at IS NULL OR lease.cleanup_next_attempt_at <= ${utcNow})
        AND (lease.cleanup_claimed_at IS NULL OR lease.cleanup_claimed_at <
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${`-${CLEANUP_CLAIM_STALE_SECONDS} seconds`})) ${integrationFilter}
      ) SELECT json_object('ids', json_group_array(id)) AS payload FROM (
        SELECT id FROM ranked ORDER BY cleanup_attempts, tenant_rank, ready_at, id LIMIT ${input.limit})`,
    statements: (scope) => {
      const ids = sql`SELECT selected.value FROM (${scope}), json_each(payload, '$.ids') selected`;
      return [
        sql`UPDATE workspace_credential_lease SET cleanup_claimed_at = ${utcNow}, cleanup_attempts = cleanup_attempts + 1
          WHERE id IN (${ids})`,
        sql`SELECT lease.id, lease.organization_id AS organizationId, lease.connection_id AS connectionId,
          connection.organization_id AS connectionOrganizationId, connection.provider_integration_id AS connectionIntegrationId,
          lease.integration_id AS integrationId, lease.user_id AS userId, lease.provider,
          lease.external_credential_id AS credentialId, lease.external_credential_kind AS credentialKind,
          lease.provider_audit_id AS providerAuditId, lease.expires_at AS expiresAt,
          connection.provider_resource AS providerResource, lease.cleanup_attempts AS cleanupAttempt
          FROM workspace_credential_lease lease JOIN workspace_connection connection ON connection.id = lease.connection_id
          CROSS JOIN (${scope}), json_each(payload, '$.ids') selected WHERE lease.id = selected.value ORDER BY selected.key`,
      ];
    },
  });
  return (result.rows[1] as ClaimedLeaseRow[]).map((row) => {
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
      providerResource: typeof row.providerResource === "string" ? JSON.parse(row.providerResource) : row.providerResource,
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
