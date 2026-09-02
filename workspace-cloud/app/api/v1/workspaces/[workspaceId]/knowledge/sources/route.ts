import { and, eq, isNull, sql } from "drizzle-orm";
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
import {
  listGithubRepositories,
  resolveGithubCommit,
} from "@/lib/knowledge/github-app";
import { listKnowledgeSources } from "@/lib/knowledge/inventory";
import {
  knowledgeMutationAuthority,
  knowledgeMutationAuthoritySql,
} from "@/lib/knowledge/mutation-authority";
import { enqueueInitialGithubKnowledgeSync } from "@/lib/knowledge/sync-queue";
import {
  knowledgeGithubInstallation,
  knowledgeProject,
  knowledgeProjectEnvironment,
  knowledgeSource,
} from "@/lib/schema";
import { authorizeWorkspace } from "@/lib/workspace-authorization";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  return privateJson({ sources: await listKnowledgeSources(workspaceId) });
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
  if (
    !body
    || body.provider !== "github"
    || typeof body.sourceId !== "string"
    || !isUuid(body.sourceId)
    || typeof body.projectId !== "string"
    || !isUuid(body.projectId)
    || typeof body.projectEnvironmentId !== "string"
    || !isUuid(body.projectEnvironmentId)
    || typeof body.displayName !== "string"
    || !isSafeDisplayText(body.displayName.trim(), 512)
  ) {
    return jsonError("Invalid Knowledge source", 400);
  }
  const [environment] = await db.select({
    id: knowledgeProjectEnvironment.id,
    projectId: knowledgeProjectEnvironment.projectId,
    revision: knowledgeProjectEnvironment.revision,
  }).from(knowledgeProjectEnvironment).innerJoin(
    knowledgeProject,
    and(
      eq(knowledgeProject.organizationId, knowledgeProjectEnvironment.organizationId),
      eq(knowledgeProject.id, knowledgeProjectEnvironment.projectId),
      isNull(knowledgeProject.deletedAt),
    ),
  ).where(and(
    eq(knowledgeProjectEnvironment.organizationId, workspaceId),
    eq(knowledgeProjectEnvironment.id, body.projectEnvironmentId),
    eq(knowledgeProjectEnvironment.projectId, body.projectId),
  )).limit(1);
  if (!environment) {
    return jsonError("Project Environment was not found", 404);
  }
  if (
    typeof body.installationId !== "string"
    || !isUuid(body.installationId)
    || typeof body.repositoryId !== "string"
    || !/^[1-9][0-9]{0,19}$/.test(body.repositoryId)
    || typeof body.repositoryFullName !== "string"
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(body.repositoryFullName)
    || typeof body.refName !== "string"
    || !/^[A-Za-z0-9._\/-]{1,255}$/.test(body.refName)
    || body.refName.includes("..")
    || body.refName.includes("//")
  ) {
    return jsonError("Invalid GitHub Knowledge source", 400);
  }
  const [installation] = await db.select({
    id: knowledgeGithubInstallation.id,
    installationId: knowledgeGithubInstallation.installationId,
  }).from(knowledgeGithubInstallation).where(and(
    eq(knowledgeGithubInstallation.organizationId, workspaceId),
    eq(knowledgeGithubInstallation.id, body.installationId),
    eq(knowledgeGithubInstallation.status, "active"),
  )).limit(1);
  if (!installation) {
    return jsonError("GitHub installation was not found", 404);
  }
  try {
    const repositories = await listGithubRepositories(installation.installationId);
    const repository = repositories.find((candidate) =>
      String(candidate.id) === body.repositoryId
      && candidate.full_name === body.repositoryFullName
    );
    if (!repository || repository.archived) {
      return jsonError("GitHub repository is not available to this installation", 403);
    }
    const commitSha = await resolveGithubCommit(
      installation.installationId,
      repository.full_name,
      body.refName,
    );
    const insertedResult = await db.execute<{
      id: string;
      syncRevision: number;
      environmentRevision: number;
      commitSha: string;
    }>(sql`
      INSERT INTO ${knowledgeSource}
        ("id", "organization_id", "project_id", "project_environment_id",
         "environment_revision", "provider", "display_name", "visibility",
         "github_installation_id", "repository_id", "repository_full_name",
         "ref_name", "commit_sha", "sync_state")
      SELECT ${body.sourceId}::uuid, ${workspaceId}, environment."project_id",
        environment."id", environment."revision", 'github', ${body.displayName.trim()},
        'shared_graph', installation."id", ${body.repositoryId}, ${repository.full_name},
        ${body.refName}, ${commitSha}, ${env.knowledgeGraphBuildsEnabled() ? "pending" : "ready"}
      FROM ${knowledgeProjectEnvironment} AS environment
      JOIN ${knowledgeProject} AS project
        ON project."organization_id" = environment."organization_id"
       AND project."id" = environment."project_id"
       AND project."deleted_at" IS NULL
      JOIN ${knowledgeGithubInstallation} AS installation
        ON installation."organization_id" = environment."organization_id"
       AND installation."id" = ${installation.id}::uuid
       AND installation."status" = 'active'
      WHERE environment."organization_id" = ${workspaceId}
        AND environment."id" = ${body.projectEnvironmentId}::uuid
        AND environment."project_id" = ${body.projectId}::uuid
        AND environment."revision" = ${environment.revision}
        AND ${knowledgeMutationAuthoritySql(authority, workspaceId)}
      ON CONFLICT DO NOTHING
      RETURNING "id"::text, "sync_revision"::integer AS "syncRevision",
        "environment_revision"::integer AS "environmentRevision", "commit_sha" AS "commitSha"
    `);
    const inserted = insertedResult.rows[0];
    const [source] = inserted ? [inserted] : await db.select({
      id: knowledgeSource.id,
      syncRevision: knowledgeSource.syncRevision,
      environmentRevision: knowledgeSource.environmentRevision,
      commitSha: knowledgeSource.commitSha,
      projectId: knowledgeSource.projectId,
      projectEnvironmentId: knowledgeSource.projectEnvironmentId,
      provider: knowledgeSource.provider,
      githubInstallationId: knowledgeSource.githubInstallationId,
      repositoryId: knowledgeSource.repositoryId,
      repositoryFullName: knowledgeSource.repositoryFullName,
      refName: knowledgeSource.refName,
    }).from(knowledgeSource).where(and(
      eq(knowledgeSource.organizationId, workspaceId),
      eq(knowledgeSource.id, body.sourceId),
    )).limit(1);
    if (
      !source
      || ("provider" in source && (
        source.projectId !== body.projectId
        || source.projectEnvironmentId !== body.projectEnvironmentId
        || source.provider !== "github"
        || source.githubInstallationId !== installation.id
        || source.repositoryId !== body.repositoryId
        || source.repositoryFullName !== repository.full_name
        || source.refName !== body.refName
      ))
    ) return jsonError("Knowledge source id is already bound", 409);
    if (env.knowledgeGraphBuildsEnabled()) {
      const jobId = await enqueueInitialGithubKnowledgeSync({
        organizationId: workspaceId,
        sourceId: body.sourceId,
        commitSha,
        authority,
      });
      if (!jobId) return jsonError("Knowledge source authority changed", 409);
    }
    return privateJson({ source }, { status: 201 });
  } catch {
    return jsonError("GitHub source verification failed", 424);
  }
}
