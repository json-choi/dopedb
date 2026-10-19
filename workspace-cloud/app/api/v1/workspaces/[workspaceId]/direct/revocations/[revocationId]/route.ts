// Settle one pending revocation item. `cancelled` lifts the cap; `applied` is accepted
// only once the member's principal is absent, dropped or already at most the target level.
import { env } from "@/lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import { authorizeDirectAdmin, directRateLimited, directRevocationWire } from "@/lib/workspace-direct-access-http";
import { loadDirectRevocation, settleDirectRevocation } from "@/lib/workspace-direct-access-store";

type RouteContext = { params: Promise<{ workspaceId: string; revocationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId, revocationId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(revocationId)) return jsonError("Invalid workspace or revocation id", 400);
  const parsed = await boundedJsonBody(request, 256);
  if (!parsed.ok) return jsonError("Invalid revocation settlement", parsed.reason === "too_large" ? 413 : 400);
  const body = parsed.value as { state?: unknown } | null;
  if (
    !body || typeof body !== "object" || Object.keys(body).length !== 1
    || (body.state !== "applied" && body.state !== "cancelled")
  ) return jsonError("Invalid revocation settlement", 400);
  const item = await loadDirectRevocation(workspaceId, revocationId);
  if (!item) return jsonError("Revocation not found", 404);
  const admin = await authorizeDirectAdmin(request, workspaceId, item.connectionId);
  if (!admin.ok) return admin.response;
  const limited = await directRateLimited(
    "direct-revocation-settle", `${workspaceId}:${admin.authority.userId}:${item.connectionId}`, 60);
  if (limited) return limited;
  const settled = await settleDirectRevocation({
    organizationId: workspaceId,
    connectionId: item.connectionId,
    revocationId,
    actorUserId: admin.authority.userId,
    to: body.state,
  });
  if (!settled) {
    return jsonError(
      "Revocation is already settled or the database principal has not been lowered yet",
      409,
      "direct_revocation_unsettled",
    );
  }
  const settledItem = await loadDirectRevocation(workspaceId, revocationId);
  return privateJson({ revocation: settledItem ? directRevocationWire(settledItem) : null });
}
