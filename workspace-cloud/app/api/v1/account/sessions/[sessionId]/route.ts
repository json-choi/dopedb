// Ends one other session of the signed-in account by id. The token stays on the
// server and Better Auth performs the revocation so its session caches stay consistent.
import { and, eq } from "drizzle-orm";
import { auth } from "../../../../../../lib/auth";
import {
  authoritativeSession,
  authoritativeSessionHeaders,
} from "../../../../../../lib/authoritative-session";
import { db } from "../../../../../../lib/db";
import { env } from "../../../../../../lib/env";
import { isUuid, jsonError, mutationAllowed } from "../../../../../../lib/http";
import { session as authSession } from "../../../../../../lib/schema";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationAllowed(request, env.appOrigin())) return jsonError("Invalid request origin", 403);
  const { sessionId } = await context.params;
  if (!isUuid(sessionId)) return jsonError("Invalid session id", 400);
  const current = await authoritativeSession(request);
  if (!current) return jsonError("Unauthorized", 401);
  if (sessionId === current.session.id) {
    // The caller's own credential is removed by signing out, which also clears
    // the client's local copy instead of stranding it.
    return jsonError("Sign out to end the current session", 409, "current_session");
  }
  const [target] = await db.select({ token: authSession.token }).from(authSession).where(and(
    eq(authSession.id, sessionId),
    eq(authSession.userId, current.user.id),
  )).limit(1);
  if (!target) return jsonError("Session not found", 404);
  await auth.api.revokeSession({
    headers: authoritativeSessionHeaders(request),
    body: { token: target.token },
  });
  return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
}
