// Administrator-device lease on principals it is about to change. The direction (apply or
// drop) is derived on the server; a principal held by another device or with no work is
// simply not returned.
import { env } from "@/lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import { DIRECT_CLAIM_LEASE_SECONDS } from "@/lib/workspace-direct-access-core";
import { authorizeDirectAdmin, directRateLimited, directWorkItemWire } from "@/lib/workspace-direct-access-http";
import { claimDirectWork } from "@/lib/workspace-direct-access-store";

type RouteContext = { params: Promise<{ workspaceId: string; connectionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) return jsonError("Invalid workspace or connection id", 400);
  const admin = await authorizeDirectAdmin(request, workspaceId, connectionId);
  if (!admin.ok) return admin.response;
  const limited = await directRateLimited(
    "direct-claim", `${workspaceId}:${admin.authority.userId}:${connectionId}`, 60);
  if (limited) return limited;
  const parsed = await boundedJsonBody(request, 8 * 1_024);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Claim is too large" : "Invalid claim",
      parsed.reason === "too_large" ? 413 : 400,
    );
  }
  const body = parsed.value as { deviceId?: unknown; principalIds?: unknown } | null;
  if (
    !body || typeof body !== "object" || Object.keys(body).length !== 2
    || typeof body.deviceId !== "string" || body.deviceId.length < 1 || body.deviceId.length > 128
    || /[\u0000-\u001f\u007f]/u.test(body.deviceId)
    || !Array.isArray(body.principalIds) || body.principalIds.length < 1 || body.principalIds.length > 100
    || !body.principalIds.every((id) => typeof id === "string" && isUuid(id))
  ) return jsonError("Invalid claim", 400);
  const items = await claimDirectWork({
    organizationId: workspaceId,
    connectionId,
    deviceId: body.deviceId,
    actorUserId: admin.authority.userId,
    principalIds: body.principalIds as string[],
  });
  return privateJson({
    connectionId,
    deviceId: body.deviceId,
    leaseSeconds: DIRECT_CLAIM_LEASE_SECONDS,
    items: items.map(directWorkItemWire),
  });
}
