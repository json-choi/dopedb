import "server-only";
import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { workspaceMemberAuthority, type MemberAuthority } from "./d1/member-authority";
import { utcNow, uuidDefault } from "./d1/schema/values";

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
        ON CONFLICT (organization_id, connection_id, member_id) DO UPDATE SET capability = excluded.capability, updated_at = ${utcNow}
        RETURNING capability`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'connection.grant.update', 'connection', ${input.connectionId},
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
        AND NOT EXISTS (SELECT 1 FROM workspace_credential_lease WHERE organization_id = ${input.organizationId}
          AND connection_id = ${input.connectionId} AND user_id = ${input.userId} AND revoked_at IS NULL)`,
    statements: (scope) => [
      sql`DELETE FROM workspace_connection_grant WHERE organization_id = ${input.organizationId} AND connection_id = ${input.connectionId}
        AND member_id = ${input.memberId} AND EXISTS (${scope}) RETURNING member_id AS memberId`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'connection.grant.revoke', 'connection', ${input.connectionId},
          json_object('memberId', ${input.memberId}), ${uuidDefault} FROM (${scope})`,
    ],
  });
  return result.rows[0] as { memberId: string }[];
}
