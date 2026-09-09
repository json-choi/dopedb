// Existing managed templates may only be returned to member-local credentials here;
// new managed templates are created by the receipt-bound import route.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../../../../../../../lib/db";
import { env } from "../../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../../lib/http";
import { revokeActiveLeases } from "../../../../../../../../lib/provider-integrations";
import {
  claimRevocationGate,
  clearRevocationGate,
  releaseRevocationGateClaim,
} from "../../../../../../../../lib/revocation-gates";
import { workspaceConnection } from "../../../../../../../../lib/schema";
import { disableWorkspaceManagedAccess } from "../../../../../../../../lib/workspace-managed-mode-store";
import { authorizeWorkspace } from "../../../../../../../../lib/workspace-authorization";
import { publicConnection } from "../../../../../../../../lib/workspace-connections";

type RouteContext = {
  params: Promise<{ workspaceId: string; connectionId: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) {
    return jsonError("Invalid request origin", 403);
  }
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const connection = await db.query.workspaceConnection.findFirst({
    where: and(
      eq(workspaceConnection.id, connectionId),
      eq(workspaceConnection.organizationId, workspaceId),
      isNull(workspaceConnection.deletedAt),
    ),
  });
  if (!connection) return jsonError("Connection not found", 404);
  const parsed = await boundedJsonBody(request, 256);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Credential mode request is too large" : "Invalid credential mode",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as Record<string, unknown> | null;
  if (
    !body
    || Object.keys(body).length !== 1
    || body.mode !== "managed"
    && body.mode !== "member_local"
  ) {
    return jsonError("Invalid credential mode", 400);
  }
  // New managed templates are imported only through a single-use discovery
  // receipt. Accepting raw provider selectors here would recreate an external-id
  // bypass around the receipt/session/tenant binding.
  if (body.mode === "managed") {
    return jsonError("Managed provider access must be imported from a discovery receipt", 409);
  }
  // This is intentionally only a cheap preflight. The same predicates (plus
  // session/member/grant state) are repeated inside the final locked mutation.
  // A browser can never supply a provider integration, resource, or metadata.
  if (
    !connection.providerIntegrationId
    || !connection.providerResourceId
    || !connection.providerResource
    || connection.readonlyDefault !== true
    || connection.allowWrites !== false
    || (connection.credentialMode !== "managed" && connection.credentialMode !== "member_local")
  ) {
    return jsonError("Disable managed writes before switching this provider target to member-local", 409);
  }

  const claim = await claimRevocationGate({
    kind: "connection",
    organizationId: workspaceId,
    connectionId,
  });
  if (!claim) {
    return jsonError("Another connection access change is already in progress", 409);
  }
  const expectedClaimRevision = connection.revision + (claim.firstPending ? 1 : 0);
  if (claim.connectionRevision !== expectedClaimRevision) {
    await (
      claim.firstPending
        ? clearRevocationGate(claim)
        : releaseRevocationGateClaim(claim)
    ).catch(() => false);
    return jsonError(
      "Connection changed concurrently. Retry the access update.",
      409,
    );
  }
  let revocation;
  try {
    revocation = await revokeActiveLeases({
      organizationId: workspaceId,
      connectionId,
    });
  } catch (error) {
    await releaseRevocationGateClaim(claim).catch(() => false);
    throw error;
  }
  if (revocation.deferred > 0) {
    await releaseRevocationGateClaim(claim).catch(() => false);
    return jsonError(
      "Active database access could not be revoked yet. Retry before changing access.",
      409,
    );
  }
  const updated = await disableWorkspaceManagedAccess({ organizationId: workspaceId, connectionId,
    authority: { sessionId: authorization.session.session.id, userId: authorization.session.user.id,
      membershipId: authorization.membership.id, role: authorization.role },
    claimId: claim.claimId, revision: expectedClaimRevision, revokedLeases: revocation.revoked,
  }).catch(async (error) => {
    await releaseRevocationGateClaim(claim).catch(() => false);
    throw error;
  });
  if (!updated) {
    await releaseRevocationGateClaim(claim).catch(() => false);
    return jsonError(
      "Connection or provider access changed concurrently. Retry the update.",
      409,
    );
  }
  return privateJson({
    connection: publicConnection(updated, authorization.role, authorization.accessMode),
  });
}
