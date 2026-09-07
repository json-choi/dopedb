import "server-only";

import { sql } from "drizzle-orm";

import {
  member,
  session,
  workspaceConnection,
  workspaceConnectionGrant,
  workspaceProviderIntegration,
} from "../schema";
import type { GcpLocalVerificationTarget } from "../providers/gcp-cloud-sql-core";
import { revocationGateLockKey } from "../revocation-gates";
import type { WorkspaceRoleName } from "../workspace-permissions";

export type ActiveProviderIntegration = {
  id: string;
  organizationId: string;
  provider: string;
  externalAccountId: string;
  encryptedCredential: string;
  credentialExpiresAt: Date | null;
  generation: bigint;
  updatedAt: Date;
};

export type ProviderMutationAuthority = {
  organizationId: string;
  membershipId: string;
  userId: string;
  sessionId: string;
  role: WorkspaceRoleName;
  // A current lease may authorize consumption of an already-valid token. It
  // must never widen a shared credential mutation, which sets requireManager.
  lease?: {
    connectionId: string;
    connectionRevision: number;
    providerResourceId: string;
    accessMode?: "read" | "write" | "schema";
  };
};

export function hasStrictGcpLocalVerificationTarget(value: unknown): value is GcpLocalVerificationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  const keys = Object.keys(target).sort();
  return keys.join(",") === "instanceId,kind,projectId"
    && target.kind === "gcpCloudSql"
    && typeof target.projectId === "string"
    && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(target.projectId)
    && typeof target.instanceId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,97}$/.test(target.instanceId);
}

// Every durable provider mutation uses this predicate in its final SQL
// statement, after provider/lease I/O.  The member advisory lock shares the
// revocation-gate ordering, and the exact live session, member and optional
// integration generation are checked in that same database transaction.
export function providerMutationAuthoritySql(input: ProviderMutationAuthority & {
  // Refreshing the shared provider credential is a provider-integration
  // mutation, not a connection-use operation. This explicitly suppresses the
  // otherwise valid current-lease `use` authorization path.
  requireManager?: boolean;
  integration?: {
    id: string;
    provider?: string;
    generation?: bigint;
    claimId?: string | null;
  };
}) {
  const integration = input.integration;
  const lease = input.requireManager ? undefined : input.lease;
  const integrationGuard = integration ? sql`
    AND EXISTS (
      SELECT 1 FROM ${workspaceProviderIntegration} AS guarded_integration
      WHERE guarded_integration."id" = ${integration.id}::uuid
        AND guarded_integration."organization_id" = ${input.organizationId}
        ${integration.provider ? sql`AND guarded_integration."provider" = ${integration.provider}` : sql``}
        ${integration.generation !== undefined ? sql`AND guarded_integration."generation" = ${integration.generation}` : sql``}
        ${integration.claimId === undefined ? sql`` : integration.claimId === null
          ? sql`AND guarded_integration."revocation_claim_id" IS NULL`
          : sql`AND guarded_integration."revocation_claim_id" = ${integration.claimId}::uuid`}
      FOR UPDATE
    )` : sql``;
  const leaseGuard = lease ? sql`
    AND EXISTS (
      SELECT 1
      FROM ${workspaceConnection} AS lease_connection
      JOIN ${workspaceConnectionGrant} AS lease_grant
        ON lease_grant."organization_id" = lease_connection."organization_id"
       AND lease_grant."connection_id" = lease_connection."id"
       AND lease_grant."member_id" = ${input.membershipId}
       AND (lease_grant."capability" IN ('use', 'manage')
         OR (lease_grant."capability" = 'read' AND ${lease.accessMode ?? 'write'} = 'read'))
      WHERE lease_connection."id" = ${lease.connectionId}::uuid
        AND lease_connection."organization_id" = ${input.organizationId}
        AND lease_connection."provider_integration_id" = ${integration?.id ?? ""}::uuid
        AND lease_connection."provider_resource_id" = ${lease.providerResourceId}::uuid
        AND lease_connection."revision" = ${lease.connectionRevision}
        AND lease_connection."credential_mode" = 'managed'
        AND lease_connection."deleted_at" IS NULL
        AND lease_connection."revocation_pending_at" IS NULL
        AND lease_connection."revocation_claim_id" IS NULL
      FOR UPDATE OF lease_connection, lease_grant
    )` : sql``;
  return sql`EXISTS (
    SELECT 1
    FROM (SELECT pg_advisory_xact_lock(hashtextextended(${revocationGateLockKey({
      kind: "member", organizationId: input.organizationId,
      memberId: input.membershipId, userId: input.userId,
    })}, 0))) AS member_lock
    JOIN ${session} AS live_session ON TRUE
    JOIN ${member} AS live_member
      ON live_member."id" = ${input.membershipId}
     AND live_member."organization_id" = ${input.organizationId}
     AND live_member."user_id" = ${input.userId}
    WHERE live_session."id" = ${input.sessionId}
      AND live_session."user_id" = ${input.userId}
      AND live_session."expires_at" > now()
      AND live_member."role" = ${input.role}
      AND live_member."role" IN (${lease ? sql`'viewer', 'analyst', 'editor', 'admin', 'owner'` : sql`'admin', 'owner'`})
      AND live_member."revocation_pending_at" IS NULL
      AND live_member."revocation_claim_id" IS NULL
      ${integrationGuard}
      ${leaseGuard}
    FOR UPDATE OF live_session, live_member
  )`;
}
