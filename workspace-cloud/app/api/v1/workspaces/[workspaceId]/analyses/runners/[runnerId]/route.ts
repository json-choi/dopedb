// Forget one member-owned Desktop runner and stop its active foreground run.
import { env } from "../../../../../../../../lib/env";
import { isUuid, jsonError, mutationAllowed, privateJson } from "../../../../../../../../lib/http";
import { authorizeWorkspace } from "../../../../../../../../lib/workspace-authorization";
import { revokeAnalysisRunner } from "../../../../../../../../lib/workspace-analysis-runner-store";

type RouteContext = { params: Promise<{ workspaceId: string; runnerId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, runnerId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(runnerId)) {
    return jsonError("Invalid Analysis runner scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const revoked = await revokeAnalysisRunner({
    organizationId: workspaceId,
    runnerId,
    authority: {
      sessionId: authorization.session.session.id,
      userId: authorization.session.user.id,
      membershipId: authorization.membership.id,
      role: authorization.role,
    },
  });
  if (!revoked) return jsonError("Analysis runner not found", 404);
  return privateJson({ revoked });
}
