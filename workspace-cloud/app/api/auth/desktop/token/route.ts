// Native PKCE exchange never reads browser cookies or returns a browser session token.
import { auth } from "../../../../../lib/auth";
import { boundedJsonBody, privateJson } from "../../../../../lib/http";
import { parseDesktopTokenRequest } from "../../../../../lib/desktop-authorization";
import { consumeDesktopAuthorizationCode, desktopApprovalSessionActive } from "../../../../../lib/desktop-authorization-store";
import { consumeRateLimit, forwardedClientKey } from "../../../../../lib/rate-limit";

function result(body: unknown, status = 200) {
  return privateJson(body, { status, headers: { "pragma": "no-cache", "x-content-type-options": "nosniff" } });
}

export async function POST(request: Request) {
  // This first-party token endpoint is called only by the native HTTP client.
  if (request.headers.has("origin") || request.headers.has("cookie") || request.headers.has("authorization")) {
    return result({ error: "invalid_request" }, 400);
  }
  if (!await consumeRateLimit({ namespace: "desktop-token", discriminator: forwardedClientKey(request.headers), limit: 30 })) {
    return result({ error: "temporarily_unavailable" }, 429);
  }
  const body = await boundedJsonBody(request, 2048);
  const tokenRequest = body.ok ? parseDesktopTokenRequest(body.value) : null;
  if (!tokenRequest) return result({ error: "invalid_request" }, 400);
  const approval = await consumeDesktopAuthorizationCode(tokenRequest);
  if (!approval) return result({ error: "invalid_grant" }, 400);
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(approval.userId);
  if (!session) return result({ error: "server_error" }, 500);
  // A browser revocation racing the exchange must not leave an orphan native login.
  if (!await desktopApprovalSessionActive(approval.sessionId, approval.userId)) {
    await context.internalAdapter.deleteSession(session.token);
    return result({ error: "invalid_grant" }, 400);
  }
  return result({
    access_token: session.token, token_type: "Bearer",
    expires_in: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
  });
}
