// D1 helpers for direct shared databases: the derived work list, principal receipt
// compare-and-swap transitions, revocation items and the lowering guard other stores
// embed in their atomic scopes. The member's verifier is the only credential-shaped
// value stored; every transition is a single guarded statement so a stale device or a
// replayed receipt changes nothing. Routes compose these (never raw SQL).
import "server-only";
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { batchD1, queryD1 } from "./d1/database";
import type { MemberAuthority } from "./d1/member-authority";
import { workspaceMemberAuthority } from "./d1/member-authority";
import { utcNow, uuidDefault } from "./d1/schema/values";
import type { DirectConnectionView } from "./workspace-connections";
import {
  capDirectLevel,
  DIRECT_CLAIM_LEASE_SECONDS,
  directDesiredLevel,
  directLevelRank,
  generatePrincipalMarker,
  generatePrincipalName,
  isValidDirectVerifier,
  type DirectFailureCode,
  type DirectLevel,
  type DirectPrincipalState,
  type DirectRevocationKind,
  type DirectEngine,
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
  revocationCap: number | null;
};

function audit(scope: SQL, input: {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  connectionId: string;
  summary: Record<string, string | number | boolean | null>;
}) {
  return sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
    SELECT ${input.organizationId}, ${input.actorUserId}, ${input.action}, 'connection', ${input.connectionId},
      ${JSON.stringify(input.summary)}, ${uuidDefault} FROM (${scope})`;
}

/**
 * Desired level per live principal, derived at read time from the member's concrete
 * grant and role (never stored), then capped by the member's pending revocation items.
 * Principals whose member, grant or connection is gone, or whose member is
 * revocation-pending, are desired `none`.
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
      endpoint.write_ceiling AS writeCeiling, endpoint.scope_revision AS scopeRevision,
      (SELECT min(CASE revocation.target_level WHEN 'none' THEN 0 ELSE 1 END) FROM workspace_direct_revocation revocation
        WHERE revocation.organization_id = principal.organization_id AND revocation.connection_id = principal.connection_id
          AND revocation.member_id = principal.member_id AND revocation.state = 'pending') AS revocationCap
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
  return rows.map(({ role, capability, revocationPendingAt, connectionDeletedAt, writeCeiling, scopeRevision, revocationCap, ...item }) => {
    const desiredLevel = capDirectLevel(directDesiredLevel({
      role: role ?? "",
      capability: capability ?? "",
      writeCeiling: Boolean(writeCeiling),
      memberPresent: role !== null && capability !== null,
      revocationPending: revocationPendingAt !== null,
      connectionDeleted: connectionDeletedAt !== null,
    }), revocationCap === null ? null : revocationCap === 0 ? "none" : "read");
    const claimLive = item.claimExpiresAt !== null && Date.parse(item.claimExpiresAt) > now;
    const claimed = (item.state === "applying" || item.state === "drop_pending") && claimLive;
    const converged = item.state === "ready"
      && item.appliedLevel === desiredLevel
      && item.appliedVerifierVersion >= item.verifierVersion
      && item.scopeRevisionApplied === scopeRevision;
    // A failed receipt waits for an explicit re-request unless it must be dropped; a live
    // claim belongs to its device.
    const action: DirectWorkAction = claimed || (item.state === "failed" && desiredLevel !== "none")
      || (desiredLevel !== "none" && converged)
      ? "idle"
      : desiredLevel === "none" ? "drop" : "apply";
    return { ...item, desiredLevel, action };
  });
}

export type DirectEndpoint = {
  engine: DirectEngine;
  scope: string[];
  scopeRevision: number;
  writeCeiling: boolean;
  serverFingerprint: string | null;
};

/** The endpoint of a live provisioned connection, or null (plain, deleted or foreign id). */
export async function loadDirectEndpoint(organizationId: string, connectionId: string): Promise<DirectEndpoint | null> {
  const [row] = await queryD1<{
    engine: DirectEngine; scope: string; scopeRevision: number; writeCeiling: number; serverFingerprint: string | null;
  }>(sql`SELECT endpoint.engine AS engine, endpoint.scope AS scope, endpoint.scope_revision AS scopeRevision,
      endpoint.write_ceiling AS writeCeiling, endpoint.server_fingerprint AS serverFingerprint
    FROM workspace_direct_endpoint endpoint JOIN workspace_connection connection
      ON connection.organization_id = endpoint.organization_id AND connection.id = endpoint.connection_id
    WHERE endpoint.organization_id = ${organizationId} AND endpoint.connection_id = ${connectionId}
      AND connection.provisioning_mode = 'provisioned' AND connection.deleted_at IS NULL`);
  if (!row) return null;
  return {
    engine: row.engine,
    scope: JSON.parse(row.scope) as string[],
    scopeRevision: Number(row.scopeRevision),
    writeCeiling: Boolean(row.writeCeiling),
    serverFingerprint: row.serverFingerprint,
  };
}

/** Endpoint facts plus one member's live receipt, shaped for publicConnection. */
export async function loadDirectConnectionView(
  organizationId: string,
  connectionId: string,
  memberId: string,
): Promise<DirectConnectionView | null> {
  const [row] = await queryD1<{
    writeCeiling: number; state: DirectPrincipalState | null; appliedLevel: DirectLevel | null; principalName: string | null;
    lastSyncedAt: string | null; failureCode: DirectFailureCode | null;
  }>(sql`SELECT endpoint.write_ceiling AS writeCeiling, principal.state AS state, principal.applied_level AS appliedLevel,
      principal.principal_name AS principalName, principal.last_synced_at AS lastSyncedAt, principal.failure_code AS failureCode
    FROM workspace_direct_endpoint endpoint
    LEFT JOIN workspace_direct_principal principal ON principal.organization_id = endpoint.organization_id
      AND principal.connection_id = endpoint.connection_id AND principal.member_id = ${memberId} AND principal.state <> 'dropped'
    WHERE endpoint.organization_id = ${organizationId} AND endpoint.connection_id = ${connectionId}`);
  if (!row) return null;
  return {
    writeCeiling: Boolean(row.writeCeiling),
    principal: row.state === null ? null : {
      state: row.state,
      appliedLevel: row.appliedLevel ?? "none",
      principalName: row.principalName ?? "",
      lastSyncedAt: row.lastSyncedAt === null ? null : new Date(row.lastSyncedAt),
      failureCode: row.failureCode,
    },
  };
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
  const [live] = await queryD1<{ id: string; state: DirectPrincipalState; verifierVersion: number }>(sql`
    SELECT id, state, verifier_version AS verifierVersion FROM workspace_direct_principal
    WHERE organization_id = ${input.organizationId} AND connection_id = ${input.connectionId}
      AND member_id = ${input.memberId} AND state <> 'dropped'`);
  const summary = { memberId: input.memberId };
  if (!live) {
    const id = randomUUID();
    const results = await batchD1([
      sql`INSERT INTO workspace_direct_principal (id, organization_id, connection_id, member_id, user_id,
          principal_name, marker, verifier_kind, verifier)
        VALUES (${id}, ${input.organizationId}, ${input.connectionId}, ${input.memberId}, ${input.userId},
          ${generatePrincipalName()}, ${generatePrincipalMarker()}, ${input.verifierKind}, ${input.verifier})
        RETURNING id`,
      audit(sql`SELECT 1 FROM workspace_direct_principal WHERE id = ${id}`, {
        organizationId: input.organizationId, actorUserId: input.userId, action: "direct.principal.request",
        connectionId: input.connectionId, summary,
      }),
    ]);
    return results[0][0] ? { principalId: id } : null;
  }
  // A drop already in flight finishes first; the next request starts a fresh receipt.
  const results = await batchD1([
    sql`UPDATE workspace_direct_principal SET verifier = ${input.verifier}, verifier_version = verifier_version + 1,
        state = CASE WHEN state IN ('ready', 'failed') THEN 'requested' ELSE state END,
        failure_code = NULL, updated_at = ${utcNow}
      WHERE id = ${live.id} AND organization_id = ${input.organizationId} AND state IN ('requested', 'ready', 'failed')
        AND verifier_version = ${live.verifierVersion} AND user_id = ${input.userId} AND verifier_kind = ${input.verifierKind}
      RETURNING id`,
    audit(sql`SELECT 1 FROM workspace_direct_principal WHERE id = ${live.id} AND verifier_version = ${live.verifierVersion + 1}`, {
      organizationId: input.organizationId, actorUserId: input.userId, action: "direct.principal.revise",
      connectionId: input.connectionId, summary,
    }),
  ]);
  return results[0][0] ? { principalId: live.id } : null;
}

/**
 * Take (or renew) the device lease on each requested principal that has work for it.
 * The direction comes from the freshly derived work item, never from the caller; a
 * principal another device holds, or with nothing to do, is simply not returned.
 */
export async function claimDirectWork(input: {
  organizationId: string;
  connectionId: string;
  deviceId: string;
  actorUserId: string;
  principalIds: readonly string[];
}): Promise<DirectWorkItem[]> {
  const wanted = new Set(input.principalIds);
  const candidates = (await listDirectWorkItems(input)).filter((item) => wanted.has(item.principalId));
  const claimed: string[] = [];
  for (const item of candidates) {
    const mine = item.appliedByDeviceId === input.deviceId;
    const to = item.action === "apply" ? "applying"
      : item.action === "drop" ? "drop_pending"
      : mine && (item.state === "applying" || item.state === "drop_pending") ? item.state : null;
    if (!to) continue;
    const from = to === "applying"
      ? sql`('requested', 'ready', 'failed', 'applying')`
      : sql`('requested', 'ready', 'failed', 'applying', 'drop_pending')`;
    const result = await atomicD1({
      scope: sql`SELECT '{}' AS payload FROM workspace_direct_principal
        WHERE id = ${item.principalId} AND organization_id = ${input.organizationId} AND connection_id = ${input.connectionId}
          AND state IN ${from}
          AND (state NOT IN ('applying', 'drop_pending') OR applied_by_device_id = ${input.deviceId}
            OR claim_expires_at IS NULL OR claim_expires_at <= ${utcNow})`,
      statements: (scope) => [
        sql`UPDATE workspace_direct_principal SET state = ${to}, applied_by_device_id = ${input.deviceId},
            claim_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${`+${DIRECT_CLAIM_LEASE_SECONDS} seconds`}),
            updated_at = ${utcNow}
          WHERE id = ${item.principalId} AND EXISTS (${scope})`,
        audit(scope, {
          organizationId: input.organizationId, actorUserId: input.actorUserId, action: "direct.principal.claim",
          connectionId: input.connectionId, summary: { principalName: item.principalName, to },
        }),
      ],
    });
    if (result.matched) claimed.push(item.principalId);
  }
  if (claimed.length === 0) return [];
  const live = new Set(claimed);
  return (await listDirectWorkItems(input)).filter((item) => live.has(item.principalId));
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
  actorUserId: string;
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
      audit(scope, {
        organizationId: input.organizationId, actorUserId: input.actorUserId, action: "direct.principal.settle",
        connectionId: input.connectionId,
        summary: { state: receipt.to, level: receipt.appliedLevel, failureCode: receipt.failureCode },
      }),
    ],
  });
  return result.matched && result.rows[1]?.length === 1;
}

// ---- Lowering guard ----------------------------------------------------------
// Any control-plane mutation that lowers a member's effective access on a provisioned
// database is refused until that member's principal is absent or already lowered. Callers
// supply the (connection, member, new level) triples; the check is a plain SQL fragment so
// it is evaluated both before the mutation and again inside its atomic scope.

const LEVEL_RANK_SQL = sql`CASE principal.applied_level WHEN 'write' THEN 2 WHEN 'read' THEN 1 ELSE 0 END`;

export type DirectBlocker = { connectionId: string; memberId: string };

/** Rows `(connection_id, member_id, new_rank)`; a member with no live principal never blocks. */
export function directLoweringBlockers(organizationId: string, targets: SQL) {
  return sql`SELECT target.connection_id AS connectionId, target.member_id AS memberId
    FROM (${targets}) target JOIN workspace_direct_principal principal
      ON principal.organization_id = ${organizationId} AND principal.connection_id = target.connection_id
      AND principal.member_id = target.member_id AND principal.state <> 'dropped'
    WHERE ${LEVEL_RANK_SQL} > target.new_rank
      OR (principal.state = 'applying' AND principal.claim_expires_at > ${utcNow})`;
}

export const directLoweringTargets = {
  /** One member loses (or is lowered to) a level on one connection. */
  grant: (connectionId: string, memberId: string, level: DirectLevel = "none") =>
    sql`SELECT ${connectionId} AS connection_id, ${memberId} AS member_id, ${directLevelRank(level)} AS new_rank`,
  /** One member leaves the workspace: every provisioned connection. */
  member: (organizationId: string, memberId: string) =>
    sql`SELECT id AS connection_id, ${memberId} AS member_id, 0 AS new_rank FROM workspace_connection
      WHERE organization_id = ${organizationId} AND provisioning_mode = 'provisioned'`,
  /** Team read is switched off: every member holding the materialized team grant. */
  teamRead: (organizationId: string, connectionId: string) =>
    sql`SELECT connection_id, member_id, 0 AS new_rank FROM workspace_connection_grant
      WHERE organization_id = ${organizationId} AND connection_id = ${connectionId} AND origin = 'team'`,
  /** The shared database is deleted: every live principal on it. */
  connection: (organizationId: string, connectionId: string) =>
    sql`SELECT connection_id, member_id, 0 AS new_rank FROM workspace_direct_principal
      WHERE organization_id = ${organizationId} AND connection_id = ${connectionId} AND state <> 'dropped'`,
  /** Precomputed `{connectionId, level}` pairs for one member (role changes). */
  levels: (memberId: string, levels: readonly { connectionId: string; level: DirectLevel }[]) =>
    sql`SELECT json_extract(item.value, '$.connectionId') AS connection_id, ${memberId} AS member_id,
        json_extract(item.value, '$.rank') AS new_rank
      FROM json_each(${JSON.stringify(levels.map(({ connectionId, level }) => ({ connectionId, rank: directLevelRank(level) })))}) item`,
};

export async function findDirectLoweringBlockers(organizationId: string, targets: SQL): Promise<DirectBlocker[]> {
  return queryD1<DirectBlocker>(sql`${directLoweringBlockers(organizationId, targets)} LIMIT 100`);
}

/** Atomic-scope predicate: true only while no listed member still holds a higher level. */
export function noDirectLoweringBlockers(organizationId: string, targets: SQL) {
  return sql`NOT EXISTS (${directLoweringBlockers(organizationId, targets)})`;
}

/**
 * Levels a role change would leave one member on each provisioned connection they hold a
 * principal on, restricted to the connections where the change lowers the desired level.
 */
export async function directRoleLowering(input: {
  organizationId: string;
  memberId: string;
  previousRole: string;
  role: string;
}): Promise<{ connectionId: string; level: DirectLevel }[]> {
  const rows = await queryD1<{ connectionId: string; capability: string; writeCeiling: number }>(sql`
    SELECT principal.connection_id AS connectionId, grant.capability AS capability, endpoint.write_ceiling AS writeCeiling
    FROM workspace_direct_principal principal
    JOIN workspace_direct_endpoint endpoint ON endpoint.organization_id = principal.organization_id
      AND endpoint.connection_id = principal.connection_id
    JOIN workspace_connection_grant grant ON grant.organization_id = principal.organization_id
      AND grant.connection_id = principal.connection_id AND grant.member_id = principal.member_id
    WHERE principal.organization_id = ${input.organizationId} AND principal.member_id = ${input.memberId}
      AND principal.state <> 'dropped'`);
  const lowering: { connectionId: string; level: DirectLevel }[] = [];
  for (const row of rows) {
    const common = { capability: row.capability, writeCeiling: Boolean(row.writeCeiling) };
    const level = directDesiredLevel({ ...common, role: input.role });
    if (directLevelRank(level) < directLevelRank(directDesiredLevel({ ...common, role: input.previousRole }))) {
      lowering.push({ connectionId: row.connectionId, level });
    }
  }
  return lowering;
}

// ---- Revocation items --------------------------------------------------------

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

/**
 * Record administrator-declared revocation intent for members that hold a live principal
 * on this connection, deduplicating identical pending items. Returns every matching
 * pending item (existing or new). Self-leave and account deletion are recorded by the
 * database itself when the membership row disappears.
 */
export async function createDirectRevocations(input: {
  organizationId: string;
  connectionId: string;
  authority: MemberAuthority;
  memberIds: readonly string[];
  kind: DirectRevocationKind;
  targetLevel: "none" | "read";
}): Promise<DirectRevocationItem[] | null> {
  const members = JSON.stringify(input.memberIds);
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM workspace_connection connection
      WHERE connection.organization_id = ${input.organizationId} AND connection.id = ${input.connectionId}
        AND connection.provisioning_mode = 'provisioned' AND connection.deleted_at IS NULL
        AND EXISTS (${workspaceMemberAuthority(input.organizationId, input.authority, ["admin", "owner"])})
        AND EXISTS (SELECT 1 FROM workspace_connection_grant WHERE organization_id = ${input.organizationId}
          AND connection_id = ${input.connectionId} AND member_id = ${input.authority.membershipId} AND capability = 'manage')`,
    statements: (scope) => [
      sql`INSERT INTO workspace_direct_revocation (organization_id, connection_id, member_id, kind, target_level, requested_by_user_id)
        SELECT ${input.organizationId}, ${input.connectionId}, principal.member_id, ${input.kind}, ${input.targetLevel},
          ${input.authority.userId}
        FROM workspace_direct_principal principal, (${scope}) scope
        WHERE principal.organization_id = ${input.organizationId} AND principal.connection_id = ${input.connectionId}
          AND principal.state <> 'dropped'
          AND principal.member_id IN (SELECT value FROM json_each(${members}))
          AND NOT EXISTS (SELECT 1 FROM workspace_direct_revocation pending
            WHERE pending.organization_id = principal.organization_id AND pending.connection_id = principal.connection_id
              AND pending.member_id = principal.member_id AND pending.state = 'pending'
              AND pending.kind = ${input.kind} AND pending.target_level = ${input.targetLevel})`,
      audit(scope, {
        organizationId: input.organizationId, actorUserId: input.authority.userId, action: "direct.revocation.create",
        connectionId: input.connectionId, summary: { kind: input.kind, targetLevel: input.targetLevel, members: input.memberIds.length },
      }),
    ],
  });
  if (!result.matched) return null;
  const members_ = new Set(input.memberIds);
  return (await listPendingDirectRevocations({ organizationId: input.organizationId, connectionId: input.connectionId }))
    .filter((item) => members_.has(item.memberId) && item.kind === input.kind && item.targetLevel === input.targetLevel);
}

const revocationColumns = sql`revocation.id AS id, revocation.connection_id AS connectionId, revocation.member_id AS memberId,
  (SELECT principal.principal_name FROM workspace_direct_principal principal
    WHERE principal.organization_id = revocation.organization_id AND principal.connection_id = revocation.connection_id
      AND principal.member_id = revocation.member_id AND principal.state <> 'dropped' LIMIT 1) AS principalName,
  revocation.kind AS kind, revocation.target_level AS targetLevel, revocation.state AS state,
  revocation.created_at AS createdAt`;

/** Pending items of one connection, or of the whole workspace when no connection is given. */
export async function listPendingDirectRevocations(input: {
  organizationId: string;
  connectionId?: string;
}): Promise<DirectRevocationItem[]> {
  return queryD1<DirectRevocationItem>(sql`
    SELECT ${revocationColumns} FROM workspace_direct_revocation revocation
    WHERE revocation.organization_id = ${input.organizationId} AND revocation.state = 'pending'
      ${input.connectionId ? sql`AND revocation.connection_id = ${input.connectionId}` : sql``}
    ORDER BY revocation.created_at, revocation.id LIMIT 1000`);
}

export async function loadDirectRevocation(organizationId: string, revocationId: string): Promise<DirectRevocationItem | null> {
  const [item] = await queryD1<DirectRevocationItem>(sql`
    SELECT ${revocationColumns} FROM workspace_direct_revocation revocation
    WHERE revocation.organization_id = ${organizationId} AND revocation.id = ${revocationId}`);
  return item ?? null;
}

/** Whether the member has a pending item on this connection (their access is being revoked). */
export async function hasPendingDirectRevocation(organizationId: string, connectionId: string, memberId: string) {
  const [row] = await queryD1<{ present: number }>(sql`SELECT 1 AS present FROM workspace_direct_revocation
    WHERE organization_id = ${organizationId} AND connection_id = ${connectionId} AND member_id = ${memberId}
      AND state = 'pending' LIMIT 1`);
  return Boolean(row);
}

/**
 * pending -> cancelled always; pending -> applied only once the guard would let the
 * member's access stand lowered (principal absent, dropped or at most the target level).
 */
export async function settleDirectRevocation(input: {
  organizationId: string;
  connectionId: string;
  revocationId: string;
  actorUserId: string;
  to: "applied" | "cancelled";
}): Promise<boolean> {
  const satisfied = input.to === "cancelled" ? sql`TRUE` : noDirectLoweringBlockers(input.organizationId, sql`
    SELECT revocation.connection_id AS connection_id, revocation.member_id AS member_id,
      CASE revocation.target_level WHEN 'read' THEN 1 ELSE 0 END AS new_rank
    FROM workspace_direct_revocation revocation WHERE revocation.id = ${input.revocationId}`);
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM workspace_direct_revocation revocation
      WHERE revocation.id = ${input.revocationId} AND revocation.organization_id = ${input.organizationId}
        AND revocation.connection_id = ${input.connectionId} AND revocation.state = 'pending' AND ${satisfied}`,
    statements: (scope) => [
      sql`UPDATE workspace_direct_revocation SET state = ${input.to}, updated_at = ${utcNow}
        WHERE id = ${input.revocationId} AND EXISTS (${scope}) RETURNING id`,
      audit(scope, {
        organizationId: input.organizationId, actorUserId: input.actorUserId, action: "direct.revocation.settle",
        connectionId: input.connectionId, summary: { state: input.to },
      }),
    ],
  });
  return result.matched && result.rows[0]?.length === 1;
}
