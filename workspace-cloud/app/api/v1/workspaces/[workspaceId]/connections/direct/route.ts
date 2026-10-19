// Register a direct shared database: the secretless connection record and its endpoint
// (engine, scope, write ceiling) are created in one atomic batch. Administrator-only.
import { env } from "@/lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "@/lib/http";
import { authorizeWorkspace } from "@/lib/workspace-authorization";
import { directRateLimited } from "@/lib/workspace-direct-access-http";
import { loadDirectConnectionView } from "@/lib/workspace-direct-access-store";
import { parseDirectEndpoint, publicConnection } from "@/lib/workspace-connections";
import { connectionVersionPayload, parseExpectedRevision } from "@/lib/workspace-versioning";
import { commitConnectionCreate } from "@/lib/workspace-versioning-store";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { workspaceId } = await context.params;
  if (!isUuid(workspaceId)) return jsonError("Invalid workspace id", 400);
  const authorization = await authorizeWorkspace(request, workspaceId, "manage");
  if (!authorization.ok) return jsonError(authorization.error, authorization.status);
  if (authorization.role !== "admin" && authorization.role !== "owner") {
    return jsonError("Workspace access denied", 403);
  }
  const limited = await directRateLimited("direct-register", `${workspaceId}:${authorization.session.user.id}`, 10);
  if (limited) return limited;
  let expectedRevision: number | null;
  try {
    expectedRevision = parseExpectedRevision(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid expected revision", 400);
  }
  if (expectedRevision === null) return jsonError("Expected revision is required", 428);
  if (expectedRevision !== 0) return jsonError("New connections require expected revision 0", 409);
  let input;
  try {
    const body = await boundedJsonBody(request, 64 * 1_024);
    if (!body.ok) {
      return jsonError(
        body.reason === "too_large" ? "Direct database is too large" : "Invalid direct database",
        body.reason === "too_large" ? 413 : 400,
      );
    }
    input = parseDirectEndpoint(body.value);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid direct database", 400);
  }
  const connectionId = crypto.randomUUID();
  const created = await commitConnectionCreate({
    organizationId: workspaceId,
    connectionId,
    authority: {
      sessionId: authorization.session.session.id,
      userId: authorization.session.user.id,
      membershipId: authorization.membership.id,
      role: authorization.role,
    },
    input: connectionVersionPayload(input.connection),
    direct: { scope: input.scope, writeCeiling: input.writeCeiling },
  });
  if (!created) return jsonError("Connection changed concurrently. Retry creation.", 409);
  const direct = await loadDirectConnectionView(workspaceId, connectionId, authorization.membership.id);
  return privateJson({
    connection: publicConnection(created, authorization.role, authorization.accessMode, false, false, direct),
  }, { status: 201 });
}
