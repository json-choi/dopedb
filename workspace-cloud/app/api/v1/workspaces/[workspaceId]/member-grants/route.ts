// Administrator view of every member's grant on every shared connection, with each
// provisioned database's per-member principal status (the single Members permission table).
import { isUuid, jsonError, privateJson } from "@/lib/http";
import { authorizeWorkspace } from "@/lib/workspace-authorization";
import { directRateLimited } from "@/lib/workspace-direct-access-http";
import { listWorkspaceMemberGrants } from "@/lib/workspace-member-grants";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  const limited = await directRateLimited("member-grants", `${workspaceId}:${authorization.session.user.id}`, 30);
  if (limited) return limited;
  return privateJson(await listWorkspaceMemberGrants(workspaceId));
}
