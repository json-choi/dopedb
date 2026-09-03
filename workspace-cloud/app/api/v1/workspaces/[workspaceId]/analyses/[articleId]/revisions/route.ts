// Immutable Analysis Article history. Every payload is revalidated before it
// leaves the control plane; malformed history fails closed.
import { and, desc, eq } from "drizzle-orm";

import { db } from "../../../../../../../../lib/db";
import { isUuid, jsonError, privateJson } from "../../../../../../../../lib/http";
import { workspaceAnalysisArticleRevision } from "../../../../../../../../lib/schema";
import { authorizeWorkspace } from "../../../../../../../../lib/workspace-authorization";
import { accessibleAnalysisArticle } from "../../../../../../../../lib/workspace-analysis-article-http";
import { parseAnalysisArticleVersionPayload } from "../../../../../../../../lib/workspace-analysis-articles";
import { withRetiredVersionPayloadState } from "../../../../../../../../lib/workspace-analysis-version-compat";
import { hasWorkspaceCapability } from "../../../../../../../../lib/workspace-permissions";

type RouteContext = { params: Promise<{ workspaceId: string; articleId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, articleId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId)) {
    return jsonError("Invalid workspace or Analysis Article id", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (!hasWorkspaceCapability(authorization.role, "write")) {
    return jsonError("Analysis Article history requires workspace Editor access", 403);
  }
  const accessible = await accessibleAnalysisArticle({
    organizationId: workspaceId,
    articleId,
    memberId: authorization.membership.id,
  });
  if (!accessible) return jsonError("Analysis Article not found", 404);
  const revisions = await db.select().from(workspaceAnalysisArticleRevision).where(and(
    eq(workspaceAnalysisArticleRevision.organizationId, workspaceId),
    eq(workspaceAnalysisArticleRevision.articleId, articleId),
  )).orderBy(desc(workspaceAnalysisArticleRevision.revision)).limit(200);
  try {
    return privateJson({
      articleId,
      revisions: revisions.map((revision) => ({
        revision: revision.revision,
        baseRevision: revision.baseRevision,
        operation: revision.operation,
        payload: withRetiredVersionPayloadState(
          parseAnalysisArticleVersionPayload(revision.payload),
        ),
        payloadHash: revision.payloadHash,
        createdByMemberId: revision.createdByMemberId,
        createdAt: revision.createdAt.toISOString(),
      })),
    });
  } catch {
    return jsonError("Analysis Article history is invalid", 409);
  }
}
