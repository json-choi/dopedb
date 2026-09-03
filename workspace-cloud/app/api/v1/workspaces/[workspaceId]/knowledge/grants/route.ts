// Graph construction is not shipped. Reads stay empty for current Desktop
// clients, creation fails explicitly, and revocation remains available so old
// persisted grants can still be retired safely.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import {
  knowledgeMutationAuthority,
  knowledgeMutationAuthoritySql,
} from "@/lib/knowledge/mutation-authority";
import { knowledgeGrant, workspaceAuditEvent } from "@/lib/schema";
import { authorizeWorkspace } from "@/lib/workspace-authorization";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const ownOnly = new URL(request.url).searchParams.get("scope") === "mine";
  const authorization = await authorizeWorkspace(
    request,
    workspaceId,
    ownOnly ? "view" : "manage",
  );
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  return privateJson({ grants: [] });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  return jsonError("Knowledge graph grants are not available", 409);
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const authority = knowledgeMutationAuthority(authorization, workspaceId, "manage");
  const parsed = await boundedJsonBody(request, 4 * 1024);
  const body = parsed.ok ? parsed.value as Record<string, unknown> : null;
  if (!body || typeof body.grantId !== "string" || !isUuid(body.grantId)) {
    return jsonError("Invalid Knowledge grant revocation", 400);
  }
  const grantId = body.grantId;
  const revokedResult = await db.execute<{
    id: string;
    memberId: string;
    projectEnvironmentId: string;
  }>(sql`
    WITH actor_authority AS MATERIALIZED (
      SELECT 1 WHERE ${knowledgeMutationAuthoritySql(authority, workspaceId)}
    ), revoked AS MATERIALIZED (
      UPDATE ${knowledgeGrant} AS issued_grant
      SET "revoked_at" = ${new Date()}
      WHERE issued_grant."organization_id" = ${workspaceId}
        AND issued_grant."id" = ${grantId}::uuid
        AND issued_grant."revoked_at" IS NULL
        AND EXISTS (SELECT 1 FROM actor_authority)
      RETURNING issued_grant."id"::text AS "id",
        issued_grant."member_id" AS "memberId",
        issued_grant."project_environment_id"::text AS "projectEnvironmentId"
    ), audited AS (
      INSERT INTO ${workspaceAuditEvent}
        ("organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      SELECT ${workspaceId}, ${authorization.session.user.id},
        'knowledge.grant.revoke', 'knowledge_grant', revoked."id",
        jsonb_build_object(
          'memberId', revoked."memberId",
          'projectEnvironmentId', revoked."projectEnvironmentId"
        ), ${crypto.randomUUID()}::uuid
      FROM revoked
      RETURNING "id"
    )
    SELECT revoked.* FROM revoked, audited
  `);
  const revoked = revokedResult.rows;
  if (revoked.length !== 1) return jsonError("Knowledge grant was not found", 404);
  return privateJson({ revoked: true });
}
