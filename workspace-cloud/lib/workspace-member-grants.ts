// Member-centric view of every shared connection's grants: one query joins members,
// their concrete grants (explicit and team-origin), the connections a member could see in
// the ordinary listing, and each member's direct-database principal. The effective access
// mode comes from the same rule publicConnection uses, never from a copy of it.
import "server-only";
import { sql } from "drizzle-orm";
import { queryD1 } from "./d1/database";
import {
  parseWorkspaceMemberGrants,
  type WorkspaceMemberGrantEntry,
  type WorkspaceMemberGrants,
} from "./control-plane-contracts";
import { publicDirectProvisioning } from "./workspace-connections";
import {
  accessModeForConnectionGrant,
  isWorkspaceConnectionCapability,
  isWorkspaceRole,
} from "./workspace-permissions";
import type { DirectFailureCode, DirectLevel, DirectPrincipalState } from "./workspace-direct-access-core";

/**
 * Connections that appear in the ordinary member listing: managed, or member-local with
 * the read-only default intact. Used by the listing and this aggregate so the rule is one.
 */
export const sharedConnectionListable = sql`(workspace_connection.credential_mode = 'managed'
  OR (workspace_connection.credential_mode = 'member_local' AND workspace_connection.readonly_default = 1
    AND workspace_connection.allow_writes = 0))
  AND workspace_connection.deleted_at IS NULL AND workspace_connection.revocation_pending_at IS NULL`;

const MAX_ROWS = 100_000;

type Row = {
  memberId: string;
  role: string;
  revocationPending: number;
  connectionId: string | null;
  capability: string | null;
  origin: string | null;
  provisioningMode: string | null;
  writeCeiling: number | null;
  state: DirectPrincipalState | null;
  appliedLevel: DirectLevel | null;
  principalName: string | null;
  lastSyncedAt: string | null;
  failureCode: DirectFailureCode | null;
};

export async function listWorkspaceMemberGrants(organizationId: string): Promise<WorkspaceMemberGrants> {
  const rows = await queryD1<Row>(sql`
    SELECT member.id AS memberId, member.role AS role,
      (member.revocation_pending_at IS NOT NULL OR member.revocation_claim_id IS NOT NULL) AS revocationPending,
      granted.connection_id AS connectionId, granted.capability AS capability, granted.origin AS origin,
      granted.provisioning_mode AS provisioningMode, granted.write_ceiling AS writeCeiling,
      principal.state AS state, principal.applied_level AS appliedLevel, principal.principal_name AS principalName,
      principal.last_synced_at AS lastSyncedAt, principal.failure_code AS failureCode
    FROM member
    LEFT JOIN (
      SELECT grant.member_id AS member_id, grant.connection_id AS connection_id, grant.capability AS capability,
        grant.origin AS origin, workspace_connection.provisioning_mode AS provisioning_mode,
        endpoint.write_ceiling AS write_ceiling, workspace_connection.created_at AS connection_created_at
      FROM workspace_connection_grant grant
      JOIN workspace_connection ON workspace_connection.organization_id = grant.organization_id
        AND workspace_connection.id = grant.connection_id
      LEFT JOIN workspace_direct_endpoint endpoint ON endpoint.organization_id = grant.organization_id
        AND endpoint.connection_id = grant.connection_id
      WHERE grant.organization_id = ${organizationId} AND ${sharedConnectionListable}
    ) granted ON granted.member_id = member.id
    LEFT JOIN workspace_direct_principal principal ON principal.organization_id = member.organization_id
      AND principal.connection_id = granted.connection_id AND principal.member_id = member.id
      AND principal.state <> 'dropped'
    WHERE member.organization_id = ${organizationId}
    ORDER BY member.created_at, member.id, granted.connection_created_at, granted.connection_id
    LIMIT ${MAX_ROWS}`);
  const members = new Map<string, { memberId: string; role: string; revocationPending: boolean; grants: WorkspaceMemberGrantEntry[] }>();
  for (const row of rows) {
    let entry = members.get(row.memberId);
    if (!entry) {
      entry = { memberId: row.memberId, role: row.role, revocationPending: Boolean(row.revocationPending), grants: [] };
      members.set(row.memberId, entry);
    }
    if (row.connectionId === null || row.capability === null || row.origin === null) continue;
    if (!isWorkspaceRole(row.role) || !isWorkspaceConnectionCapability(row.capability)) continue;
    entry.grants.push({
      connectionId: row.connectionId,
      capability: row.capability,
      origin: row.origin === "team" ? "team" : "explicit",
      effectiveAccessMode: accessModeForConnectionGrant(row.role, row.capability),
      ...(row.provisioningMode === "provisioned" ? {
        provisioning: publicDirectProvisioning({
          writeCeiling: Boolean(row.writeCeiling),
          principal: row.state === null ? null : {
            state: row.state,
            appliedLevel: row.appliedLevel ?? "none",
            principalName: row.principalName ?? "",
            lastSyncedAt: row.lastSyncedAt === null ? null : new Date(row.lastSyncedAt),
            failureCode: row.failureCode,
          },
        }),
      } : {}),
    });
  }
  return parseWorkspaceMemberGrants({ workspaceId: organizationId, members: [...members.values()] });
}
