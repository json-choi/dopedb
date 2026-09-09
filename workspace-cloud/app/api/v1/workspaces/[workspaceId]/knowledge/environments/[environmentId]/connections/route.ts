import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { atomicD1 } from "@/lib/d1/atomic";
import { env } from "@/lib/env";
import {
  knowledgeMutationAuthority,
  knowledgeMutationAuthoritySql,
} from "@/lib/knowledge/mutation-authority";
import {
  boundedJsonBody,
  isSafeDisplayText,
  isUuid,
  jsonError,
  mutationAllowed,
  privateJson,
} from "@/lib/http";
import {
  knowledgeEnvironmentConnection,
  knowledgeProject,
  knowledgeProjectEnvironment,
  workspaceConnection,
} from "@/lib/schema";
import { authorizeWorkspace } from "@/lib/workspace-authorization";

type RouteContext = {
  params: Promise<{ workspaceId: string; environmentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, environmentId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(environmentId)) {
    return jsonError("Invalid Environment scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "view");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const bindings = await db.select({
    id: knowledgeEnvironmentConnection.id,
    projectEnvironmentId: knowledgeEnvironmentConnection.projectEnvironmentId,
    environmentRevision: knowledgeEnvironmentConnection.environmentRevision,
    connectionId: knowledgeEnvironmentConnection.connectionId,
    connectionRevision: knowledgeEnvironmentConnection.connectionRevision,
    // Desktop pins the public content revision. The internal revocation/lease
    // epoch must never leak into or invalidate a Project resource binding.
    currentConnectionRevision: workspaceConnection.contentRevision,
    connectionContentRevision: workspaceConnection.contentRevision,
    connectionName: workspaceConnection.name,
    role: knowledgeEnvironmentConnection.role,
    alias: knowledgeEnvironmentConnection.alias,
  }).from(knowledgeEnvironmentConnection).innerJoin(
    workspaceConnection,
    and(
      eq(workspaceConnection.organizationId, knowledgeEnvironmentConnection.organizationId),
      eq(workspaceConnection.id, knowledgeEnvironmentConnection.connectionId),
      isNull(workspaceConnection.deletedAt),
    ),
  ).where(and(
    eq(knowledgeEnvironmentConnection.organizationId, workspaceId),
    eq(knowledgeEnvironmentConnection.projectEnvironmentId, environmentId),
    isNull(knowledgeEnvironmentConnection.revokedAt),
  ));
  return privateJson({
    bindings: bindings.map((binding) => ({
      ...binding,
      stale: binding.connectionRevision !== binding.currentConnectionRevision,
    })),
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, environmentId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(environmentId)) {
    return jsonError("Invalid Environment scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = knowledgeMutationAuthority(authorization, workspaceId, "manage");
  const parsed = await boundedJsonBody(request, 8 * 1024);
  const body = parsed.ok ? parsed.value as Record<string, unknown> : null;
  if (
    !body
    || typeof body.bindingId !== "string"
    || !isUuid(body.bindingId)
    || typeof body.connectionId !== "string"
    || !isUuid(body.connectionId)
    || (
      body.expectedConnectionRevision !== undefined
      && (
        typeof body.expectedConnectionRevision !== "number"
        || !Number.isSafeInteger(body.expectedConnectionRevision)
        || body.expectedConnectionRevision < 1
      )
    )
    || typeof body.role !== "string"
    || !isSafeDisplayText(body.role.trim(), 64)
    || typeof body.alias !== "string"
    || !isSafeDisplayText(body.alias.trim(), 128)
  ) return jsonError("Invalid Environment connection binding", 400);
  const expectedConnectionRevision = body.expectedConnectionRevision === undefined
    ? null
    : body.expectedConnectionRevision as number;
  const bindingRole = body.role.trim();
  const bindingAlias = body.alias.trim();

  const bindingResult = await atomicD1({
    scope: sql`SELECT json_object('id', COALESCE(binding.id, ${body.bindingId}), 'inserted', binding.id IS NULL,
        'environmentRevision', environment.revision, 'connectionRevision', connection.content_revision,
        'connectionName', connection.name) AS payload
      FROM knowledge_project_environment environment JOIN knowledge_project project
        ON project.organization_id = environment.organization_id AND project.id = environment.project_id AND project.deleted_at IS NULL
      JOIN workspace_connection connection ON connection.organization_id = environment.organization_id
        AND connection.id = ${body.connectionId} AND connection.deleted_at IS NULL
        AND connection.revocation_pending_at IS NULL AND connection.revocation_claim_id IS NULL
        AND (${expectedConnectionRevision === null} OR connection.content_revision = ${expectedConnectionRevision ?? 0})
      LEFT JOIN knowledge_environment_connection binding ON binding.organization_id = environment.organization_id
        AND binding.project_environment_id = environment.id AND binding.connection_id = connection.id AND binding.revoked_at IS NULL
      WHERE environment.organization_id = ${workspaceId} AND environment.id = ${environmentId}
        AND ${knowledgeMutationAuthoritySql(authority, workspaceId)}
        AND NOT EXISTS (SELECT 1 FROM knowledge_environment_connection WHERE organization_id = ${workspaceId}
          AND connection_id = connection.id AND project_environment_id <> environment.id AND revoked_at IS NULL)
        AND (binding.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM knowledge_environment_connection WHERE id = ${body.bindingId}))`,
    statements: (scope) => [
      sql`UPDATE knowledge_environment_connection SET
          environment_revision = (SELECT payload ->> 'environmentRevision' FROM (${scope})),
          connection_revision = (SELECT payload ->> 'connectionRevision' FROM (${scope})),
          role = ${bindingRole}, alias = ${bindingAlias}
        WHERE id = (SELECT payload ->> 'id' FROM (${scope}) WHERE payload ->> 'inserted' = 0)`,
      sql`INSERT INTO knowledge_environment_connection (id, organization_id, project_environment_id, environment_revision,
          connection_id, connection_revision, role, alias)
        SELECT ${body.bindingId}, ${workspaceId}, ${environmentId}, payload ->> 'environmentRevision',
          ${body.connectionId}, payload ->> 'connectionRevision', ${bindingRole}, ${bindingAlias}
          FROM (${scope}) WHERE payload ->> 'inserted' = 1`,
      sql`SELECT binding.id, project_environment_id AS projectEnvironmentId, environment_revision AS environmentRevision,
          connection_id AS connectionId, connection_revision AS connectionRevision,
          payload ->> 'connectionRevision' AS connectionContentRevision, payload ->> 'connectionName' AS connectionName,
          role, alias, payload ->> 'inserted' AS inserted
        FROM knowledge_environment_connection binding CROSS JOIN (${scope}) WHERE binding.id = payload ->> 'id'`,
    ],
  });
  const binding = bindingResult.rows[2][0];
  if (!binding) {
    const [activeAssignment] = await db.select({
      projectEnvironmentId: knowledgeEnvironmentConnection.projectEnvironmentId,
    }).from(knowledgeEnvironmentConnection).where(and(
      eq(knowledgeEnvironmentConnection.organizationId, workspaceId),
      eq(knowledgeEnvironmentConnection.connectionId, body.connectionId as string),
      isNull(knowledgeEnvironmentConnection.revokedAt),
    )).limit(1);
    if (
      activeAssignment
      && activeAssignment.projectEnvironmentId !== environmentId
    ) {
      return jsonError(
        "Connection is already assigned to another Project in this workspace",
        409,
      );
    }
    return jsonError("Environment or connection changed", 409);
  }
  const { inserted, ...responseBinding } = binding;
  return privateJson({
    binding: {
      ...responseBinding,
      currentConnectionRevision: binding.connectionRevision,
      stale: false,
    },
  }, { status: inserted ? 201 : 200 });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, environmentId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(environmentId)) {
    return jsonError("Invalid Environment scope", 400);
  }
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = knowledgeMutationAuthority(authorization, workspaceId, "manage");
  const parsed = await boundedJsonBody(request, 4 * 1024);
  const body = parsed.ok ? parsed.value as Record<string, unknown> : null;
  if (!body || typeof body.bindingId !== "string" || !isUuid(body.bindingId)) {
    return jsonError("Invalid Environment connection binding", 400);
  }
  const updated = await db.update(knowledgeEnvironmentConnection).set({
    revokedAt: new Date(),
  }).where(and(
    eq(knowledgeEnvironmentConnection.organizationId, workspaceId),
    eq(knowledgeEnvironmentConnection.projectEnvironmentId, environmentId),
    eq(knowledgeEnvironmentConnection.id, body.bindingId),
    isNull(knowledgeEnvironmentConnection.revokedAt),
    knowledgeMutationAuthoritySql(authority, workspaceId),
  )).returning({ id: knowledgeEnvironmentConnection.id });
  if (updated.length !== 1) {
    const [existing] = await db.select({
      id: knowledgeEnvironmentConnection.id,
    }).from(knowledgeEnvironmentConnection).where(and(
      eq(knowledgeEnvironmentConnection.organizationId, workspaceId),
      eq(knowledgeEnvironmentConnection.projectEnvironmentId, environmentId),
      eq(knowledgeEnvironmentConnection.id, body.bindingId),
    )).limit(1);
    if (!existing) return jsonError("Environment connection binding not found", 404);
  }
  return privateJson({ removed: true });
}
