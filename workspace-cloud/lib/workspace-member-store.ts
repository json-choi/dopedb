import "server-only";
import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { workspaceMemberAuthority, type MemberAuthority } from "./d1/member-authority";
import { uuidDefault } from "./d1/schema/values";

export async function changeWorkspaceMemberRole(input: {
  organizationId: string; authority: MemberAuthority; memberId: string; userId: string; claimId: string;
  previousRole: string; role: "viewer" | "analyst" | "editor" | "admin";
  revokedLeases: number; deferredRevocations: number;
}) {
  const canOwn = ["editor", "admin"].includes(input.role);
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM member target
      WHERE target.id = ${input.memberId} AND target.organization_id = ${input.organizationId} AND target.user_id = ${input.userId}
        AND target.role = ${input.previousRole} AND target.role <> 'owner' AND target.revocation_claim_id = ${input.claimId}
        AND target.revocation_pending_at IS NOT NULL
        AND EXISTS (${workspaceMemberAuthority(input.organizationId, input.authority, ["admin", "owner"])})
        AND (${canOwn} OR NOT EXISTS (SELECT 1 FROM workspace_analysis_article WHERE organization_id = ${input.organizationId}
          AND owner_member_id = ${input.memberId} AND deleted_at IS NULL))
        AND NOT EXISTS (SELECT 1 FROM workspace_credential_lease WHERE organization_id = ${input.organizationId}
          AND user_id = ${input.userId} AND revoked_at IS NULL)`,
    statements: (scope) => [
      sql`UPDATE member SET role = ${input.role}, revocation_pending_at = NULL, revocation_claimed_at = NULL, revocation_claim_id = NULL
        WHERE id = ${input.memberId} AND organization_id = ${input.organizationId} AND EXISTS (${scope})
        RETURNING id, organization_id AS organizationId, user_id AS userId, role, created_at AS createdAt`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'member.role.update', 'member', ${input.memberId},
          json_object('from', ${input.previousRole}, 'to', ${input.role}, 'revokedLeases', ${input.revokedLeases},
            'deferredRevocations', ${input.deferredRevocations}), ${uuidDefault} FROM (${scope})`,
    ],
  });
  return result.rows[0] as { id: string; organizationId: string; userId: string; role: string; createdAt: string }[];
}
