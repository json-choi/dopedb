// Workspace view of pending revocation items (Members surface) and administrator-declared
// revocation intent. While an item is pending, the derived work list caps that member's
// desired level at its target so no device re-grants access that is being removed.
import { env } from "@/lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import { authorizeWorkspace } from "@/lib/workspace-authorization";
import { DIRECT_ADMIN_REVOCATION_KINDS } from "@/lib/workspace-direct-access-core";
import {
  authorizeDirectAdmin,
  directRateLimited,
  directRevocationWire,
} from "@/lib/workspace-direct-access-http";
import { createDirectRevocations, listPendingDirectRevocations } from "@/lib/workspace-direct-access-store";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const limited = await directRateLimited("direct-revocations", `${workspaceId}:${authorization.session.user.id}`, 60);
  if (limited) return limited;
  const items = await listPendingDirectRevocations({ organizationId: workspaceId });
  return privateJson({ workspaceId, revocations: items.map(directRevocationWire) });
}

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const parsed = await boundedJsonBody(request, 32 * 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Revocation is too large" : "Invalid revocation",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as Record<string, unknown> | null;
  const kind = body?.kind;
  const targetLevel = body?.targetLevel;
  const memberIds = body?.memberIds;
  if (
    !body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 4
    || typeof body.connectionId !== "string" || !isUuid(body.connectionId)
    || !(DIRECT_ADMIN_REVOCATION_KINDS as readonly unknown[]).includes(kind)
    || (targetLevel !== "none" && targetLevel !== "read")
    || (targetLevel === "read" && kind !== "grant_lowered" && kind !== "role_lowered")
    || !Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > 200
    || new Set(memberIds).size !== memberIds.length
    || !memberIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)
  ) return jsonError("Invalid revocation", 400);
  const admin = await authorizeDirectAdmin(request, workspaceId, body.connectionId);
  if (!admin.ok) return admin.response;
  const limited = await directRateLimited(
    "direct-revocation-create", `${workspaceId}:${admin.authority.userId}:${body.connectionId}`, 30);
  if (limited) return limited;
  const items = await createDirectRevocations({
    organizationId: workspaceId,
    connectionId: body.connectionId,
    authority: admin.authority,
    memberIds: memberIds as string[],
    kind: kind as (typeof DIRECT_ADMIN_REVOCATION_KINDS)[number],
    targetLevel,
  });
  if (!items) return jsonError("Direct database access changed. Refresh and retry.", 409);
  return privateJson({ revocations: items.map(directRevocationWire) }, { status: 201 });
}
