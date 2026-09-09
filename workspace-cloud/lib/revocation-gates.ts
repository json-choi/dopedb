// Durable authorization-mutation gates. A UUID owns each claim; timestamps are
// used only to recover abandoned claims and never as compare-and-swap tokens.
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { queryD1 } from "./d1/database";
import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
import {
  member,
  session,
  workspaceConnection,
  workspaceConnectionGrant,
  workspaceCredentialLease,
  workspaceProviderIntegration,
  workspaceProviderResource,
  workspaceProfile,
} from "./d1/schema";
import {
  isWorkspaceRole,
  type WorkspaceRoleName,
} from "./workspace-permissions";
import type {
  ManagedAccessMode,
  ManagedProviderLease,
} from "./providers/provider-types";

const REVOCATION_CLAIM_STALE_MS = 5 * 60 * 1_000;
const PENDING_LEASE_SECONDS = 2 * 60;

type MemberGateTarget = {
  kind: "member";
  organizationId: string;
  memberId: string;
  userId: string;
};

type ConnectionGateTarget = {
  kind: "connection";
  organizationId: string;
  connectionId: string;
};

type IntegrationGateTarget = {
  kind: "integration";
  organizationId: string;
  integrationId: string;
};

export type RevocationGateTarget =
  | MemberGateTarget
  | ConnectionGateTarget
  | IntegrationGateTarget;

export type RevocationGateClaim = RevocationGateTarget & {
  claimId: string;
  claimedAt: Date;
  pendingAt: Date;
  firstPending: boolean;
  connectionRevision?: number;
  memberRole?: WorkspaceRoleName;
};

type ClaimedRow = {
  pendingAt: Date | string;
  connectionRevision?: number | string;
  memberRole?: string;
};

export function revocationGateLockKey(target: RevocationGateTarget) {
  switch (target.kind) {
    case "member":
      return `member:${target.organizationId}:${target.userId}`;
    case "connection":
      return `connection:${target.organizationId}:${target.connectionId}`;
    case "integration":
      return `integration:${target.organizationId}:${target.integrationId}`;
  }
}

function parsedClaim(
  target: RevocationGateTarget,
  claimId: string,
  claimedAt: Date,
  row: ClaimedRow | undefined,
): RevocationGateClaim | null {
  if (!row) return null;
  const pendingAt = row.pendingAt instanceof Date
    ? row.pendingAt
    : new Date(row.pendingAt);
  const revision = row.connectionRevision == null
    ? undefined
    : Number(row.connectionRevision);
  const memberRole = row.memberRole;
  if (
    Number.isNaN(pendingAt.valueOf())
    || (revision !== undefined && !Number.isSafeInteger(revision))
    || (memberRole !== undefined && !isWorkspaceRole(memberRole))
  ) {
    throw new Error("Invalid revocation gate claim");
  }
  return {
    ...target,
    claimId,
    claimedAt,
    pendingAt,
    firstPending: pendingAt.valueOf() === claimedAt.valueOf(),
    ...(revision === undefined ? {} : { connectionRevision: revision }),
    ...(memberRole === undefined ? {} : { memberRole }),
  };
}

export async function claimRevocationGate(
  target: RevocationGateTarget,
): Promise<RevocationGateClaim | null> {
  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.valueOf() - REVOCATION_CLAIM_STALE_MS);
  const claimId = randomUUID();
  const table = target.kind === "member" ? member
    : target.kind === "connection" ? workspaceConnection : workspaceProviderIntegration;
  const identity = target.kind === "member"
    ? sql`id = ${target.memberId} AND user_id = ${target.userId}`
    : target.kind === "connection"
      ? sql`id = ${target.connectionId} AND deleted_at IS NULL`
      : sql`id = ${target.integrationId} AND status = 'active' AND revoked_at IS NULL`;
  const revision = target.kind === "connection"
    ? sql`revision = CASE WHEN revocation_pending_at IS NULL THEN revision + 1 ELSE revision END,`
    : sql``;
  const projection = target.kind === "member" ? sql`, role AS memberRole`
    : target.kind === "connection" ? sql`, revision AS connectionRevision` : sql``;
  const rows = await queryD1<ClaimedRow>(sql`UPDATE ${table} SET ${revision}
      revocation_pending_at = COALESCE(revocation_pending_at, ${claimedAt}),
      revocation_claimed_at = ${claimedAt}, revocation_claim_id = ${claimId}
    WHERE organization_id = ${target.organizationId} AND ${identity}
      AND (revocation_claim_id IS NULL OR revocation_claimed_at < ${staleBefore})
    RETURNING revocation_pending_at AS pendingAt ${projection}`);
  return parsedClaim(target, claimId, claimedAt, rows[0]);
}

async function updateClaim(
  claim: RevocationGateClaim,
  action: "release" | "clear" | "renew",
): Promise<RevocationGateClaim | boolean> {
  const nextClaimedAt = new Date();
  const nextClaimId = randomUUID();
  const values = action === "clear"
    ? sql`"revocation_pending_at" = NULL,
          "revocation_claimed_at" = NULL,
          "revocation_claim_id" = NULL`
    : action === "release"
      ? sql`"revocation_claimed_at" = NULL,
            "revocation_claim_id" = NULL`
      : sql`"revocation_claimed_at" = ${nextClaimedAt},
            "revocation_claim_id" = ${nextClaimId}`;
  let result;
  if (claim.kind === "member") {
    result = await queryD1<{ id: string }>(sql`
      UPDATE ${member}
      SET ${values}
      WHERE "id" = ${claim.memberId}
        AND "organization_id" = ${claim.organizationId}
        AND "user_id" = ${claim.userId}
        AND "revocation_pending_at" IS NOT NULL
        AND "revocation_claim_id" = ${claim.claimId}
      RETURNING "id"
    `);
  } else if (claim.kind === "connection") {
    result = await queryD1<{ id: string }>(sql`
      UPDATE ${workspaceConnection}
      SET ${values}
      WHERE "id" = ${claim.connectionId}
        AND "organization_id" = ${claim.organizationId}
        AND "deleted_at" IS NULL
        AND "revocation_pending_at" IS NOT NULL
        AND "revocation_claim_id" = ${claim.claimId}
      RETURNING "id" AS "id"
    `);
  } else {
    result = await queryD1<{ id: string }>(sql`
      UPDATE ${workspaceProviderIntegration}
      SET ${values}
      WHERE "id" = ${claim.integrationId}
        AND "organization_id" = ${claim.organizationId}
        AND "revocation_pending_at" IS NOT NULL
        AND "revocation_claim_id" = ${claim.claimId}
      RETURNING "id" AS "id"
    `);
  }
  if (result.length !== 1) return false;
  if (action !== "renew") return true;
  return {
    ...claim,
    claimId: nextClaimId,
    claimedAt: nextClaimedAt,
  };
}

export async function releaseRevocationGateClaim(
  claim: RevocationGateClaim,
) {
  return updateClaim(claim, "release") as Promise<boolean>;
}

export async function clearRevocationGate(
  claim: RevocationGateClaim,
) {
  return updateClaim(claim, "clear") as Promise<boolean>;
}

export async function renewRevocationGateClaim(
  claim: RevocationGateClaim,
) {
  const renewed = await updateClaim(claim, "renew");
  return renewed === false ? null : renewed as RevocationGateClaim;
}

export type ManagedLeaseAuthority = {
  leaseId: string;
  organizationId: string;
  memberId: string;
  userId: string;
  sessionId: string;
  role: WorkspaceRoleName;
  connectionId: string;
  connectionRevision: number;
  providerResourceId: string;
  engine: "postgres" | "mysql";
  integrationId: string;
  integrationGeneration: bigint;
  connectionProvider: string;
  provider: string;
  accessMode: ManagedAccessMode;
};

function capabilityPredicate(input: ManagedLeaseAuthority) {
  if (input.accessMode === "schema") {
    return sql`${member.role} IN ('admin', 'owner')
        AND ${workspaceConnection.allowWrites} = TRUE
        AND ${workspaceProviderIntegration.provider} IN ('neon', 'gcpCloudSql')
        AND ${workspaceConnection.engine} = 'postgres'
        AND json_type(${workspaceProviderResource.capabilityManifest}, '$.write') = 'true'`;
  }
  return input.accessMode === "write"
    ? sql`${member.role} IN ('editor', 'admin', 'owner')
        AND ${workspaceConnection.allowWrites} = TRUE
        AND json_type(${workspaceProviderResource.capabilityManifest}, '$.write') = 'true'`
    // Target-database access is granted separately from workspace roles. A live
    // workspace viewer with a `use` grant is therefore eligible for a read lease.
    : sql`${member.role} IN ('viewer', 'analyst', 'editor', 'admin', 'owner')`;
}

function connectionGrantPredicate(input: ManagedLeaseAuthority) {
  const capability = input.accessMode === "schema"
    ? sql`${workspaceConnectionGrant.capability} = 'manage'`
    : input.accessMode === "write"
      ? sql`${workspaceConnectionGrant.capability} IN ('use', 'manage')`
      : sql`${workspaceConnectionGrant.capability} IN ('read', 'use', 'manage')`;
  return sql`
    ${workspaceConnectionGrant.organizationId} = ${input.organizationId}
    AND ${workspaceConnectionGrant.connectionId} = ${input.connectionId}
    AND ${workspaceConnectionGrant.memberId} = ${input.memberId}
    AND ${capability}
  `;
}

function authorityPredicate(input: ManagedLeaseAuthority) {
  return sql`
    ${session.id} = ${input.sessionId}
    AND ${session.userId} = ${input.userId}
    AND ${session.expiresAt} > ${utcNow}
    AND ${member.id} = ${input.memberId}
    AND ${member.organizationId} = ${input.organizationId}
    AND ${member.userId} = ${input.userId}
    AND ${member.role} = ${input.role}
    AND ${member.revocationPendingAt} IS NULL
    AND ${member.revocationClaimId} IS NULL
    AND ${capabilityPredicate(input)}
    AND ${connectionGrantPredicate(input)}
    AND ${workspaceConnection.id} = ${input.connectionId}
    AND ${workspaceConnection.organizationId} = ${input.organizationId}
    AND ${workspaceConnection.deletedAt} IS NULL
    AND ${workspaceConnection.revocationPendingAt} IS NULL
    AND ${workspaceConnection.revocationClaimId} IS NULL
    AND ${workspaceConnection.credentialMode} = 'managed'
    AND ${workspaceConnection.providerIntegrationId} = ${input.integrationId}
    AND ${workspaceConnection.providerResourceId} = ${input.providerResourceId}
    AND ${workspaceConnection.revision} = ${input.connectionRevision}
    AND ${workspaceConnection.engine} = ${input.engine}
    AND ${workspaceConnection.provider} = ${input.connectionProvider}
    AND ${workspaceProviderIntegration.id} = ${input.integrationId}
    AND ${workspaceProviderIntegration.organizationId} = ${input.organizationId}
    AND ${workspaceProviderIntegration.provider} = ${input.provider}
    AND ${workspaceProviderIntegration.generation} = ${input.integrationGeneration}
    AND ${workspaceProviderIntegration.status} = 'active'
    AND ${workspaceProviderIntegration.refreshPhase} = 'idle'
    AND ${workspaceProviderIntegration.revokedAt} IS NULL
    AND ${workspaceProviderIntegration.revocationPendingAt} IS NULL
    AND ${workspaceProviderIntegration.revocationClaimId} IS NULL
    AND ${workspaceProviderResource.id} = ${input.providerResourceId}
    AND ${workspaceProviderResource.organizationId} = ${input.organizationId}
    AND ${workspaceProviderResource.provider} = ${input.provider}
    AND ${workspaceProfile.organizationId} = ${input.organizationId}
    AND ${workspaceProfile.lifecycleState} = 'active'
  `;
}

function durableAuthorityStatement(input: ManagedLeaseAuthority) {
  return sql`
    SELECT 1 AS "allowed"
    FROM ${session}, ${member}, ${workspaceConnection}, ${workspaceConnectionGrant},
         ${workspaceProviderIntegration}, ${workspaceProviderResource}, ${workspaceProfile}
    WHERE ${authorityPredicate(input)}
  `;
}

export async function reserveManagedLeaseIfUnblocked(input: ManagedLeaseAuthority) {
  const pendingExpiresAt = new Date(Date.now() + PENDING_LEASE_SECONDS * 1_000);
  const result = await atomicD1({
    scope: sql`WITH slots(value) AS (VALUES (1), (2), (3), (4), (5))
      SELECT json_object('allowed', EXISTS (${durableAuthorityStatement(input)}),
        'schemaBusy', ${input.accessMode} = 'schema' AND EXISTS (
          SELECT 1 FROM workspace_credential_lease WHERE organization_id = ${input.organizationId}
            AND connection_id = ${input.connectionId} AND access_mode = 'schema' AND revoked_at IS NULL),
        'duplicate', EXISTS (SELECT 1 FROM workspace_credential_lease WHERE id = ${input.leaseId}),
        'slot', (SELECT value FROM slots WHERE NOT EXISTS (
          SELECT 1 FROM workspace_credential_lease active WHERE active.organization_id = ${input.organizationId}
            AND active.connection_id = ${input.connectionId} AND active.user_id = ${input.userId}
            AND active.active_slot = slots.value AND active.revoked_at IS NULL)
          ORDER BY value LIMIT 1)) AS payload`,
    statements: (scope) => [
      sql`INSERT INTO workspace_credential_lease (id, organization_id, connection_id, integration_id,
          user_id, provider, access_mode, external_credential_id, external_credential_kind, active_slot, expires_at)
        SELECT ${input.leaseId}, ${input.organizationId}, ${input.connectionId}, ${input.integrationId},
          ${input.userId}, ${input.provider}, ${input.accessMode}, ${input.leaseId}, 'pending', payload ->> 'slot',
          ${pendingExpiresAt} FROM (${scope}) WHERE payload ->> 'allowed' = 1 AND payload ->> 'schemaBusy' = 0
          AND payload ->> 'duplicate' = 0 AND payload ->> 'slot' IS NOT NULL RETURNING id`,
      sql`SELECT CASE WHEN payload ->> 'allowed' = 0 THEN 'blocked'
        WHEN payload ->> 'schemaBusy' = 1 THEN 'schema_busy'
        WHEN payload ->> 'duplicate' = 1 OR payload ->> 'slot' IS NULL THEN 'limit'
        ELSE 'reserved' END AS status FROM (${scope})`,
    ],
  });
  const status = result.rows[1]?.[0]?.status;
  if (status !== "reserved" && status !== "blocked" && status !== "schema_busy" && status !== "limit") {
    throw new Error("Invalid managed lease reservation result");
  }
  if (status === "reserved" && result.rows[0].length !== 1) throw new Error("Managed lease reservation was incomplete");
  return status;
}

export async function finalizeManagedLeaseIfUnblocked(
  input: ManagedLeaseAuthority,
  lease: ManagedProviderLease,
  providerAuditId: string,
) {
  const expiresAt = new Date(lease.expiresAt);
  if (Number.isNaN(expiresAt.valueOf())) return false;
  const result = await queryD1<{ id: string }>(sql`
    WITH authority AS MATERIALIZED (${durableAuthorityStatement(input)})
    UPDATE ${workspaceCredentialLease} AS lease
    SET "external_credential_id" = ${lease.externalCredentialId},
        "external_credential_kind" = ${lease.externalCredentialKind},
        "provider_audit_id" = ${providerAuditId},
        "expires_at" = ${expiresAt}
    FROM authority
    WHERE lease."id" = ${input.leaseId}
      AND lease."organization_id" = ${input.organizationId}
      AND lease."connection_id" = ${input.connectionId}
      AND lease."integration_id" = ${input.integrationId}
      AND lease."user_id" = ${input.userId}
      AND lease."provider" = ${input.provider}
      AND lease."access_mode" = ${input.accessMode}
      AND lease."external_credential_kind" = 'pending'
      AND lease."revoked_at" IS NULL
      AND lease."expires_at" > ${utcNow}
      AND ${expiresAt} > ${utcNow}
    RETURNING "id"
  `);
  return result.length === 1;
}

export async function managedLeaseStillDeliverable(
  input: ManagedLeaseAuthority,
  lease: ManagedProviderLease,
  providerAuditId: string,
) {
  const expiresAt = new Date(lease.expiresAt);
  if (Number.isNaN(expiresAt.valueOf())) return false;
  const result = await queryD1<{ id: string }>(sql`
    WITH authority AS MATERIALIZED (${durableAuthorityStatement(input)})
    SELECT lease."id" AS "id"
    FROM authority, ${workspaceCredentialLease} AS lease
    WHERE lease."id" = ${input.leaseId}
      AND lease."organization_id" = ${input.organizationId}
      AND lease."connection_id" = ${input.connectionId}
      AND lease."integration_id" = ${input.integrationId}
      AND lease."user_id" = ${input.userId}
      AND lease."provider" = ${input.provider}
      AND lease."access_mode" = ${input.accessMode}
      AND lease."external_credential_id" = ${lease.externalCredentialId}
      AND lease."external_credential_kind" = ${lease.externalCredentialKind}
      AND lease."external_credential_kind" <> 'pending'
      AND lease."provider_audit_id" = ${providerAuditId}
      AND lease."expires_at" = ${expiresAt}
      AND lease."expires_at" > ${utcNow}
      AND lease."revoked_at" IS NULL
    LIMIT 1
  `);
  return result.length === 1;
}
