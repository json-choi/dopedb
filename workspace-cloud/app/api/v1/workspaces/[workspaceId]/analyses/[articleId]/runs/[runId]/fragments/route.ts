// Stage one encrypted Analysis result fragment below Vercel's request limit.
// Staged rows are invisible until the same exact runner atomically completes
// the run with a hash manifest covering every stored fragment.
import { and, eq } from "drizzle-orm";

import { db } from "../../../../../../../../../../lib/db";
import { env } from "../../../../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../../../../lib/http";
import {
  workspaceAnalysisArticleRevision,
  workspaceAnalysisArticleRun,
} from "../../../../../../../../../../lib/schema";
import { authorizeWorkspace } from "../../../../../../../../../../lib/workspace-authorization";
import {
  analysisRunnerCapabilityHeader,
  hashAnalysisRunnerCapability,
  isAnalysisDesktopBearerRequest,
  parseAnalysisRunnerCapability,
} from "../../../../../../../../../../lib/workspace-analysis-runner-capability";
import {
  canStageAnalysisRunFragment,
  stageAnalysisRunFragment,
} from "../../../../../../../../../../lib/workspace-analysis-run-store";
import { sealAnalysisResultFragment } from "../../../../../../../../../../lib/workspace-analysis-results";
import { parseAnalysisResultFragment } from "../../../../../../../../../../lib/workspace-analysis-runs";
import {
  analysisBlockResultColumns,
  parseAnalysisArticleVersionPayload,
} from "../../../../../../../../../../lib/workspace-analysis-articles";
import { kickWorkspaceBackgroundTask } from "../../../../../../../../../../lib/workspace-background-scheduler";
import { canonicalHash } from "../../../../../../../../../../lib/workspace-versioning";

type RouteContext = {
  params: Promise<{ workspaceId: string; articleId: string; runId: string }>;
};

function authority(authorization: {
  role: string;
  session: { session: { id: string }; user: { id: string } };
  membership: { id: string };
}) {
  return {
    sessionId: authorization.session.session.id,
    userId: authorization.session.user.id,
    membershipId: authorization.membership.id,
    role: authorization.role,
  };
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  if (!isAnalysisDesktopBearerRequest(request)) {
    return jsonError("Analysis result staging requires a Desktop bearer session", 401);
  }
  const { workspaceId, articleId, runId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId) || !isUuid(runId)) {
    return jsonError("Invalid Analysis Article result fragment scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const runnerCapability = parseAnalysisRunnerCapability(request);
  if (!runnerCapability) return jsonError(
    "Invalid Analysis runner capability",
    request.headers.has(analysisRunnerCapabilityHeader) ? 403 : 428,
  );
  const runnerCapabilityHash = hashAnalysisRunnerCapability(runnerCapability);
  const body = await boundedJsonBody(request, 1_200_000);
  if (!body.ok || !body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return jsonError("Invalid Analysis Article result fragment", 400);
  }
  const row = body.value as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || !("fragment" in row)) {
    return jsonError("Invalid Analysis Article result fragment", 400);
  }
  let fragment;
  try {
    fragment = parseAnalysisResultFragment(row.fragment);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Invalid Analysis Article result fragment",
      400,
    );
  }
  const run = await db.query.workspaceAnalysisArticleRun.findFirst({
    where: and(
      eq(workspaceAnalysisArticleRun.organizationId, workspaceId),
      eq(workspaceAnalysisArticleRun.articleId, articleId),
      eq(workspaceAnalysisArticleRun.id, runId),
      eq(workspaceAnalysisArticleRun.state, "running"),
    ),
  });
  if (!run) return jsonError("Analysis Article run is not active", 409);
  const revisionRow = await db.query.workspaceAnalysisArticleRevision.findFirst({
    where: and(
      eq(workspaceAnalysisArticleRevision.organizationId, workspaceId),
      eq(workspaceAnalysisArticleRevision.articleId, articleId),
      eq(workspaceAnalysisArticleRevision.revision, run.articleRevision),
    ),
    columns: { payload: true },
  });
  let revision;
  try {
    revision = revisionRow ? parseAnalysisArticleVersionPayload(revisionRow.payload) : null;
  } catch {
    revision = null;
  }
  if (!revision || revision.deleted) {
    return jsonError("Analysis Article revision is unavailable", 409);
  }
  const block = revision.definition.blocks.find((candidate) => candidate.id === fragment.blockId);
  let columns;
  try {
    columns = block ? analysisBlockResultColumns(revision.definition, block) : null;
  } catch {
    columns = null;
  }
  if (!columns?.length || canonicalHash(fragment.columns) !== canonicalHash(columns)) {
    return jsonError("Analysis Article result schema does not match its block source", 409);
  }
  const preflight = await canStageAnalysisRunFragment({
    organizationId: workspaceId,
    articleId,
    runId,
    runnerId: run.runnerId,
    runnerCapabilityHash,
    authority: authority(authorization),
  });
  if (!preflight) {
    return jsonError("Analysis result staging authority changed", 409);
  }
  const expiresAt = new Date(
    (run.startedAt ?? run.createdAt).valueOf()
      + revision.definition.refresh.resultRetentionDays * 24 * 60 * 60 * 1_000,
  );
  const sealed = await sealAnalysisResultFragment({
    request,
    workspaceId,
    actorUserId: authorization.session.user.id,
    runId,
    expiresAt,
    fragment,
  });
  const staged = await stageAnalysisRunFragment({
    organizationId: workspaceId,
    articleId,
    runId,
    runnerId: run.runnerId,
    runnerCapabilityHash,
    fragment: sealed,
    authority: authority(authorization),
  });
  if (!staged) {
    return jsonError("Analysis result staging authority changed or its budget was exceeded", 409);
  }
  await kickWorkspaceBackgroundTask({ task: "maintenance", notBefore: expiresAt });
  return privateJson({
    blockId: staged.blockId,
    ordinal: staged.ordinal,
    payloadHash: staged.payloadHash,
  }, {
    status: 201,
    headers: { "x-dopedb-analysis-result-protocol": "staged-v1" },
  });
}
