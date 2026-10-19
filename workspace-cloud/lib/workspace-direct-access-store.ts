// D1 helpers for direct shared databases: the derived work list, principal receipt
// compare-and-swap transitions, and revocation items. The member's verifier is the only
// credential-shaped value stored; every transition is a single guarded statement so a
// stale device or a replayed receipt changes nothing. Routes compose these (never raw SQL).
import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { queryD1 } from "./d1/database";
import { utcNow } from "./d1/schema/values";
import {
  DIRECT_CLAIM_LEASE_SECONDS,
  directDesiredLevel,
  generatePrincipalMarker,
  generatePrincipalName,
  isValidDirectVerifier,
  type DirectFailureCode,
  type DirectLevel,
  type DirectPrincipalState,
  type DirectRevocationKind,
  type DirectVerifierKind,
} from "./workspace-direct-access-core";

export type DirectWorkAction = "apply" | "drop" | "idle";

export type DirectWorkItem = {
  principalId: string;
  memberId: string;
  userId: string;
  principalName: string;
  marker: string;
  verifierKind: DirectVerifierKind;
  verifier: string;
  verifierVersion: number;
  appliedVerifierVersion: number;
  appliedLevel: DirectLevel;
  desiredLevel: DirectLevel;
  state: DirectPrincipalState;
  scopeRevisionApplied: number | null;
  serverRoleOid: string | null;
  claimExpiresAt: string | null;
  appliedByDeviceId: string | null;
  action: DirectWorkAction;
};

type WorkRow = Omit<DirectWorkItem, "desiredLevel" | "action"> & {
  role: string | null;
  capability: string | null;
  revocationPendingAt: string | null;
  connectionDeletedAt: string | null;
  writeCeiling: number;
  scopeRevision: number;
};

/**
 * Desired level per live principal, derived at read time from the member's concrete
 * grant and role (never stored). Principals whose member, grant or connection is gone,
 * or whose member is revocation-pending, are desired `none`.
 */
export async function listDirectWorkItems(input: {
  organizationId: string;
  connectionId: string;
}): Promise<DirectWorkItem[]> {
  const rows = await queryD1<WorkRow>(sql`
    SELECT principal.id AS principalId, principal.member_id AS memberId, principal.user_id AS userId,
      principal.principal_name AS principalName, principal.marker AS marker,
      principal.verifier_kind AS verifierKind, principal.verifier AS verifier,
      principal.verifier_version AS verifierVersion, principal.applied_verifier_version AS appliedVerifierVersion,
      principal.applied_level AS appliedLevel, principal.state AS state,
      principal.scope_revision_applied AS scopeRevisionApplied, principal.server_role_oid AS serverRoleOid,
      principal.claim_expires_at AS claimExpiresAt, principal.applied_by_device_id AS appliedByDeviceId,
      member.role AS role, grant.capability AS capability,
      member.revocation_pending_at AS revocationPendingAt,
      connection.deleted_at AS connectionDeletedAt,
      endpoint.write_ceiling AS writeCeiling, endpoint.scope_revision AS scopeRevision
    FROM workspace_direct_principal principal
    JOIN workspace_direct_endpoint endpoint ON endpoint.organization_id = principal.organization_id
      AND endpoint.connection_id = principal.connection_id
    JOIN workspace_connection connection ON connection.organization_id = principal.organization_id
      AND connection.id = principal.connection_id
    LEFT JOIN member ON member.organization_id = principal.organization_id
      AND member.id = principal.member_id AND member.user_id = principal.user_id
    LEFT JOIN workspace_connection_grant grant ON grant.organization_id = principal.organization_id
      AND grant.connection_id = principal.connection_id AND grant.member_id = principal.member_id
    WHERE principal.organization_id = ${input.organizationId} AND principal.connection_id = ${input.connectionId}
      AND principal.state <> 'dropped'
    ORDER BY principal.created_at, principal.id
    LIMIT 1000`);
  const now = Date.now();
  return rows.map(({ role, capability, revocationPendingAt, connectionDeletedAt, writeCeiling, scopeRevision, ...item }) => {
    const desiredLevel = directDesiredLevel({
      role: role ?? "",
      capability: capability ?? "",
      writeCeiling: Boolean(writeCeiling),
      memberPresent: role !== null && capability !== null,
      revocationPending: revocationPendingAt !== null,
      connectionDeleted: connectionDeletedAt !== null,
    });
    const claimLive = item.claimExpiresAt !== null && Date.parse(item.claimExpiresAt) > now;
    const claimed = (item.state === "applying" || item.state === "drop_pending") && claimLive;
    const converged = item.state === "ready"
      && item.appliedLevel === desiredLevel
      && item.appliedVerifierVersion >= item.verifierVersion
      && item.scopeRevisionApplied === scopeRevision;
    // A failed receipt waits for an explicit re-request; a live claim belongs to its device.
    const action: DirectWorkAction = claimed || item.state === "failed" || (desiredLevel !== "none" && converged)
      ? "idle"
      : desiredLevel === "none" ? "drop" : "apply";
    return { ...item, desiredLevel, action };
  });
}

/** Create the caller's receipt, or replace the verifier of a live one (version + 1). */
export async function submitDirectVerifier(input: {
  organizationId: string;
  connectionId: string;
  memberId: string;
  userId: string;
  verifierKind: DirectVerifierKind;
  verifier: string;
}): Promise<{ principalId: string } | null> {
  if (!isValidDirectVerifier(input.verifierKind, input.verifier)) return null;
  const [live] = await queryD1<{ id: string; state: DirectPrincipalState }>(sql`
    SELECT id, state FROM workspace_direct_principal
    WHERE organization_id = ${input.organizationId} AND connection_id = ${input.connectionId}
      AND member_id = ${input.memberId} AND state <> 'dropped'`);
  if (!live) {
    const id = randomUUID();
    const rows = await queryD1<{ id: string }>(sql`
      INSERT INTO workspace_direct_principal (id, organization_id, connection_id, member_id, user_id,
        principal_name, marker, verifier_kind, verifier)
      VALUES (${id}, ${input.organizationId}, ${input.connectionId}, ${input.memberId}, ${input.userId},
        ${generatePrincipalName()}, ${generatePrincipalMarker()}, ${input.verifierKind}, ${input.verifier})
      RETURNING id`);
    return rows[0] ? { principalId: rows[0].id } : null;
  }
  // A drop already in flight finishes first; the next request starts a fresh receipt.
  const rows = await queryD1<{ id: string }>(sql`
    UPDATE workspace_direct_principal SET verifier = ${input.verifier}, verifier_version = verifier_version + 1,
      state = CASE WHEN state IN ('ready', 'failed') THEN 'requested' ELSE state END,
      failure_code = NULL, updated_at = ${utcNow}
    WHERE id = ${live.id} AND organization_id = ${input.organizationId} AND state IN ('requested', 'ready', 'failed')
      AND user_id = ${input.userId} AND verifier_kind = ${input.verifierKind}
    RETURNING id`);
  return rows[0] ? { principalId: rows[0].id } : null;
}

/** Take (or renew) the device lease before touching the database; null when another device holds it. */
export async function claimDirectPrincipal(input: {
  organizationId: string;
  connectionId: string;
  principalId: string;
  deviceId: string;
  to: "applying" | "drop_pending";
}): Promise<boolean> {
  const from = input.to === "applying"
    ? sql`('requested', 'ready', 'failed', 'applying')`
    : sql`('requested', 'ready', 'failed', 'applying', 'drop_pending')`;
  const rows = await queryD1<{ id: string }>(sql`
    UPDATE workspace_direct_principal SET state = ${input.to}, applied_by_device_id = ${input.deviceId},
      claim_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${`+${DIRECT_CLAIM_LEASE_SECONDS} seconds`}),
      updated_at = ${utcNow}
    WHERE id = ${input.principalId} AND organization_id = ${input.organizationId}
      AND connection_id = ${input.connectionId} AND state IN ${from}
      AND (state NOT IN ('applying', 'drop_pending') OR applied_by_device_id = ${input.deviceId}
        OR claim_expires_at IS NULL OR claim_expires_at <= ${utcNow})
    RETURNING id`);
  return rows.length === 1;
}

export type DirectReceipt = {
  principalId: string;
  deviceId: string;
  from: "applying" | "drop_pending";
  to: "ready" | "failed" | "dropped";
  appliedLevel: DirectLevel;
  appliedVerifierVersion: number;
  scopeRevisionApplied: number | null;
  serverRoleOid: string | null;
  serverFingerprint: string | null;
  failureCode: DirectFailureCode | null;
};

/**
 * Settle a claimed receipt. The claim holder, the expected previous state and (for
 * `ready`) the endpoint fingerprint are checked in the same atomic batch; the first
 * successful apply binds the fingerprint and later mismatches are refused.
 */
export async function settleDirectReceipt(input: {
  organizationId: string;
  connectionId: string;
  receipt: DirectReceipt;
}): Promise<boolean> {
  const { receipt } = input;
  const validShape = (receipt.from === "applying" && (receipt.to === "ready" || receipt.to === "failed"))
    || (receipt.from === "drop_pending" && (receipt.to === "dropped" || receipt.to === "failed"));
  if (!validShape || (receipt.to === "failed") !== (receipt.failureCode !== null)) return false;
  if (receipt.to === "ready" && (receipt.appliedLevel === "none" || !receipt.serverRoleOid)) return false;
  if (receipt.to === "dropped" && receipt.appliedLevel !== "none") return false;
  const fingerprint = receipt.serverFingerprint;
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM workspace_direct_principal principal
      JOIN workspace_direct_endpoint endpoint ON endpoint.organization_id = principal.organization_id
        AND endpoint.connection_id = principal.connection_id
      WHERE principal.id = ${receipt.principalId} AND principal.organization_id = ${input.organizationId}
        AND principal.connection_id = ${input.connectionId} AND principal.state = ${receipt.from}
        AND principal.applied_by_device_id = ${receipt.deviceId}
        AND ${receipt.appliedVerifierVersion} <= principal.verifier_version
        AND (${fingerprint} IS NULL OR endpoint.server_fingerprint IS NULL OR endpoint.server_fingerprint = ${fingerprint})
        AND (${receipt.to === "ready"} = 0 OR ${fingerprint} IS NOT NULL)`,
    statements: (scope) => [
      sql`UPDATE workspace_direct_endpoint SET server_fingerprint = ${fingerprint}, updated_at = ${utcNow}
        WHERE organization_id = ${input.organizationId} AND connection_id = ${input.connectionId}
          AND server_fingerprint IS NULL AND ${fingerprint} IS NOT NULL AND EXISTS (${scope})`,
      sql`UPDATE workspace_direct_principal SET state = ${receipt.to}, applied_level = ${receipt.appliedLevel},
          applied_verifier_version = ${receipt.appliedVerifierVersion},
          scope_revision_applied = ${receipt.scopeRevisionApplied},
          server_role_oid = COALESCE(${receipt.serverRoleOid}, server_role_oid),
          failure_code = ${receipt.failureCode}, claim_expires_at = NULL,
          last_synced_at = ${utcNow}, updated_at = ${utcNow}
        WHERE id = ${receipt.principalId} AND state = ${receipt.from} AND EXISTS (${scope})
        RETURNING id`,
    ],
  });
  return result.matched && result.rows[1]?.length === 1;
}

export type DirectRevocationItem = {
  id: string;
  connectionId: string;
  memberId: string;
  principalName: string | null;
  kind: DirectRevocationKind;
  targetLevel: "none" | "read";
  state: "pending" | "applied" | "cancelled";
  createdAt: string;
};

/** Record a revocation that an administrator device must apply later (self-leave, account deletion, no credential). */
export async function createDirectRevocation(input: {
  organizationId: string;
  connectionId: string;
  memberId: string;
  kind: DirectRevocationKind;
  targetLevel: "none" | "read";
  requestedByUserId: string | null;
}): Promise<string | null> {
  const rows = await queryD1<{ id: string }>(sql`
    INSERT INTO workspace_direct_revocation (organization_id, connection_id, member_id, kind, target_level, requested_by_user_id)
    SELECT ${input.organizationId}, ${input.connectionId}, ${input.memberId}, ${input.kind}, ${input.targetLevel},
      ${input.requestedByUserId}
    WHERE NOT EXISTS (SELECT 1 FROM workspace_direct_revocation
      WHERE organization_id = ${input.organizationId} AND connection_id = ${input.connectionId}
        AND member_id = ${input.memberId} AND state = 'pending' AND kind = ${input.kind}
        AND target_level = ${input.targetLevel})
    RETURNING id`);
  return rows[0]?.id ?? null;
}

export async function listPendingDirectRevocations(input: {
  organizationId: string;
  connectionId: string;
}): Promise<DirectRevocationItem[]> {
  return queryD1<DirectRevocationItem>(sql`
    SELECT revocation.id AS id, revocation.connection_id AS connectionId, revocation.member_id AS memberId,
      (SELECT principal.principal_name FROM workspace_direct_principal principal
        WHERE principal.organization_id = revocation.organization_id AND principal.connection_id = revocation.connection_id
          AND principal.member_id = revocation.member_id AND principal.state <> 'dropped' LIMIT 1) AS principalName,
      revocation.kind AS kind, revocation.target_level AS targetLevel, revocation.state AS state,
      revocation.created_at AS createdAt
    FROM workspace_direct_revocation revocation
    WHERE revocation.organization_id = ${input.organizationId} AND revocation.connection_id = ${input.connectionId}
      AND revocation.state = 'pending'
    ORDER BY revocation.created_at, revocation.id LIMIT 1000`);
}

/** pending -> applied/cancelled exactly once; false for a settled or foreign item. */
export async function settleDirectRevocation(input: {
  organizationId: string;
  connectionId: string;
  revocationId: string;
  to: "applied" | "cancelled";
}): Promise<boolean> {
  const rows = await queryD1<{ id: string }>(sql`
    UPDATE workspace_direct_revocation SET state = ${input.to}, updated_at = ${utcNow}
    WHERE id = ${input.revocationId} AND organization_id = ${input.organizationId}
      AND connection_id = ${input.connectionId} AND state = 'pending'
    RETURNING id`);
  return rows.length === 1;
}
