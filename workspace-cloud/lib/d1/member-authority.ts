import { sql } from "drizzle-orm";
import { utcNow } from "./schema/values";
import type { WorkspaceRoleName } from "../workspace-permissions";

export type MemberAuthority = Readonly<{
  sessionId: string; userId: string; membershipId: string; role: string;
}>;

/** Consume in the same statement or atomic batch as the authorized operation. */
export function workspaceMemberAuthority(organizationId: string, authority: MemberAuthority, roles: readonly WorkspaceRoleName[]) {
  return sql`SELECT member.id, member.role FROM session JOIN member ON member.user_id = session.user_id
    JOIN workspace_profile profile ON profile.organization_id = member.organization_id
    WHERE session.id = ${authority.sessionId} AND session.user_id = ${authority.userId} AND session.expires_at > ${utcNow}
      AND member.id = ${authority.membershipId} AND member.organization_id = ${organizationId}
      AND member.role = ${authority.role} AND member.role IN (SELECT value FROM json_each(${JSON.stringify(roles)}))
      AND member.revocation_pending_at IS NULL AND member.revocation_claim_id IS NULL AND profile.lifecycle_state = 'active'`;
}
