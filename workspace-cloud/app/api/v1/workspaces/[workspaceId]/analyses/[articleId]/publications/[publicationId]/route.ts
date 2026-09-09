import { revokeAnalysisPublication } from "@/lib/workspace-analysis-publication-store";
// Revoke one fixed publication without deleting its immutable audit evidence.
import { revalidatePath } from "next/cache";

import { env } from "../../../../../../../../../lib/env";
import { isUuid, jsonError, mutationAllowed, privateJson } from "../../../../../../../../../lib/http";
import { authorizeWorkspace } from "../../../../../../../../../lib/workspace-authorization";
import { hasWorkspaceCapability } from "../../../../../../../../../lib/workspace-permissions";

type RouteContext = {
  params: Promise<{ workspaceId: string; articleId: string; publicationId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, articleId, publicationId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId) || !isUuid(publicationId)) {
    return jsonError("Invalid Analysis Article publication scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "write");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (!hasWorkspaceCapability(authorization.role, "write")) {
    return jsonError("Analysis Article publication revocation requires Editor access", 403);
  }
  const row = await revokeAnalysisPublication({ organizationId: workspaceId, articleId, publicationId,
    authority: { sessionId: authorization.session.session.id, userId: authorization.session.user.id,
      membershipId: authorization.membership.id, role: authorization.role } });
  if (!row) return jsonError("Analysis Article publication not found", 404);
  const revokedAt = row.revokedAt instanceof Date ? row.revokedAt : new Date(String(row.revokedAt));
  if (typeof row.slug !== "string") return jsonError("Analysis Article publication is invalid", 409);
  revalidatePath(`/analyses/${row.slug}`);
  revalidatePath(`/api/v1/public/analyses/${row.slug}`);
  return privateJson({ id: row.id, revokedAt: revokedAt.toISOString() });
}
