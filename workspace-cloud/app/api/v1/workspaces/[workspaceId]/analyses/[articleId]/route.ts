// One Analysis Article's current optimistic edit and delete boundary.
import { and, eq } from "drizzle-orm";

import { db } from "../../../../../../../lib/db";
import { env } from "../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
  privateRevisionMutationJson,
} from "../../../../../../../lib/http";
import {
  workspaceAnalysisArticle,
  workspaceAnalysisArticleRevision,
} from "../../../../../../../lib/schema";
import { authorizeWorkspace } from "../../../../../../../lib/workspace-authorization";
import { accessibleAnalysisArticle } from "../../../../../../../lib/workspace-analysis-article-http";
import {
  commitAnalysisArticleDelete,
  commitAnalysisArticleMutation,
  type AnalysisArticleMutationAuthority,
  type AnalysisArticleMutationOperation,
} from "../../../../../../../lib/workspace-analysis-article-store";
import {
  parseAnalysisArticleVersionPayload,
  parseSharedAnalysisArticleCreate,
  publicAnalysisArticle,
  type AnalysisArticleVersionPayload,
  type SharedAnalysisArticleCreate,
} from "../../../../../../../lib/workspace-analysis-articles";
import { hasWorkspaceCapability } from "../../../../../../../lib/workspace-permissions";
import { parseExpectedRevision } from "../../../../../../../lib/workspace-versioning";

type RouteContext = { params: Promise<{ workspaceId: string; articleId: string }> };

function authority(authorization: {
  role: string;
  session: { session: { id: string }; user: { id: string } };
  membership: { id: string };
}): AnalysisArticleMutationAuthority {
  return {
    sessionId: authorization.session.session.id,
    userId: authorization.session.user.id,
    membershipId: authorization.membership.id,
    role: authorization.role,
  };
}

async function expectedRevision(request: Request) {
  try {
    const value = parseExpectedRevision(request);
    if (value === null) return { error: jsonError("Expected revision is required", 428) } as const;
    return { value } as const;
  } catch (error) {
    return {
      error: jsonError(error instanceof Error ? error.message : "Invalid expected revision", 400),
    } as const;
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, articleId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId)) {
    return jsonError("Invalid workspace or Analysis Article id", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const article = await accessibleAnalysisArticle({
    organizationId: workspaceId,
    articleId,
    memberId: authorization.membership.id,
  });
  if (!article) return jsonError("Analysis Article not found", 404);
  return privateJson({ article });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, articleId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId)) {
    return jsonError("Invalid workspace or Analysis Article id", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "write");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (!hasWorkspaceCapability(authorization.role, "write")) {
    return jsonError("Analysis Article editing requires workspace Editor access", 403);
  }
  const match = await expectedRevision(request);
  if ("error" in match) return match.error;
  const current = await accessibleAnalysisArticle({
    organizationId: workspaceId,
    articleId,
    memberId: authorization.membership.id,
  });
  if (!current) return jsonError("Analysis Article not found", 404);
  if (match.value !== current.revision) {
    return jsonError("Analysis Article changed concurrently. Refresh before continuing.", 409);
  }
  const parsed = await boundedJsonBody(request, 1024 * 1024);
  const body = parsed.ok && parsed.value && typeof parsed.value === "object"
    && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown>
    : null;
  if (!body || typeof body.action !== "string") {
    return jsonError("Invalid Analysis Article action", 400);
  }

  if (body.action !== "update" || Object.keys(body).length !== 2) {
    return jsonError("Invalid Analysis Article action", 400);
  }
  let nextArticle: SharedAnalysisArticleCreate;
  try {
    nextArticle = parseSharedAnalysisArticleCreate(body.article);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid Analysis Article", 400);
  }
  if (nextArticle.id !== articleId) return jsonError("Analysis Article identity cannot change", 409);
  const operation: AnalysisArticleMutationOperation = nextArticle.definition.source === "human"
    ? "update" : "propose";

  const updated = await commitAnalysisArticleMutation({
    organizationId: workspaceId,
    article: nextArticle,
    expectedRevision: current.revision,
    ownerMemberId: current.ownerMemberId,
    authority: authority(authorization),
    operation,
  });
  if (!updated) {
    return jsonError(
      "Analysis authority changed. Refresh the Project and connection grant.",
      409,
    );
  }
  return privateRevisionMutationJson(request, {
    article: publicAnalysisArticle({
      ...updated,
      graphRevisionIds: nextArticle.graphRevisionIds,
      connections: nextArticle.connections,
    }),
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, articleId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId)) {
    return jsonError("Invalid workspace or Analysis Article id", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "write");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const match = await expectedRevision(request);
  if ("error" in match) return match.error;
  const current = await db.query.workspaceAnalysisArticle.findFirst({
    where: and(
      eq(workspaceAnalysisArticle.organizationId, workspaceId),
      eq(workspaceAnalysisArticle.id, articleId),
    ),
    columns: { revision: true, deletedAt: true },
  });
  if (!current || current.deletedAt) return jsonError("Analysis Article not found", 404);
  if (match.value !== current.revision) {
    return jsonError("Analysis Article changed concurrently. Refresh before deleting.", 409);
  }
  const revision = await db.query.workspaceAnalysisArticleRevision.findFirst({
    where: and(
      eq(workspaceAnalysisArticleRevision.organizationId, workspaceId),
      eq(workspaceAnalysisArticleRevision.articleId, articleId),
      eq(workspaceAnalysisArticleRevision.revision, current.revision),
    ),
    columns: { payload: true },
  });
  let payload: AnalysisArticleVersionPayload | null;
  try {
    payload = revision ? parseAnalysisArticleVersionPayload(revision.payload) : null;
  } catch {
    payload = null;
  }
  if (!payload || payload.deleted || payload.id !== articleId) {
    return jsonError("Analysis Article revision is invalid", 409);
  }
  const deleted = await commitAnalysisArticleDelete({
    organizationId: workspaceId,
    article: payload,
    expectedRevision: current.revision,
    ownerMemberId: payload.ownerMemberId,
    authority: authority(authorization),
  });
  if (!deleted) return jsonError("Analysis Article authority changed. Retry deletion.", 409);
  return privateRevisionMutationJson(request, {
    deleted: true,
    revision: deleted.revision,
  });
}
