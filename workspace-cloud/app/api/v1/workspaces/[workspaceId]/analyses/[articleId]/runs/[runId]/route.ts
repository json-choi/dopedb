// Run status and terminal completion. Completion validates every receipt against
// the immutable Article revision, encrypts bounded fragments, then commits all
// evidence and the terminal state atomically.
import { and, eq } from "drizzle-orm";

import { db } from "../../../../../../../../../lib/db";
import { env } from "../../../../../../../../../lib/env";
import {
  boundedJsonBody,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "../../../../../../../../../lib/http";
import {
  workspaceAnalysisArticle,
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
  canStageAnalysisRunFragment,
  commitAnalysisRunCompletion,
  stageAnalysisRunFragment,
  type AnalysisRunAuthority,
} from "../../../../../../../../../lib/workspace-analysis-run-store";
import { sealAnalysisResultFragments } from "../../../../../../../../../lib/workspace-analysis-results";
import {
  analysisResultFragmentsAreComplete,
  parseAnalysisRunCompletion,
} from "../../../../../../../../../lib/workspace-analysis-runs";
import {
  analysisBlockResultColumns,
  parseAnalysisArticleVersionPayload,
} from "../../../../../../../../../lib/workspace-analysis-articles";
import { kickWorkspaceBackgroundTask } from "../../../../../../../../../lib/workspace-background-scheduler";
import { hasWorkspaceCapability } from "../../../../../../../../../lib/workspace-permissions";
import { canonicalHash } from "../../../../../../../../../lib/workspace-versioning";

type RouteContext = {
  params: Promise<{ workspaceId: string; articleId: string; runId: string }>;
};

const stagedResultProtocolHeaders = {
  "x-dopedb-analysis-result-protocol": "staged-v1",
};

function completionError(message: string, status: number) {
  return privateJson({ error: message }, {
    status,
    headers: stagedResultProtocolHeaders,
  });
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
    const rawDefinition = row.payload && typeof row.payload === "object"
      && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>).definition
      : null;
    const legacyConnectionPins = Boolean(rawDefinition && typeof rawDefinition === "object"
      && !Array.isArray(rawDefinition)
      && (rawDefinition as Record<string, unknown>).version === 1);
    const payload = parseAnalysisArticleVersionPayload(row.payload);
    return payload.deleted ? null : { ...payload, legacyConnectionPins };
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
    includeWorking: hasWorkspaceCapability(authorization.role, "write"),
  }) ?? await accessibleAnalysisArticle({
    organizationId: workspaceId,
    articleId,
    memberId: authorization.membership.id,
    includeWorking: false,
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
  if (!mutationAllowed(request, env.appOrigin())) return completionError("Invalid request origin", 403);
  if (!isAnalysisDesktopBearerRequest(request)) {
    return completionError("Analysis run completion requires a Desktop bearer session", 401);
  }
  const { workspaceId, articleId, runId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(articleId) || !isUuid(runId)) {
    return completionError("Invalid Analysis Article run scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return completionError(authorization.error, authorization.status);
  const runnerCapability = parseAnalysisRunnerCapability(request);
  if (!runnerCapability) return completionError(
    "Invalid Analysis runner capability",
    request.headers.has(analysisRunnerCapabilityHeader) ? 403 : 428,
  );
  const runnerCapabilityHash = hashAnalysisRunnerCapability(runnerCapability);
  const run = await db.query.workspaceAnalysisArticleRun.findFirst({
    where: and(
      eq(workspaceAnalysisArticleRun.organizationId, workspaceId),
      eq(workspaceAnalysisArticleRun.articleId, articleId),
      eq(workspaceAnalysisArticleRun.id, runId),
    ),
  });
  if (!run) return completionError("Analysis Article run not found", 404);
  const revision = await runRevision(workspaceId, articleId, run.articleRevision);
  if (!revision) return completionError("Analysis Article revision is unavailable", 409);
  const articleProjection = await db.query.workspaceAnalysisArticle.findFirst({
    where: and(
      eq(workspaceAnalysisArticle.organizationId, workspaceId),
      eq(workspaceAnalysisArticle.id, articleId),
    ),
    columns: { revision: true, state: true, liveRevision: true, deletedAt: true },
  });
  if (!articleProjection || articleProjection.deletedAt) {
    return completionError("Analysis Article is unavailable", 409);
  }
  const mayStoreSharedResults = articleProjection.liveRevision === run.articleRevision
    || (
      articleProjection.revision === run.articleRevision
      && articleProjection.state === "review"
      && revision.definition.refresh.shareReviewedResults
    );
  // New clients send only a small staged-fragment manifest. Keep a bounded
  // temporary inline path so Desktop and cloud can roll independently; payloads
  // above Vercel's buffered request ceiling require the staged protocol.
  const body = await boundedJsonBody(request, 4 * 1024 * 1024);
  if (!body.ok) return completionError("Invalid Analysis Article completion", 400);
  let completion;
  try {
    completion = parseAnalysisRunCompletion(body.value, revision.definition);
  } catch (error) {
    return completionError(
      error instanceof Error ? error.message : "Invalid Analysis Article completion",
      400,
    );
  }
  const connectionByRole = new Map(revision.connections.map((connection) => [connection.role, connection]));
  const queryById = new Map(revision.definition.queries.map((query) => [query.id, query]));
  for (const receipt of completion.queryReceipts) {
    const query = queryById.get(receipt.queryNodeId);
    const connection = query ? connectionByRole.get(query.connectionRole) : null;
    if (!query || !connection || receipt.connectionId !== connection.connectionId
      || (!revision.legacyConnectionPins
        && receipt.connectionRevision !== connection.connectionRevision)
      || receipt.queryHash !== canonicalHash({ sql: query.sql, parameterValues: run.parameterValues })) {
      return completionError("Analysis Article query receipt does not match the immutable revision", 409);
    }
  }
  if (run.state === "running" && !mayStoreSharedResults
    && (completion.fragmentManifest.length > 0 || completion.inlineFragments.length > 0)) {
    return completionError(
      "Draft and private review results stay on Desktop until shared result storage is enabled",
      409,
    );
  }
  if (run.state !== "running") {
    const replayManifest = completion.inlineFragments.length > 0
      ? completion.inlineFragments.map((fragment) => ({
        blockId: fragment.blockId,
        ordinal: fragment.ordinal,
        payloadHash: canonicalHash(fragment),
      }))
      : completion.fragmentManifest;
    const replayed = await commitAnalysisRunCompletion({
      organizationId: workspaceId,
      articleId,
      runId,
      runnerId: run.runnerId,
      runnerCapabilityHash,
      completion: { ...completion, fragmentManifest: replayManifest, inlineFragments: [] },
      fragmentManifest: replayManifest,
      authority: authority(authorization),
    });
    if (!replayed) return completionError("Analysis Article run is already terminal", 409);
    return privateJson({ run: replayed }, {
      headers: stagedResultProtocolHeaders,
    });
  }
  let fragmentManifest = completion.fragmentManifest;
  if (completion.inlineFragments.length > 0) {
    const blockById = new Map(revision.definition.blocks.map((block) => [block.id, block]));
    for (const fragment of completion.inlineFragments) {
      const block = blockById.get(fragment.blockId);
      let columns;
      try {
        columns = block ? analysisBlockResultColumns(revision.definition, block) : null;
      } catch {
        columns = null;
      }
      if (!columns?.length || canonicalHash(fragment.columns) !== canonicalHash(columns)) {
        return completionError("Analysis Article result schema does not match its block source", 409);
      }
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
      return completionError("Analysis result staging authority changed", 409);
    }
    const expiresAt = new Date(
      (run.startedAt ?? run.createdAt).valueOf()
        + revision.definition.refresh.resultRetentionDays * 24 * 60 * 60 * 1_000,
    );
    const sealed = await sealAnalysisResultFragments({
      request,
      workspaceId,
      actorUserId: authorization.session.user.id,
      runId,
      expiresAt,
      fragments: completion.inlineFragments,
    });
    const stagedManifest = [];
    for (const fragment of sealed) {
      const staged = await stageAnalysisRunFragment({
        organizationId: workspaceId,
        articleId,
        runId,
        runnerId: run.runnerId,
        runnerCapabilityHash,
        fragment,
        authority: authority(authorization),
      });
      if (!staged || staged.payloadHash !== fragment.payloadHash) {
        return completionError(
          "Analysis result staging authority changed or its budget was exceeded",
          409,
        );
      }
      stagedManifest.push({
        blockId: String(staged.blockId),
        ordinal: Number(staged.ordinal),
        payloadHash: String(staged.payloadHash),
      });
    }
    await kickWorkspaceBackgroundTask({ task: "maintenance", notBefore: expiresAt });
    fragmentManifest = stagedManifest;
  }
  if (fragmentManifest.length > 0 && !mayStoreSharedResults) {
    return completionError(
      "Draft and private review results stay on Desktop until shared result storage is enabled",
      409,
    );
  }
  if (completion.state === "succeeded"
    && mayStoreSharedResults
    && !analysisResultFragmentsAreComplete(revision.definition, fragmentManifest)) {
    return completionError("Analysis Article shared results are incomplete", 409);
  }
  const updated = await commitAnalysisRunCompletion({
    organizationId: workspaceId,
    articleId,
    runId,
    runnerId: run.runnerId,
    runnerCapabilityHash,
    completion: { ...completion, fragmentManifest, inlineFragments: [] },
    fragmentManifest,
    authority: authority(authorization),
  });
  if (!updated) return completionError("Analysis run authority changed before completion", 409);
  return privateJson({ run: updated }, {
    headers: stagedResultProtocolHeaders,
  });
}
