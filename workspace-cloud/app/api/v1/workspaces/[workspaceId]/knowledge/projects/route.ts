import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  boundedJsonBody,
  isSafeDisplayText,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "@/lib/http";
import { insertKnowledgeProject } from "@/lib/knowledge/project-store";
import { parseEnvironmentKind } from "@/lib/knowledge/environment-kind";
import {
  knowledgeMutationAuthority,
  knowledgeMutationAuthoritySql,
} from "@/lib/knowledge/mutation-authority";
import { listKnowledgeProjects } from "@/lib/knowledge/inventory";
import { knowledgeProject } from "@/lib/schema";
import { authorizeWorkspace } from "@/lib/workspace-authorization";
import {
  databaseErrorCode,
  logKnowledgeMutationFailure,
} from "@/lib/workspace-server-log";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  return privateJson({ projects: await listKnowledgeProjects(workspaceId) });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = knowledgeMutationAuthority(authorization, workspaceId, "manage");
  const parsed = await boundedJsonBody(request, 16 * 1024);
  const body = parsed.ok ? parsed.value as Record<string, unknown> : null;
  const environments = Array.isArray(body?.environments) ? body.environments : [];
  if (
    !body
    || typeof body.name !== "string"
    || !isSafeDisplayText(body.name.trim(), 512)
    || environments.length < 1
    || environments.length > 4
  ) {
    return jsonError("Invalid Project Knowledge scope", 400);
  }
  // `{kind}` is the shape; pre-kind Desktops send `{name, riskClass}`, read as the kind.
  const kinds = environments.map((value) => parseEnvironmentKind(value));
  const normalizedEnvironments = kinds.filter((kind) => kind !== null);
  if (normalizedEnvironments.length !== kinds.length) {
    return jsonError("Invalid Project Knowledge scope", 400);
  }
  if (new Set(normalizedEnvironments).size !== normalizedEnvironments.length) {
    return jsonError("A Project holds one Environment per kind", 400);
  }
  const projectName = body.name.trim();
  try {
    const created = await insertKnowledgeProject({
      organizationId: workspaceId,
      name: projectName,
      environments: normalizedEnvironments,
      authority,
    });
    if (!created) {
      return jsonError("Project name is already in use", 409);
    }
    return privateJson({ project: created }, { status: 201 });
  } catch (error) {
    logKnowledgeMutationFailure({
      operation: "project_create",
      databaseCode: databaseErrorCode(error),
    });
    return jsonError("Project could not be created", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = knowledgeMutationAuthority(authorization, workspaceId, "manage");
  const parsed = await boundedJsonBody(request, 8 * 1024);
  const body = parsed.ok ? parsed.value as Record<string, unknown> : null;
  if (
    !body
    || typeof body.projectId !== "string"
    || !isUuid(body.projectId)
    || typeof body.expectedRevision !== "number"
    || !Number.isSafeInteger(body.expectedRevision)
    || body.expectedRevision < 1
    || typeof body.name !== "string"
    || !isSafeDisplayText(body.name.trim(), 512)
  ) return jsonError("Invalid Project update", 400);
  const updated = await db.update(knowledgeProject).set({
    name: body.name.trim(),
    revision: body.expectedRevision + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(knowledgeProject.organizationId, workspaceId),
    eq(knowledgeProject.id, body.projectId),
    eq(knowledgeProject.revision, body.expectedRevision),
    isNull(knowledgeProject.deletedAt),
    knowledgeMutationAuthoritySql(authority, workspaceId),
  )).returning({ id: knowledgeProject.id, revision: knowledgeProject.revision });
  if (updated.length !== 1) return jsonError("Project revision changed", 409);
  return privateJson({ project: updated[0] });
}
