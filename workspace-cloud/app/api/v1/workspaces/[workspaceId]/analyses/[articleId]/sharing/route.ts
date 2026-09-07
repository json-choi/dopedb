import { authoritativeSession } from "../../../../../../../../lib/authoritative-session";
import { env } from "../../../../../../../../lib/env";
import { boundedJsonBody, isUuid, jsonError, mutationAllowed, privateJson } from "../../../../../../../../lib/http";
import { createArticleInvitation, loadArticleSharing, parseInvitationEmail, revokeArticleInvitation } from "../../../../../../../../features/articleSharing/store";

type Context = { params: Promise<{ workspaceId: string; articleId: string }> };
async function handle(request: Request, context: Context) {
  if (request.method !== "GET" && !mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const scope = await context.params;
  if (!isUuid(scope.workspaceId) || !isUuid(scope.articleId)) return jsonError("Invalid Article scope", 400);
  const session = await authoritativeSession(request);
  if (!session) return jsonError("Unauthorized", 401);
  const identity = { userId: session.user.id, sessionId: session.session.id };
  if (request.method === "GET") {
    const sharing = await loadArticleSharing(scope, identity);
    return sharing ? privateJson(sharing) : jsonError("Article access is unavailable", 403);
  }
  const body = await boundedJsonBody(request, 1024);
  if (!body.ok || !body.value || typeof body.value !== "object" || Array.isArray(body.value)) return jsonError("Invalid invitation", 400);
  const input = body.value as Record<string, unknown>;
  const field = request.method === "DELETE" ? "id" : "email";
  if (Object.keys(input).length !== 1 || !(field in input)) return jsonError("Invalid invitation", 400);
  if (request.method === "DELETE") {
    if (typeof input.id !== "string" || !isUuid(input.id)) return jsonError("Invalid invitation", 400);
    const revoked = await revokeArticleInvitation(scope, identity, input.id);
    return revoked ? privateJson(revoked) : jsonError("Invitation unavailable. Manage accepted access in Workspace Access.", 409);
  }
  const email = parseInvitationEmail(input.email);
  if (!email) return jsonError("Enter the recipient's email address", 400);
  const invitation = await createArticleInvitation(scope, identity, email);
  return invitation ? privateJson(invitation, { status: 201 }) : jsonError("Invitation could not be created. Check your access or cancel unused invitations.", 409);
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
