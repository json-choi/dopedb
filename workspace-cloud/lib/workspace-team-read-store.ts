// Manager-owned team-read policy materializes ordinary grants. Disabling it is
// allowed only after the connection revocation gate has drained every lease.
import "server-only";
import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { workspaceMemberAuthority, type MemberAuthority } from "./d1/member-authority";
import { utcNow, uuidDefault } from "./d1/schema/values";

export async function setWorkspaceTeamRead(input: {
  organizationId: string; connectionId: string; authority: MemberAuthority;
  enabled: boolean; claimId?: string; revision?: number;
}) {
  const gate = input.enabled
    ? sql`connection.revocation_pending_at IS NULL AND connection.revocation_claim_id IS NULL`
    : sql`connection.revocation_claim_id = ${input.claimId ?? null}
        AND connection.revision = ${input.revision ?? null}
        AND NOT EXISTS (SELECT 1 FROM workspace_credential_lease WHERE organization_id = ${input.organizationId}
          AND connection_id = ${input.connectionId} AND revoked_at IS NULL)`;
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM workspace_connection connection
      WHERE connection.organization_id = ${input.organizationId} AND connection.id = ${input.connectionId}
        AND connection.credential_mode = 'managed' AND connection.deleted_at IS NULL AND ${gate}
        AND EXISTS (${workspaceMemberAuthority(input.organizationId, input.authority, ["admin", "owner"])})
        AND EXISTS (SELECT 1 FROM workspace_connection_grant WHERE organization_id = ${input.organizationId}
          AND connection_id = ${input.connectionId} AND member_id = ${input.authority.membershipId} AND capability = 'manage')`,
    statements: (scope) => [
      sql`UPDATE workspace_connection SET team_read_enabled = ${input.enabled}, revision = revision + 1,
          updated_at = ${utcNow}, revocation_pending_at = NULL, revocation_claimed_at = NULL, revocation_claim_id = NULL
        WHERE organization_id = ${input.organizationId} AND id = ${input.connectionId} AND EXISTS (${scope})
        RETURNING team_read_enabled AS teamReadEnabled`,
      sql`DELETE FROM workspace_connection_grant WHERE organization_id = ${input.organizationId}
        AND connection_id = ${input.connectionId} AND origin = 'team' AND ${!input.enabled} AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'connection.team_read.update', 'connection', ${input.connectionId},
          json_object('enabled', json(${input.enabled ? "true" : "false"})), ${uuidDefault} FROM (${scope})`,
    ],
  });
  return result.matched;
}
