import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { ProviderMutationAuthority } from "./provider-integrations/authority";
import { increaseConnectionGrant, removeConnectionGrant } from "./workspace-grant-store";
import { changeWorkspaceMemberRole } from "./workspace-member-store";
import { disableWorkspaceManagedAccess } from "./workspace-managed-mode-store";
import { claimRevocationGate, clearRevocationGate } from "./revocation-gates";
import { inD1Strings } from "./d1/json";
import { queryD1 } from "./d1/database";
import { sql } from "drizzle-orm";
import { databaseErrorCode, isUniqueDatabaseConflict } from "./workspace-server-log";

export async function verifyD1PermissionChanges(db: D1Database, authority: ProviderMutationAuthority, connectionId: string) {
  const organizationId = authority.organizationId; const userId = randomUUID(); const memberId = randomUUID();
  await db.batch([
    db.prepare("INSERT INTO user (id, name, email) VALUES (?, 'Grant fixture', ?)").bind(userId, `${userId}@invalid.test`),
    db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'viewer')").bind(memberId, organizationId, userId),
  ]);
  const input = { organizationId, connectionId, authority, memberId };
  expect(await increaseConnectionGrant({ ...input, capability: "read" })).toEqual([{ capability: "read" }]);
  expect(await increaseConnectionGrant({ ...input, capability: "view" })).toEqual([]);
  expect(await increaseConnectionGrant({ ...input, memberId: authority.membershipId, capability: "view" })).toEqual([]);
  const claim = await claimRevocationGate({ kind: "member", organizationId, memberId, userId });
  expect(await increaseConnectionGrant({ ...input, capability: "manage" })).toEqual([]);
  expect(await removeConnectionGrant({ ...input, userId, claimId: randomUUID() })).toEqual([]);
  expect(await removeConnectionGrant({ ...input, userId, claimId: claim!.claimId })).toEqual([{ memberId }]);
  expect(await clearRevocationGate(claim!)).toBe(true);
  const roleClaim = await claimRevocationGate({ kind: "member", organizationId, memberId, userId });
  const roleInput = { organizationId, authority, memberId, userId, claimId: roleClaim!.claimId, previousRole: "viewer",
    role: "analyst" as const, revokedLeases: 0, deferredRevocations: 0 };
  expect(await changeWorkspaceMemberRole({ ...roleInput, claimId: randomUUID() })).toEqual([]);
  expect((await changeWorkspaceMemberRole(roleInput))[0]?.role).toBe("analyst");
  expect(await changeWorkspaceMemberRole(roleInput)).toEqual([]);
  const connectionClaim = await claimRevocationGate({ kind: "connection", organizationId, connectionId });
  const mode = { organizationId, connectionId, authority, claimId: connectionClaim!.claimId, revision: connectionClaim!.connectionRevision!, revokedLeases: 1 };
  expect(await disableWorkspaceManagedAccess(mode)).toBeNull();
  await db.prepare("UPDATE workspace_credential_lease SET revoked_at = ?, active_slot = NULL WHERE connection_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), connectionId).run();
  expect((await disableWorkspaceManagedAccess(mode))?.credentialMode).toBe("member_local");
  expect(await disableWorkspaceManagedAccess(mode)).toBeNull();
  const ids = [connectionId, ...Array.from({ length: 1_000 }, () => randomUUID())];
  expect(await queryD1(sql`SELECT id FROM workspace_connection WHERE ${inD1Strings(sql`id`, ids)}`)).toEqual([{ id: connectionId }]);
  const conflict = await db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'viewer')")
    .bind(memberId, organizationId, userId).run().catch((error: unknown) => error);
  expect(isUniqueDatabaseConflict(conflict)).toBe(true);
  expect(databaseErrorCode({ cause: conflict })).toBe("SQLITE_UNIQUE");
  expect(databaseErrorCode(new Error("sensitive arbitrary message"))).toBeNull();
}
