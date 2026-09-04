// List and start exact-revision Analysis Article runs on a member-owned Desktop runner.
import { and, desc, eq, lt } from "drizzle-orm";

import { db } from "../../../../../../../../lib/db";
import { env } from "../../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../../lib/http";
import { authorizeWorkspace } from "../../../../../../../../lib/workspace-authorization";
import { workspaceAnalysisArticleRun } from "../../../../../../../../lib/schema";
import { accessibleAnalysisArticle } from "../../../../../../../../lib/workspace-analysis-article-http";
import {
  analysisRunnerCapabilityHeader,
  hashAnalysisRunnerCapability,
  isAnalysisDesktopBearerRequest,
  parseAnalysisRunnerCapability,
} from "../../../../../../../../lib/workspace-analysis-runner-capability";
import {
  commitAnalysisRunCreate,
  type AnalysisRunAuthority,
} from "../../../../../../../../lib/workspace-analysis-run-store";
import { parseAnalysisRunRequest } from "../../../../../../../../lib/workspace-analysis-runs";
import { canonicalHash } from "../../../../../../../../lib/workspace-versioning";

type RouteContext = { params: Promise<{ workspaceId: string; articleId: string }> };

function publicAnalysisRun(run: typeof workspaceAnalysisArticleRun.$inferSelect) {
  return {
    id: run.id,
    articleId: run.articleId,
    articleRevision: run.articleRevision,
    runnerId: run.runnerId,
    runnerCapabilityGeneration: run.runnerCapabilityGeneration,
    trigger: "manual" as const,
    state: run.state,
    definitionHash: run.definitionHash,
    schemaFingerprints: run.schemaFingerprints,
    rowCount: run.rowCount,
    byteCount: run.byteCount,
    resultHash: run.resultHash,
    errorKind: run.errorKind,
    errorMessage: run.errorMessage,
    cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
    cancelRequestedByMemberId: run.cancelRequestedByMemberId,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

function authority(authorization: {
  role: string;
  session: { session: { id: string }; user: { id: string } };
  membership: { id: string };
}): AnalysisRunAuthority {
  return {
    sessionId: authorization.session.session.id,
    userId: authorization.session.user.id,
    membershipId: authorization.membership.id,
    role: authorization.role,
  };
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
  const url = new URL(request.url);
  const beforeValue = url.searchParams.get("before");
  const before = beforeValue ? new Date(beforeValue) : null;
  if (before && Number.isNaN(before.valueOf())) return jsonError("Invalid run cursor", 400);
  const filters = [
    eq(workspaceAnalysisArticleRun.organizationId, workspaceId),
    eq(workspaceAnalysisArticleRun.articleId, articleId),
  ];
  if (before) filters.push(lt(workspaceAnalysisArticleRun.createdAt, before));
  const rows = await db.select().from(workspaceAnalysisArticleRun)
    .where(and(...filters))
    .orderBy(desc(workspaceAnalysisArticleRun.createdAt))
    .limit(100);
  return privateJson({
    runs: rows.map(publicAnalysisRun),
    nextCursor: rows.length === 100 ? rows.at(-1)!.createdAt.toISOString() : null,
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  if (!isAnalysisDesktopBearerRequest(request)) {
    return jsonError("Analysis run execution requires a Desktop bearer session", 401);
  }
  const { workspaceId, articleId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId)) {
    return jsonError("Invalid workspace or Analysis Article id", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const runnerCapability = parseAnalysisRunnerCapability(request);
  if (!runnerCapability) return jsonError(
    "Invalid Analysis runner capability",
    request.headers.has(analysisRunnerCapabilityHeader) ? 403 : 428,
  );
  const body = await boundedJsonBody(request, 128 * 1024);
  if (!body.ok || !body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return jsonError("Invalid Analysis Article run request", 400);
  }
  const requestedRevision = (body.value as Record<string, unknown>).articleRevision;
  if (typeof requestedRevision !== "number" || !Number.isSafeInteger(requestedRevision)) {
    return jsonError("Invalid Analysis Article revision", 400);
  }
  const article = await accessibleAnalysisArticle({
    organizationId: workspaceId,
    articleId,
    memberId: authorization.membership.id,
  });
  if (!article || article.revision !== requestedRevision) {
    return jsonError("Analysis Article revision is not runnable", 404);
  }
  let run;
  try {
    run = parseAnalysisRunRequest(body.value);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid Analysis Article run", 400);
  }
  const created = await commitAnalysisRunCreate({
    organizationId: workspaceId,
    articleId,
    run,
    definitionHash: canonicalHash(article.definition),
    runnerCapabilityHash: hashAnalysisRunnerCapability(runnerCapability),
    authority: authority(authorization),
  });
  if (!created) {
    return jsonError("Analysis run authority changed. Refresh the Article, grants, and runner.", 409);
  }
  return privateJson({
    run: created.run,
    article: { ...article, connectionRevision: created.connectionContentRevision },
  }, { status: 201 });
}
