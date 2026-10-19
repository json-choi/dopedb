// Administrator-device work list for one direct shared database: the derived desired
// level per member principal plus the pending revocation items that cap it.
import { isUuid, jsonError, privateJson } from "@/lib/http";
import { directRateLimited, authorizeDirectAdmin, directWorkListWire } from "@/lib/workspace-direct-access-http";

type RouteContext = { params: Promise<{ workspaceId: string; connectionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, connectionId } = await context.params;
  if (!isUuid(workspaceId) || !isUuid(connectionId)) return jsonError("Invalid workspace or connection id", 400);
  const admin = await authorizeDirectAdmin(request, workspaceId, connectionId);
  if (!admin.ok) return admin.response;
  const limited = await directRateLimited(
    "direct-work", `${workspaceId}:${admin.authority.userId}:${connectionId}`, 60);
  if (limited) return limited;
  return privateJson(await directWorkListWire(workspaceId, connectionId, admin.endpoint));
}
