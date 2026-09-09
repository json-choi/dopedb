import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { createWorkspaceD1 } from "./d1/database";
import { workspaceProviderIntegration, workspaceConnection, workspaceCredentialLease } from "./d1/schema";
import { cleanupExpiredManagedLeases, revokeActiveLeases } from "./provider-integrations/lease-cleanup";
import { claimRevocationGate, clearRevocationGate, renewRevocationGateClaim, releaseRevocationGateClaim,
  reserveManagedLeaseIfUnblocked, finalizeManagedLeaseIfUnblocked, managedLeaseStillDeliverable,
  type ManagedLeaseAuthority } from "./revocation-gates";

export async function verifyD1ManagedLeaseAuthority(db: D1Database, authority: ManagedLeaseAuthority) {
  const inputs = Array.from({ length: 12 }, () => ({ ...authority, leaseId: randomUUID() }));
  const statuses = await Promise.all(inputs.map(reserveManagedLeaseIfUnblocked));
  expect(statuses.filter((status) => status === "reserved")).toHaveLength(5);
  expect(statuses.filter((status) => status === "limit")).toHaveLength(7);
  const reserved = inputs[statuses.indexOf("reserved")];
  const lease = { externalCredentialId: "fixture-role", externalCredentialKind: "role" as const,
    host: "fixture.invalid", port: 5432, database: "fixture", sslmode: "verify-full" as const,
    username: "fixture", password: "fixture", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  expect(await finalizeManagedLeaseIfUnblocked(reserved, lease, "fixture-proof")).toBe(true);
  expect(await managedLeaseStillDeliverable(reserved, lease, "wrong-proof")).toBe(false);
  expect(await managedLeaseStillDeliverable(reserved, lease, "fixture-proof")).toBe(true);
  const claims = await Promise.all(Array.from({ length: 6 }, () => claimRevocationGate({ kind: "connection",
    organizationId: authority.organizationId, connectionId: authority.connectionId })));
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claim = claims.find(Boolean)!;
  expect(claim.firstPending).toBe(true);
  expect(claim.connectionRevision).toBe(authority.connectionRevision + 1);
  expect(await managedLeaseStillDeliverable(reserved, lease, "fixture-proof")).toBe(false);
  expect(await reserveManagedLeaseIfUnblocked({ ...authority, leaseId: randomUUID() })).toBe("blocked");
  const renewed = await renewRevocationGateClaim(claim);
  expect(renewed?.claimId).not.toBe(claim.claimId);
  expect(await clearRevocationGate(claim)).toBe(false);
  expect(await releaseRevocationGateClaim(renewed!)).toBe(true);
  const recovered = await claimRevocationGate({ kind: "connection", organizationId: authority.organizationId,
    connectionId: authority.connectionId });
  expect(recovered?.connectionRevision).toBe(claim.connectionRevision);
  expect(await clearRevocationGate(recovered!)).toBe(true);
  // Clearing a gate never makes an old resource revision deliverable again.
  expect(await managedLeaseStillDeliverable(reserved, lease, "fixture-proof")).toBe(false);
  const current = { ...authority, connectionRevision: claim.connectionRevision! };
  await db.prepare("UPDATE workspace_credential_lease SET revoked_at = ?, active_slot = NULL WHERE connection_id = ?")
    .bind(new Date().toISOString(), authority.connectionId).run();
  expect(await reserveManagedLeaseIfUnblocked({ ...current, leaseId: randomUUID(), accessMode: "write" })).toBe("blocked");
  await db.prepare("UPDATE workspace_connection SET allow_writes = 1 WHERE id = ?").bind(authority.connectionId).run();
  await db.prepare("UPDATE workspace_provider_resource SET capability_manifest = json_set(capability_manifest, '$.write', json('true')) WHERE id = ?")
    .bind(authority.providerResourceId).run();
  const schema = { ...current, accessMode: "schema" as const, leaseId: randomUUID() };
  expect(await reserveManagedLeaseIfUnblocked(schema)).toBe("reserved");
  expect(await reserveManagedLeaseIfUnblocked({ ...schema, leaseId: randomUUID() })).toBe("schema_busy");
  const integrationClaim = await claimRevocationGate({ kind: "integration", organizationId: authority.organizationId,
    integrationId: authority.integrationId });
  expect(integrationClaim).not.toBeNull();
  expect(await finalizeManagedLeaseIfUnblocked(schema, lease, "fixture-proof")).toBe(false);
  expect(await clearRevocationGate(integrationClaim!)).toBe(true);
  const memberClaim = await claimRevocationGate({ kind: "member", organizationId: authority.organizationId,
    memberId: authority.memberId, userId: authority.userId });
  expect(memberClaim?.memberRole).toBe("owner");
  expect(await reserveManagedLeaseIfUnblocked({ ...current, leaseId: randomUUID() })).toBe("blocked");
  expect(await clearRevocationGate(memberClaim!)).toBe(true);
  // Restore the fixture policy for the import scenarios that follow.
  await db.prepare("UPDATE workspace_connection SET allow_writes = 0 WHERE id = ?").bind(authority.connectionId).run();
  const { orm } = createWorkspaceD1(db);
  const [integration] = await orm.insert(workspaceProviderIntegration).values({ organizationId: authority.organizationId,
    provider: "gcpCloudSql", displayName: "Cleanup fixture", externalAccountId: "cleanup-fixture",
    encryptedCredential: "fixture-envelope",
    localVerificationTarget: { kind: "gcpCloudSql", projectId: "fixture-project", instanceId: "fixture-instance" } }).returning();
  const [connection] = await orm.insert(workspaceConnection).values({ organizationId: authority.organizationId,
    name: "Cleanup fixture", engine: "postgres", provider: "gcpCloudSql", credentialMode: "managed",
    providerIntegrationId: integration.id, host: "fixture.invalid", port: 5432, databaseName: "fixture",
    sslmode: "verify-full" }).returning();
  const leases = await orm.insert(workspaceCredentialLease).values([1, 2, 3].map((slot) => ({
    organizationId: authority.organizationId, connectionId: connection.id, integrationId: integration.id,
    userId: authority.userId, provider: "gcpCloudSql", accessMode: "read", externalCredentialId: `fixture-${slot}`,
    externalCredentialKind: "iamToken", activeSlot: slot, expiresAt: new Date(Date.now() + (slot === 3 ? 60_000 : -60_000)),
  }))).returning();
  const cleaned = await Promise.all(Array.from({ length: 3 }, () => cleanupExpiredManagedLeases({
    integrationId: integration.id, limit: 1,
  })));
  expect(cleaned.reduce((sum, value) => sum + value.scanned, 0)).toBe(2);
  expect(cleaned.reduce((sum, value) => sum + value.revoked, 0)).toBe(2);
  expect(await revokeActiveLeases({ organizationId: authority.organizationId, leaseId: leases[2].id }))
    .toEqual({ revoked: 0, deferred: 1 });
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_audit_event WHERE action = 'credential.lease.cleanup' AND organization_id = ?")
    .bind(authority.organizationId).first("count")).toBe(2);
}
