// Explicit grants override team defaults; removals preserve a user-bound exclusion.
import "server-only";
import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { workspaceMemberAuthority, type MemberAuthority } from "./d1/member-authority";
import { utcNow, uuidDefault } from "./d1/schema/values";
import type { DirectLevel } from "./workspace-direct-access-core";
import {
  directLoweringTargets, directSettlePairs, noDirectLoweringBlockers, settleDirectRevocationsAfterMutation,
} from "./workspace-direct-access-store";

type GrantCapability = "view" | "read" | "use" | "manage";
type GrantMutation = { organizationId: string; connectionId: string; authority: MemberAuthority; memberId: string };

function managerAuthority(input: GrantMutation) {
  return sql`SELECT actor.id FROM (${workspaceMemberAuthority(input.organizationId, input.authority, ["viewer", "analyst", "editor", "admin", "owner"])}) actor
    JOIN workspace_connection_grant grant ON grant.member_id = actor.id
    JOIN workspace_connection connection ON connection.id = grant.connection_id AND connection.organization_id = grant.organization_id
    WHERE grant.organization_id = ${input.organizationId} AND grant.connection_id = ${input.connectionId}
      AND grant.capability = 'manage' AND connection.deleted_at IS NULL`;
}

export async function increaseConnectionGrant(input: GrantMutation & { capability: GrantCapability }) {
  const rank = { view: 0, read: 1, use: 2, manage: 3 };
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM member WHERE id = ${input.memberId} AND organization_id = ${input.organizationId}
      AND revocation_pending_at IS NULL AND revocation_claim_id IS NULL AND EXISTS (${managerAuthority(input)})
      AND (${input.memberId} <> ${input.authority.membershipId} OR ${input.capability} = 'manage')
      AND NOT EXISTS (SELECT 1 FROM workspace_connection_grant WHERE organization_id = ${input.organizationId}
        AND connection_id = ${input.connectionId} AND member_id = ${input.memberId}
        AND CASE capability WHEN 'view' THEN 0 WHEN 'read' THEN 1 WHEN 'use' THEN 2 ELSE 3 END > ${rank[input.capability]})`,
    statements: (scope) => [
      sql`INSERT INTO workspace_connection_grant (organization_id, connection_id, member_id, capability)
        SELECT ${input.organizationId}, ${input.connectionId}, ${input.memberId}, ${input.capability} FROM (${scope}) WHERE TRUE
        ON CONFLICT (organization_id, connection_id, member_id) DO UPDATE SET capability = excluded.capability, origin = 'explicit', updated_at = ${utcNow}
        RETURNING capability`,
      sql`DELETE FROM workspace_connection_access_exclusion WHERE organization_id = ${input.organizationId}
        AND connection_id = ${input.connectionId}
        AND user_id = (SELECT user_id FROM member WHERE id = ${input.memberId} AND organization_id = ${input.organizationId})
        AND EXISTS (${scope})`,
      settleDirectRevocationsAfterMutation(input.organizationId, scope, directSettlePairs.grant(input.connectionId, input.memberId)),
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'connection.grant.update', 'connection', ${input.connectionId},
          json_object('memberId', ${input.memberId}, 'capability', ${input.capability}), ${uuidDefault} FROM (${scope})`,
    ],
  });
  return result.rows[0] as { capability: GrantCapability }[];
}

/**
 * Lower an existing grant to a strictly lower capability without removing it, so a
 * provisioned member keeps their database account. `newLevel` is the direct level the
 * member's role and the new capability yield; the lowering guard evaluates the principal's
 * applied level against it inside the atomic scope. `claimId` is the member revocation
 * gate and is required only while managed leases may exist (never for provisioned
 * databases, where the gate would read as full revocation).
 */
export async function lowerConnectionGrant(input: GrantMutation & {
  capability: GrantCapability;
  memberRole: string;
  newLevel: DirectLevel;
  claimId: string | null;
  userId: string;
}) {
  const rank = { view: 0, read: 1, use: 2, manage: 3 };
  const caseRank = sql`CASE grant.capability WHEN 'view' THEN 0 WHEN 'read' THEN 1 WHEN 'use' THEN 2 ELSE 3 END`;
  const gateOpen = input.claimId === null
    ? sql`target.revocation_pending_at IS NULL AND target.revocation_claim_id IS NULL`
    : sql`target.revocation_pending_at IS NOT NULL AND target.revocation_claim_id = ${input.claimId}`;
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM member target JOIN workspace_connection_grant grant ON grant.member_id = target.id
      AND grant.organization_id = target.organization_id AND grant.connection_id = ${input.connectionId}
      WHERE target.id = ${input.memberId} AND target.organization_id = ${input.organizationId} AND target.user_id = ${input.userId}
        AND target.role = ${input.memberRole} AND target.id <> ${input.authority.membershipId} AND ${gateOpen}
        AND EXISTS (${managerAuthority(input)})
        AND ${caseRank} > ${rank[input.capability]}
        AND ${noDirectLoweringBlockers(input.organizationId, directLoweringTargets.grant(input.connectionId, input.memberId, input.newLevel))}
        AND NOT EXISTS (SELECT 1 FROM workspace_credential_lease WHERE organization_id = ${input.organizationId}
          AND connection_id = ${input.connectionId} AND user_id = ${input.userId} AND revoked_at IS NULL)`,
    statements: (scope) => [
      sql`UPDATE workspace_connection_grant SET capability = ${input.capability}, origin = 'explicit', updated_at = ${utcNow}
        WHERE organization_id = ${input.organizationId} AND connection_id = ${input.connectionId}
        AND member_id = ${input.memberId} AND EXISTS (${scope}) RETURNING capability`,
      settleDirectRevocationsAfterMutation(input.organizationId, scope, directSettlePairs.grant(input.connectionId, input.memberId)),
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'connection.grant.lower', 'connection', ${input.connectionId},
          json_object('memberId', ${input.memberId}, 'capability', ${input.capability}), ${uuidDefault} FROM (${scope})`,
    ],
  });
  return result.rows[0] as { capability: GrantCapability }[];
}

export async function removeConnectionGrant(input: GrantMutation & { claimId: string; userId: string }) {
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM member target JOIN workspace_connection_grant grant ON grant.member_id = target.id
      AND grant.organization_id = target.organization_id AND grant.connection_id = ${input.connectionId}
      WHERE target.id = ${input.memberId} AND target.organization_id = ${input.organizationId} AND target.user_id = ${input.userId}
        AND target.id <> ${input.authority.membershipId} AND target.revocation_pending_at IS NOT NULL AND target.revocation_claim_id = ${input.claimId}
        AND EXISTS (${managerAuthority(input)})
        AND ${noDirectLoweringBlockers(input.organizationId, directLoweringTargets.grant(input.connectionId, input.memberId))}
        AND NOT EXISTS (SELECT 1 FROM workspace_credential_lease WHERE organization_id = ${input.organizationId}
          AND connection_id = ${input.connectionId} AND user_id = ${input.userId} AND revoked_at IS NULL)`,
    statements: (scope) => [
      sql`INSERT OR IGNORE INTO workspace_connection_access_exclusion (organization_id, connection_id, user_id)
        SELECT ${input.organizationId}, ${input.connectionId}, ${input.userId} FROM (${scope})`,
      sql`DELETE FROM workspace_connection_grant WHERE organization_id = ${input.organizationId} AND connection_id = ${input.connectionId}
        AND member_id = ${input.memberId} AND EXISTS (${scope}) RETURNING member_id AS memberId`,
      settleDirectRevocationsAfterMutation(input.organizationId, scope, directSettlePairs.grant(input.connectionId, input.memberId)),
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'connection.grant.revoke', 'connection', ${input.connectionId},
          json_object('memberId', ${input.memberId}), ${uuidDefault} FROM (${scope})`,
    ],
  });
  return result.rows[1] as { memberId: string }[];
}
