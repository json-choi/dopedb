// Run status and terminal receipt completion. Query rows never cross this API.
import { and, eq } from "drizzle-orm";

import { db } from "../../../../../../../../../lib/db";
import { env } from "../../../../../../../../../lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "../../../../../../../../../lib/http";
import {
  workspaceAnalysisArticleQueryReceipt,
  workspaceAnalysisArticleRevision,
  workspaceAnalysisArticleRun,
} from "../../../../../../../../../lib/schema";
import { authorizeWorkspace } from "../../../../../../../../../lib/workspace-authorization";
import { accessibleAnalysisArticle } from "../../../../../../../../../lib/workspace-analysis-article-http";
import {
  analysisRunnerCapabilityHeader,
  hashAnalysisRunnerCapability,
  isAnalysisDesktopBearerRequest,
  parseAnalysisRunnerCapability,
} from "../../../../../../../../../lib/workspace-analysis-runner-capability";
import {
  commitAnalysisRunCompletion,
  type AnalysisRunAuthority,
} from "../../../../../../../../../lib/workspace-analysis-run-store";
import { parseAnalysisRunCompletion } from "../../../../../../../../../lib/workspace-analysis-runs";
import { parseAnalysisArticleVersionPayload } from "../../../../../../../../../lib/workspace-analysis-articles";
import { canonicalHash } from "../../../../../../../../../lib/workspace-versioning";

type RouteContext = {
  params: Promise<{ workspaceId: string; articleId: string; runId: string }>;
};

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

function publicRun(run: typeof workspaceAnalysisArticleRun.$inferSelect) {
  return {
    ...run,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
  };
}

async function runRevision(workspaceId: string, articleId: string, revision: number) {
  const row = await db.query.workspaceAnalysisArticleRevision.findFirst({
    where: and(
      eq(workspaceAnalysisArticleRevision.organizationId, workspaceId),
      eq(workspaceAnalysisArticleRevision.articleId, articleId),
      eq(workspaceAnalysisArticleRevision.revision, revision),
    ),
    columns: { payload: true },
  });
  if (!row) return null;
  try {
    const payload = parseAnalysisArticleVersionPayload(row.payload);
    return payload.deleted ? null : payload;
  } catch {
    return null;
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, articleId, runId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId) || !isUuid(runId)) {
    return jsonError("Invalid Analysis Article run scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const accessible = await accessibleAnalysisArticle({
    organizationId: workspaceId,
    articleId,
    memberId: authorization.membership.id,
  });
  if (!accessible) return jsonError("Analysis Article not found", 404);
  const run = await db.query.workspaceAnalysisArticleRun.findFirst({
    where: and(
      eq(workspaceAnalysisArticleRun.organizationId, workspaceId),
      eq(workspaceAnalysisArticleRun.articleId, articleId),
      eq(workspaceAnalysisArticleRun.id, runId),
    ),
  });
  if (!run) return jsonError("Analysis Article run not found", 404);
  const receipts = await db.select({
    queryNodeId: workspaceAnalysisArticleQueryReceipt.queryNodeId,
    state: workspaceAnalysisArticleQueryReceipt.state,
    rowCount: workspaceAnalysisArticleQueryReceipt.rowCount,
    byteCount: workspaceAnalysisArticleQueryReceipt.byteCount,
    durationMs: workspaceAnalysisArticleQueryReceipt.durationMs,
    schemaFingerprint: workspaceAnalysisArticleQueryReceipt.schemaFingerprint,
  }).from(workspaceAnalysisArticleQueryReceipt).where(and(
    eq(workspaceAnalysisArticleQueryReceipt.organizationId, workspaceId),
    eq(workspaceAnalysisArticleQueryReceipt.runId, runId),
  ));
  return privateJson({ run: publicRun(run), receipts });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  if (!isAnalysisDesktopBearerRequest(request)) {
    return jsonError("Analysis run completion requires a Desktop bearer session", 401);
  }
  const { workspaceId, articleId, runId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId) || !isUuid(runId)) {
    return jsonError("Invalid Analysis Article run scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const runnerCapability = parseAnalysisRunnerCapability(request);
  if (!runnerCapability) {
    return jsonError(
      "Invalid Analysis runner capability",
      request.headers.has(analysisRunnerCapabilityHeader) ? 403 : 428,
    );
  }
  const run = await db.query.workspaceAnalysisArticleRun.findFirst({
    where: and(
      eq(workspaceAnalysisArticleRun.organizationId, workspaceId),
      eq(workspaceAnalysisArticleRun.articleId, articleId),
      eq(workspaceAnalysisArticleRun.id, runId),
    ),
  });
  if (!run) return jsonError("Analysis Article run not found", 404);
  const revision = await runRevision(workspaceId, articleId, run.articleRevision);
  if (!revision) return jsonError("Analysis Article revision is unavailable", 409);
  const body = await boundedJsonBody(request, 256 * 1024);
  if (!body.ok) return jsonError("Invalid Analysis Article completion", 400);
  let completion;
  try {
    completion = parseAnalysisRunCompletion(body.value, revision.definition);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid Analysis Article completion", 400);
  }
  const query = revision.definition.query;
  for (const receipt of completion.queryReceipts) {
    if (receipt.connectionId !== revision.connectionId
      || receipt.connectionRevision !== revision.connectionRevision
      || receipt.queryHash !== canonicalHash({ sql: query.sql })) {
      return jsonError("Analysis Article query receipt does not match the immutable revision", 409);
    }
  }
  const updated = await commitAnalysisRunCompletion({
    organizationId: workspaceId,
    articleId,
    runId,
    runnerId: run.runnerId,
    runnerCapabilityHash: hashAnalysisRunnerCapability(runnerCapability),
    completion,
    authority: authority(authorization),
  });
  if (!updated) return jsonError("Analysis run authority changed before completion", 409);
  return privateJson({ run: updated });
}
