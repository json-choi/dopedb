// A member's own database principal on a direct shared database: read its provisioning
// status, or upload the public verifier of a locally generated password. The password
// itself never reaches the control plane.
import { env } from "@/lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import { parseDirectVerifierRequest } from "@/lib/control-plane-contracts";
import { authorizeWorkspaceConnection } from "@/lib/workspace-authorization";
import { verifierKindForEngine } from "@/lib/workspace-direct-access-core";
import { directProvisioningWire, directRateLimited } from "@/lib/workspace-direct-access-http";
import {
  hasPendingDirectRevocation,
  loadDirectConnectionView,
  loadDirectEndpoint,
  submitDirectVerifier,
} from "@/lib/workspace-direct-access-store";

type RouteContext = { params: Promise<{ workspaceId: string; connectionId: string }> };

async function ownStatus(workspaceId: string, connectionId: string, memberId: string) {
  const view = await loadDirectConnectionView(workspaceId, connectionId, memberId);
  return view ? privateJson(directProvisioningWire(view)) : jsonError("Direct database not found", 404);
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) return jsonError("Invalid workspace or connection id", 400);
  const authorization = await authorizeWorkspaceConnection(request, workspaceId, connectionId, "read");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  return ownStatus(workspaceId, connectionId, authorization.membership.id);
}

export async function PUT(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) return jsonError("Invalid workspace or connection id", 400);
  const authorization = await authorizeWorkspaceConnection(request, workspaceId, connectionId, "read");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const limited = await directRateLimited(
    "direct-verifier", `${workspaceId}:${authorization.session.user.id}:${connectionId}`, 10);
  if (limited) return limited;
  const endpoint = await loadDirectEndpoint(workspaceId, connectionId);
  if (!endpoint) return jsonError("Direct database not found", 404);
  const body = await boundedJsonBody(request, 1_024);
  if (!body.ok) {
    return jsonError(
      body.reason === "too_large" ? "Verifier is too large" : "Invalid verifier",
      body.reason === "too_large" ? 413 : 400,
    );
  }
  let verifier;
  try {
    verifier = parseDirectVerifierRequest(body.value);
  } catch {
    return jsonError("Invalid verifier", 400);
  }
  if (verifier.verifierKind !== verifierKindForEngine(endpoint.engine)) {
    return jsonError("Verifier kind does not match this database engine", 400);
  }
  // Access that is being revoked must not be re-requested while the revocation is pending.
  if (await hasPendingDirectRevocation(workspaceId, connectionId, authorization.membership.id)) {
    return jsonError("Your access to this database is being revoked", 409, "direct_revocation_pending");
  }
  const submitted = await submitDirectVerifier({
    organizationId: workspaceId,
    connectionId,
    memberId: authorization.membership.id,
    userId: authorization.session.user.id,
    verifierKind: verifier.verifierKind,
    verifier: verifier.verifier,
  }).catch(() => null);
  if (!submitted) return jsonError("Your database account is changing. Retry shortly.", 409, "direct_principal_busy");
  return ownStatus(workspaceId, connectionId, authorization.membership.id);
}
