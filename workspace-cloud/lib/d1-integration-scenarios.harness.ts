import { finalizeProviderIntegrationDisconnect } from "./provider-integration-disconnect-store";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import * as store from "./provider-integration-mutation-store";
import type { ProviderMutationAuthority } from "./provider-integrations/authority";
import { canonicalHash } from "./workspace-versioning";

export async function verifyD1IntegrationMutations(db: D1Database, authority: ProviderMutationAuthority) {
  const input: store.PersistProviderIntegrationInput = {
    authority, integrationId: randomUUID(), provider: "planetScale", externalAccountId: randomUUID(),
    displayName: "Refresh fixture", encryptedCredential: "fixture-envelope", credentialExpiresAt: null,
    grantedScope: "fixture", localVerificationTarget: null, now: new Date(), requestId: randomUUID(),
    revokedLeases: 0, principalClaims: [], production: false,
  };
  expect(await store.persistProviderIntegration(input)).toEqual({ ok: true, id: input.integrationId });
  const refresh = { authority, integrationId: input.integrationId, generation: 1n, claimId: randomUUID(), now: new Date() };
  expect(await store.claimPlanetScaleCredentialRefresh(refresh)).toBe(true);
  expect(await store.claimPlanetScaleCredentialRefresh({ ...refresh, claimId: randomUUID() })).toBe(false);
  expect(await store.markPlanetScaleCredentialRefreshRemoteStarted(refresh)).toBe(true);
  expect(await store.claimPlanetScaleCredentialRefresh({ ...refresh, claimId: randomUUID(),
    now: new Date(Date.now() + 10 * 60_000) })).toBe(false);
  const finalize = { ...refresh, encryptedCredential: "replacement-fixture", credentialExpiresAt: new Date(Date.now() + 60_000),
    grantedScope: "fixture" };
  await db.prepare("UPDATE member SET role = 'viewer' WHERE id = ?").bind(authority.membershipId).run();
  expect(await store.finalizePlanetScaleCredentialRefresh(finalize)).toBe(false);
  await db.prepare("UPDATE member SET role = 'owner' WHERE id = ?").bind(authority.membershipId).run();
  expect(await store.finalizePlanetScaleCredentialRefresh(finalize)).toBe(true);
  expect(await store.finalizePlanetScaleCredentialRefresh(finalize)).toBe(false);
  const disconnect = { authority, organizationId: authority.organizationId, integrationId: input.integrationId,
    generation: 2n, claimId: randomUUID(), now: new Date() };
  expect(await store.claimProviderIntegrationDisconnect(disconnect)).toEqual({ provider: "planetScale", generation: 2n });
  expect(await store.claimProviderIntegrationDisconnect({ ...disconnect, claimId: randomUUID() })).toBeNull();
  expect((await store.resumeProviderIntegrationDisconnect(disconnect))?.claimId).toBe(disconnect.claimId);
  expect(await store.markProviderIntegrationLeaseCleanupPending(disconnect)).toBe(true);
  expect(await store.markProviderIntegrationDisconnectLeasesRevoked(disconnect)).toBe(true);
  expect(await store.markProviderIntegrationProviderRevokeStarted(disconnect)).toBe(true);
  await store.releaseProviderIntegrationDisconnectClaim(disconnect);
  expect((await store.resumeProviderIntegrationDisconnect(disconnect))?.phase).toBe("provider_revoke_started");
  expect(await store.markProviderIntegrationProviderRevokeAmbiguous(disconnect)).toBe(true);
  expect((await store.resumeProviderIntegrationDisconnect(disconnect))?.phase).toBe("provider_revoke_ambiguous");
  const reconnect = { ...input, reconnectClaimId: disconnect.claimId, existing: {
    id: input.integrationId, status: "reconnect_required", generation: 2n, revokedAt: null, revocationPendingAt: disconnect.now,
  } };
  expect(await store.persistProviderIntegration(reconnect)).toEqual({ ok: true, id: input.integrationId });
  expect(await store.markProviderIntegrationProviderRevoked(disconnect)).toBe(false);
  expect(await store.persistProviderIntegration(reconnect)).toEqual({ ok: false });

  const finalClaim = { ...disconnect, generation: 3n, claimId: randomUUID(), now: new Date() };
  expect(await store.claimProviderIntegrationDisconnect(finalClaim)).not.toBeNull();
  expect(await store.markProviderIntegrationDisconnectLeasesRevoked(finalClaim)).toBe(true);
  expect(await store.markProviderIntegrationProviderRevokeStarted(finalClaim)).toBe(true);
  expect(await store.markProviderIntegrationProviderRevoked(finalClaim)).toBe(true);
  const finalInput = { authority, integrationId: input.integrationId, provider: "planetScale", generation: 3n,
    claimId: finalClaim.claimId, scrubbedCredential: "revoked-fixture", revokedLeases: 0 };
  expect(await finalizeProviderIntegrationDisconnect({ ...finalInput, claimId: randomUUID() })).toBe(false);
  expect(await finalizeProviderIntegrationDisconnect(finalInput)).toBe(true);
  expect(await finalizeProviderIntegrationDisconnect(finalInput)).toBe(false);

  const principal = { principalFingerprint: canonicalHash("principal"), targetFingerprint: canonicalHash("target"), accessKind: "read" as const };
  const gcp: store.PersistProviderIntegrationInput = { ...input, provider: "gcpCloudSql", integrationId: randomUUID(),
    externalAccountId: randomUUID(), principalClaims: [principal],
    localVerificationTarget: { kind: "gcpCloudSql", projectId: "fixture-project", instanceId: "fixture-instance" } };
  expect(await store.persistProviderIntegration(gcp)).toEqual({ ok: true, id: gcp.integrationId });
  const rejectedId = randomUUID();
  await expect(store.persistProviderIntegration({ ...gcp, integrationId: rejectedId, externalAccountId: randomUUID() }))
    .rejects.toThrow();
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_provider_integration WHERE id = ?")
    .bind(rejectedId).first("count")).toBe(0);
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_audit_event WHERE resource_id = ?")
    .bind(rejectedId).first("count")).toBe(0);
  expect(await store.persistProviderIntegration({ ...gcp, localVerificationTarget: null })).toEqual({ ok: false });
}
