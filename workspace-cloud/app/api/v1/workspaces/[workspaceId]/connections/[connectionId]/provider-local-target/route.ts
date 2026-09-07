// Returns only a canonical, secret-free imported target for a desktop-local
// provider binding. The target is never a substitute for a cloud import receipt.
import { isUuid, jsonError, privateJson } from "../../../../../../../../lib/http";
import { loadProviderLocalTarget } from "../../../../../../../../lib/provider-local-target";
import { authorizeWorkspaceConnection } from "../../../../../../../../lib/workspace-authorization";

type RouteContext = {
  params: Promise<{ workspaceId: string; connectionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) {
    return jsonError("Invalid workspace or connection id", 400);
  }
  const authorization = await authorizeWorkspaceConnection(
    request,
    workspaceId,
    connectionId,
    "read",
  );
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  try {
    const target = await loadProviderLocalTarget({
      organizationId: workspaceId,
      connectionId,
      authority: {
        sessionId: authorization.session.session.id,
        userId: authorization.session.user.id,
        membershipId: authorization.membership.id,
      },
    });
    if (!target) return jsonError("Provider local target is unavailable", 409);
    return privateJson({ target });
  } catch {
    // Do not expose provider metadata, database errors, or an otherwise known
    // cross-tenant connection UUID through this capability endpoint.
    return jsonError("Provider local target is temporarily unavailable", 500);
  }
}
