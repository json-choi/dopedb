import { isUuid, jsonError } from "@/lib/http";

type RouteContext = { params: Promise<{ workspaceId: string; sourceId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { workspaceId, sourceId } = await context.params;
  const grantId = new URL(request.url).searchParams.get("grantId");
  if (!isUuid(workspaceId) || !isUuid(sourceId) || !grantId || !isUuid(grantId)) {
    return jsonError("Invalid Knowledge graph request", 400);
  }
  return jsonError("Knowledge graph access is not available", 409);
}
