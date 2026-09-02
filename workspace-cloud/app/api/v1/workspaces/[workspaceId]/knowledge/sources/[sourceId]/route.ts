import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import { requeueGithubKnowledgeSync } from "@/lib/knowledge/sync-queue";
import {
  knowledgeMutationAuthority,
  knowledgeMutationAuthoritySql,
} from "@/lib/knowledge/mutation-authority";
import { knowledgeSource } from "@/lib/schema";
import { authorizeWorkspace } from "@/lib/workspace-authorization";

type RouteContext = { params: Promise<{ workspaceId: string; sourceId: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, sourceId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(sourceId)) return jsonError("Invalid source id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (!env.knowledgeGraphBuildsEnabled()) {
    return jsonError("Knowledge graph indexing is temporarily disabled; this source is available through exact-commit browsing", 409);
  }
  const authority = knowledgeMutationAuthority(authorization, workspaceId, "manage");
  const queued = await requeueGithubKnowledgeSync({
    organizationId: workspaceId,
    sourceId,
    authority,
  });
  if (!queued) return jsonError("GitHub Knowledge source not found", 404);
  return privateJson({ queued: true, ...queued }, { status: 202 });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, sourceId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(sourceId)) return jsonError("Invalid source id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = knowledgeMutationAuthority(authorization, workspaceId, "manage");
  const revoked = await db.update(knowledgeSource).set({
    syncState: "revoked",
    revokedAt: new Date(),
    updatedAt: new Date(),
    syncRevision: sql`${knowledgeSource.syncRevision} + 1`,
  }).where(and(
    eq(knowledgeSource.organizationId, workspaceId),
    eq(knowledgeSource.id, sourceId),
    isNull(knowledgeSource.revokedAt),
    knowledgeMutationAuthoritySql(authority, workspaceId),
  )).returning({ id: knowledgeSource.id });
  if (revoked.length !== 1) return jsonError("Knowledge source not found", 404);
  return privateJson({ revoked: true });
}
