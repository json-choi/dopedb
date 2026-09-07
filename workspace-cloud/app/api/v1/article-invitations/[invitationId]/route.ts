import { authoritativeSession } from "../../../../../lib/authoritative-session";
import { env } from "../../../../../lib/env";
import { isUuid, jsonError, mutationAllowed, privateJson } from "../../../../../lib/http";
import { acceptArticleInvitation } from "../../../../../features/articleSharing/acceptance";

export async function POST(request: Request, context: { params: Promise<{ invitationId: string }> }) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { invitationId } = await context.params;
  if (!isUuid(invitationId)) return jsonError("Invalid invitation", 400);
  const session = await authoritativeSession(request);
  if (!session) return jsonError("Unauthorized", 401);
  const result = await acceptArticleInvitation(invitationId, { userId: session.user.id, sessionId: session.session.id });
  return result ? privateJson(result) : jsonError("This invitation is unavailable for this account. Ask the sender for a new invitation.", 409);
}
