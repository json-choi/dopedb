// Access policy HTTP mutation shares the connection revocation protocol so no
// previously issued team credential survives a successful policy disable.
import "server-only";
import { jsonError, privateJson } from "./http";
import { authorizeWorkspaceConnection } from "./workspace-authorization";
import { revokeActiveLeases } from "./provider-integrations/lease-cleanup";
import { claimRevocationGate, clearRevocationGate, releaseRevocationGateClaim } from "./revocation-gates";
import { setWorkspaceTeamRead } from "./workspace-team-read-store";

export async function changeTeamRead(request: Request, organizationId: string, connectionId: string, body: object) {
  if (Object.keys(body).length !== 1 || !("teamReadEnabled" in body) || typeof body.teamReadEnabled !== "boolean") {
    return jsonError("Invalid team read policy", 400);
  }
  const authorization = await authorizeWorkspaceConnection(request, organizationId, connectionId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (authorization.role !== "admin" && authorization.role !== "owner") return jsonError("Insufficient workspace permission", 403);
  const input = { organizationId, connectionId, enabled: body.teamReadEnabled,
    authority: { sessionId: authorization.session.session.id, userId: authorization.session.user.id,
      membershipId: authorization.membership.id, role: authorization.role } };
  if (input.enabled) {
    return await setWorkspaceTeamRead(input)
      ? privateJson({ teamReadEnabled: true }) : jsonError("Connection access changed. Refresh and retry.", 409);
  }
  const claim = await claimRevocationGate({ kind: "connection", organizationId, connectionId });
  if (!claim) return jsonError("Connection access changed. Refresh and retry.", 409);
  if (!claim.firstPending) {
    await releaseRevocationGateClaim(claim).catch(() => false);
    return jsonError("Another connection access change is already in progress", 409);
  }
  try {
    const revocation = await revokeActiveLeases({ organizationId, connectionId });
    if (revocation.deferred > 0) {
      await clearRevocationGate(claim).catch(() => false);
      return jsonError("Active database access could not be revoked. Retry after its credentials expire.", 409);
    }
    if (!await setWorkspaceTeamRead({ ...input, claimId: claim.claimId, revision: claim.connectionRevision })) {
      await clearRevocationGate(claim).catch(() => false);
      return jsonError("Connection access changed. Refresh and retry.", 409);
    }
    return privateJson({ teamReadEnabled: false });
  } catch (error) {
    await clearRevocationGate(claim).catch(() => false);
    throw error;
  }
}
