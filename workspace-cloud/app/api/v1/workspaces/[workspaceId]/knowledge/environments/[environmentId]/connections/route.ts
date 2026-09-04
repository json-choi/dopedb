import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
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

  const bindingResult = await db.execute<{
    id: string;
    projectEnvironmentId: string;
    environmentRevision: number;
    connectionId: string;
    connectionRevision: number;
    connectionContentRevision: number;
    connectionName: string;
    role: string;
    alias: string;
    inserted: boolean;
  }>(sql`
    WITH actor_authority AS MATERIALIZED (
      SELECT 1 WHERE ${knowledgeMutationAuthoritySql(authority, workspaceId)}
    ), scope AS MATERIALIZED (
      SELECT environment."id", environment."revision" AS environment_revision,
        connection."id" AS connection_id,
        connection."content_revision" AS connection_revision,
        connection."content_revision" AS connection_content_revision,
        connection."name" AS connection_name
      FROM ${knowledgeProjectEnvironment} AS environment
      JOIN ${knowledgeProject} AS project
        ON project."organization_id" = environment."organization_id"
       AND project."id" = environment."project_id"
       AND project."deleted_at" IS NULL
      JOIN ${workspaceConnection} AS connection
        ON connection."organization_id" = environment."organization_id"
       AND connection."id" = ${body.connectionId}::uuid
       AND connection."deleted_at" IS NULL
       AND connection."revocation_pending_at" IS NULL
       AND connection."revocation_claim_id" IS NULL
       AND (${expectedConnectionRevision === null}
         OR connection."content_revision" = ${expectedConnectionRevision ?? 0})
      CROSS JOIN actor_authority
      WHERE environment."organization_id" = ${workspaceId}
        AND environment."id" = ${environmentId}::uuid
      FOR UPDATE OF project, environment, connection
    ), active_assignment AS MATERIALIZED (
      SELECT binding."project_environment_id"
      FROM ${knowledgeEnvironmentConnection} AS binding
      JOIN scope ON scope.connection_id = binding."connection_id"
      WHERE binding."organization_id" = ${workspaceId}
        AND binding."revoked_at" IS NULL
    ), updated AS MATERIALIZED (
      UPDATE ${knowledgeEnvironmentConnection} AS binding
      SET "environment_revision" = scope.environment_revision,
        "connection_revision" = scope.connection_revision,
        "role" = ${body.role.trim()}, "alias" = ${body.alias.trim()}
      FROM scope
      WHERE binding."organization_id" = ${workspaceId}
        AND binding."project_environment_id" = scope."id"
        AND binding."connection_id" = scope.connection_id
        AND binding."revoked_at" IS NULL
      RETURNING binding.*, scope.connection_name, scope.connection_content_revision
    ), inserted AS MATERIALIZED (
      INSERT INTO ${knowledgeEnvironmentConnection}
        ("id", "organization_id", "project_environment_id", "environment_revision",
         "connection_id", "connection_revision", "role", "alias")
      SELECT ${body.bindingId}::uuid, ${workspaceId}, scope."id", scope.environment_revision,
        scope.connection_id, scope.connection_revision, ${body.role.trim()}, ${body.alias.trim()}
      FROM scope
      WHERE NOT EXISTS (SELECT 1 FROM updated)
        AND NOT EXISTS (SELECT 1 FROM active_assignment)
      ON CONFLICT DO NOTHING
      RETURNING *
    )
    SELECT updated."id"::text, updated."project_environment_id"::text AS "projectEnvironmentId",
      updated."environment_revision"::integer AS "environmentRevision",
      updated."connection_id"::text AS "connectionId",
      updated."connection_revision"::integer AS "connectionRevision",
      updated.connection_content_revision::integer AS "connectionContentRevision",
      updated.connection_name AS "connectionName", updated."role", updated."alias", false AS inserted
    FROM updated
    UNION ALL
    SELECT inserted."id"::text, inserted."project_environment_id"::text,
      inserted."environment_revision"::integer, inserted."connection_id"::text,
      inserted."connection_revision"::integer, scope.connection_content_revision::integer,
      scope.connection_name,
      inserted."role", inserted."alias", true
    FROM inserted JOIN scope ON scope."id" = inserted."project_environment_id"
  `);
  const binding = bindingResult.rows[0];
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
