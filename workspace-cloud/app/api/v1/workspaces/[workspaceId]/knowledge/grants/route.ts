// Graph construction is not shipped. Reads stay empty for current Desktop
// clients, creation fails explicitly, and revocation remains available so old
// persisted grants can still be retired safely.
import { sql } from "drizzle-orm";
import { atomicD1 } from "@/lib/d1/atomic";
import { utcNow } from "@/lib/d1/schema/values";
import { env } from "@/lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import {
  knowledgeMutationAuthority,
  knowledgeMutationAuthoritySql,
} from "@/lib/knowledge/mutation-authority";
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
  const revokedResult = await atomicD1({
    scope: sql`SELECT json_object('memberId', member_id, 'projectEnvironmentId', project_environment_id) AS payload
      FROM knowledge_grant WHERE organization_id = ${workspaceId} AND id = ${grantId} AND revoked_at IS NULL
        AND ${knowledgeMutationAuthoritySql(authority, workspaceId)}`,
    statements: (scope) => [
      sql`UPDATE knowledge_grant SET revoked_at = ${utcNow} WHERE id = ${grantId} AND EXISTS (${scope}) RETURNING id`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${workspaceId}, ${authorization.session.user.id}, 'knowledge.grant.revoke', 'knowledge_grant',
          ${grantId}, payload, ${crypto.randomUUID()} FROM (${scope})`,
    ],
  });
  const revoked = revokedResult.rows[0];
  if (revoked.length !== 1) return jsonError("Knowledge grant was not found", 404);
  return privateJson({ revoked: true });
}
