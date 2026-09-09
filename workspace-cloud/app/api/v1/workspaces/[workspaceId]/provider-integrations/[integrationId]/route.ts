// Provider disconnection revokes live database credentials first, then the OAuth
// grant, and finally returns affected connections to member-local credential mode.
import { finalizeProviderIntegrationDisconnect } from "../../../../../../../lib/provider-integration-disconnect-store";
import { env } from "../../../../../../../lib/env";
import { isUuid, jsonError, mutationAllowed } from "../../../../../../../lib/http";
import {
  providerIntegrationForRevocation,
  revokeActiveLeases,
  revokeProviderAuthorization,
} from "../../../../../../../lib/provider-integrations";
import {
  claimProviderIntegrationDisconnect,
  markProviderIntegrationLeaseCleanupPending,
  markProviderIntegrationDisconnectLeasesRevoked,
  markProviderIntegrationProviderRevokeAmbiguous,
  markProviderIntegrationProviderRevokeStarted,
  markProviderIntegrationProviderRevoked,
  releaseProviderIntegrationDisconnectClaim,
  resumeProviderIntegrationDisconnect,
} from "../../../../../../../lib/provider-integration-mutation-store";
import { sealProviderCredential } from "../../../../../../../lib/secret-envelope";
import { authorizeWorkspace } from "../../../../../../../lib/workspace-authorization";

type RouteContext = {
  params: Promise<{ workspaceId: string; integrationId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) {
    return jsonError("Invalid request origin", 403);
  }
  const { workspaceId, integrationId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(integrationId)) {
    return jsonError("Invalid workspace or integration id", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = {
    organizationId: workspaceId,
    membershipId: authorization.membership.id,
    userId: authorization.session.user.id,
    sessionId: authorization.session.session.id,
    role: authorization.role,
  };
  const claimId = crypto.randomUUID();
  const claimed = await claimProviderIntegrationDisconnect({
    authority,
    integrationId, claimId, now: new Date(),
  });
  const resumed = claimed ? null : await resumeProviderIntegrationDisconnect({ authority, integrationId });
  if (!claimed && !resumed) {
    const existing = await providerIntegrationForRevocation(workspaceId, integrationId);
    return existing
      ? jsonError("Another provider access change is already in progress", 409)
      : jsonError("Provider integration not found", 404);
  }
  const activeClaimId = claimed ? claimId : resumed!.claimId;
  const disconnectGeneration = claimed ? claimed.generation : resumed!.generation;
  let phase = claimed ? "claimed" : resumed!.phase;
  const integration = await providerIntegrationForRevocation(workspaceId, integrationId);
  if (!integration) {
    if (claimed) await releaseProviderIntegrationDisconnectClaim({
      organizationId: workspaceId, integrationId, claimId: activeClaimId,
    }).catch(() => undefined);
    return jsonError("Provider integration not found", 404);
  }

  let revocation = { revoked: 0, deferred: 0 };
  if (phase === "claimed" || phase === "lease_cleanup_pending") {
    try {
      // Provider lease cleanup is idempotent: PlanetScale deletion treats 404 as
      // success, Neon first sets NOLOGIN/missing-role success, and Vault uses its
      // synchronous lease-revoke endpoint. It is safe to resume this exact claim
      // after a worker crash.
      revocation = await revokeActiveLeases({ organizationId: workspaceId, integrationId });
    } catch {
      await markProviderIntegrationLeaseCleanupPending({
        organizationId: workspaceId, integrationId, generation: disconnectGeneration,
        claimId: activeClaimId, now: new Date(),
      }).catch(() => undefined);
      return jsonError("Provider lease cleanup is pending durable reconciliation.", 409);
    }
    if (revocation.deferred > 0) {
      await markProviderIntegrationLeaseCleanupPending({
        organizationId: workspaceId, integrationId, generation: disconnectGeneration,
        claimId: activeClaimId, now: new Date(),
      }).catch(() => undefined);
      return jsonError("Provider lease cleanup is pending durable reconciliation.", 409);
    }
    if (!await markProviderIntegrationDisconnectLeasesRevoked({
      organizationId: workspaceId, integrationId, generation: disconnectGeneration,
      claimId: activeClaimId, now: new Date(),
    })) return jsonError("Provider disconnect requires reconciliation", 409);
    phase = "leases_revoked";
  }
  if (phase === "provider_revoke_ambiguous") {
    return jsonError("Provider disconnect is ambiguous; explicit reconnect is required.", 409);
  }
  if (phase === "provider_revoke_started") {
    if (integration.provider === "planetScale") {
      await markProviderIntegrationProviderRevokeAmbiguous({
        organizationId: workspaceId, integrationId, generation: disconnectGeneration,
        claimId: activeClaimId, now: new Date(),
      }).catch(() => undefined);
      return jsonError("Provider disconnect is ambiguous; explicit reconnect is required.", 409);
    }
    if (!await markProviderIntegrationProviderRevoked({
      organizationId: workspaceId, integrationId, generation: disconnectGeneration,
      claimId: activeClaimId, now: new Date(),
    })) return jsonError("Provider disconnect requires reconciliation", 409);
    phase = "provider_revoked";
  }
  if (phase === "leases_revoked") {
    if (!await markProviderIntegrationProviderRevokeStarted({
      organizationId: workspaceId, integrationId, generation: disconnectGeneration,
      claimId: activeClaimId, now: new Date(),
    })) return jsonError("Provider disconnect requires reconciliation", 409);
    try {
      await revokeProviderAuthorization(integration);
    } catch {
      await markProviderIntegrationProviderRevokeAmbiguous({
        organizationId: workspaceId, integrationId, generation: disconnectGeneration,
        claimId: activeClaimId, now: new Date(),
      }).catch(() => undefined);
      return jsonError("Provider authorization outcome is ambiguous; explicit reconnect is required.", 502);
    }
    if (!await markProviderIntegrationProviderRevoked({
      organizationId: workspaceId, integrationId, generation: disconnectGeneration,
      claimId: activeClaimId, now: new Date(),
    })) return jsonError("Provider disconnect requires reconciliation", 409);
  }
  const disconnectedAt = new Date();
  const scrubbedCredential = sealProviderCredential(integrationId, {
    revokedAt: disconnectedAt.toISOString(),
  });
  const finalized = await finalizeProviderIntegrationDisconnect({ authority, integrationId,
    provider: integration.provider, generation: disconnectGeneration, claimId: activeClaimId,
    scrubbedCredential, revokedLeases: revocation.revoked,
  });
  if (!finalized) {
    return jsonError("Provider disconnect requires reconciliation", 409);
  }
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "private, no-store" },
  });
}
