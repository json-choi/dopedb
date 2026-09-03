// Publish and list immutable HTML snapshots. The source run proves that the
// saved query executed for this exact revision, but its SQL and rows are never
// copied into the public payload.
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "../../../../../../../../lib/db";
import { env } from "../../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../../lib/http";
import {
  workspaceAnalysisArticleRun,
  workspaceAnalysisPublication,
} from "../../../../../../../../lib/schema";
import { authorizeWorkspace } from "../../../../../../../../lib/workspace-authorization";
import { accessibleAnalysisArticle } from "../../../../../../../../lib/workspace-analysis-article-http";
import { commitAnalysisPublication } from "../../../../../../../../lib/workspace-analysis-publication-store";
import {
  buildAnalysisPublicSnapshot,
  parseAnalysisPublicationRequest,
} from "../../../../../../../../lib/workspace-analysis-publications";
import { hasWorkspaceCapability } from "../../../../../../../../lib/workspace-permissions";

type RouteContext = { params: Promise<{ workspaceId: string; articleId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, articleId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId)) {
    return jsonError("Invalid Analysis Article publication scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const article = await accessibleAnalysisArticle({
    organizationId: workspaceId,
    articleId,
    memberId: authorization.membership.id,
  });
  if (!article) return jsonError("Analysis Article not found", 404);
  const rows = await db.select({
    id: workspaceAnalysisPublication.id,
    articleRevision: workspaceAnalysisPublication.articleRevision,
    sourceRunId: workspaceAnalysisPublication.sourceRunId,
    slug: workspaceAnalysisPublication.slug,
    version: workspaceAnalysisPublication.version,
    replacesPublicationId: workspaceAnalysisPublication.replacesPublicationId,
    visibility: workspaceAnalysisPublication.visibility,
    title: workspaceAnalysisPublication.title,
    description: workspaceAnalysisPublication.description,
    snapshotHash: workspaceAnalysisPublication.snapshotHash,
    publishedAt: workspaceAnalysisPublication.publishedAt,
    revokedAt: workspaceAnalysisPublication.revokedAt,
  }).from(workspaceAnalysisPublication).where(and(
    eq(workspaceAnalysisPublication.organizationId, workspaceId),
    eq(workspaceAnalysisPublication.articleId, articleId),
  )).orderBy(desc(workspaceAnalysisPublication.publishedAt));
  return privateJson({
    publications: rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, articleId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId)) {
    return jsonError("Invalid Analysis Article publication scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "write");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (!hasWorkspaceCapability(authorization.role, "write")) {
    return jsonError("Analysis Article publishing requires workspace Editor access", 403);
  }
  const body = await boundedJsonBody(request, 16 * 1024);
  if (!body.ok) return jsonError("Invalid Analysis Article publication", 400);
  let publication;
  try {
    publication = parseAnalysisPublicationRequest(body.value);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid Analysis Article publication", 400);
  }
  const article = await accessibleAnalysisArticle({
    organizationId: workspaceId,
    articleId,
    memberId: authorization.membership.id,
  });
  if (!article) return jsonError("Analysis Article not found", 404);
  if (article.ownerMemberId !== authorization.membership.id
    && authorization.role !== "admin" && authorization.role !== "owner") {
    return jsonError("Only the Article owner or a workspace administrator can publish it", 403);
  }
  const run = await db.query.workspaceAnalysisArticleRun.findFirst({
    where: and(
      eq(workspaceAnalysisArticleRun.organizationId, workspaceId),
      eq(workspaceAnalysisArticleRun.articleId, articleId),
      eq(workspaceAnalysisArticleRun.id, publication.runId),
      eq(workspaceAnalysisArticleRun.articleRevision, article.revision),
      eq(workspaceAnalysisArticleRun.state, "succeeded"),
    ),
  });
  if (!run?.finishedAt) {
    return jsonError("Run the saved query successfully before publishing this HTML", 409);
  }
  const snapshot = buildAnalysisPublicSnapshot({
    request: publication,
    definition: article.definition,
    publishedAt: new Date(),
  });
  try {
    const created = await commitAnalysisPublication({
      organizationId: workspaceId,
      articleId,
      articleRevision: article.revision,
      request: publication,
      snapshot,
      authority: {
        sessionId: authorization.session.session.id,
        userId: authorization.session.user.id,
        membershipId: authorization.membership.id,
        role: authorization.role,
      },
    });
    if (!created) return jsonError("Analysis Article publication authority changed", 409);
    revalidatePath(`/analyses/${created.slug}`);
    revalidatePath(`/api/v1/public/analyses/${created.slug}`);
    return privateJson({ publication: created }, { status: 201 });
  } catch (error) {
    const row = error && typeof error === "object"
      ? error as { code?: unknown; cause?: { code?: unknown } } : null;
    if (row?.code === "23505" || row?.cause?.code === "23505") {
      return jsonError("Analysis Article publication id or slug already exists", 409);
    }
    throw error;
  }
}
