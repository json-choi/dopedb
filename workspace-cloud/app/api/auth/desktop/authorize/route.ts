// Cookie-authenticated explicit approval binds a short-lived code to one Desktop request.
import { auth } from "../../../../../lib/auth";
import { env } from "../../../../../lib/env";
import { boundedJsonBody, privateJson } from "../../../../../lib/http";
import { consumeRateLimit, forwardedClientKey } from "../../../../../lib/rate-limit";
import { desktopCallbackUrl, parseDesktopAuthorization, verifyDesktopApprovalNonce } from "../../../../../lib/desktop-authorization";
import { issueDesktopAuthorizationCode } from "../../../../../lib/desktop-authorization-store";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== env.appOrigin() || request.headers.has("authorization")) {
    return privateJson({ error: "invalid_request" }, { status: 403 });
  }
  if (!await consumeRateLimit({ namespace: "desktop-approval", discriminator: forwardedClientKey(request.headers), limit: 20 })) {
    return privateJson({ error: "temporarily_unavailable" }, { status: 429 });
  }
  const current = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!current) return privateJson({ error: "login_required" }, { status: 401 });
  const body = await boundedJsonBody(request, 4096);
  if (!body.ok || !body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return privateJson({ error: "invalid_request" }, { status: 400 });
  }
  const value = body.value as Record<string, unknown>;
  const authorization = parseDesktopAuthorization(value.request);
  if (Object.keys(value).length !== 3 || !authorization
    || (value.decision !== "approve" && value.decision !== "deny")
    || !verifyDesktopApprovalNonce(value.nonce, authorization, current.session.id, env.authSecret())) {
    return privateJson({ error: "invalid_request" }, { status: 400 });
  }
  const code = await issueDesktopAuthorizationCode({
    request: authorization, approvalNonce: value.nonce, sessionId: current.session.id, userId: current.user.id,
    denied: value.decision === "deny",
  });
  if (!code) return privateJson({ error: "invalid_request" }, { status: 400 });
  const outcome = value.decision === "deny" ? { error: "access_denied" as const } : { code };
  return privateJson({ redirect_uri: desktopCallbackUrl(authorization, outcome) }, {
    headers: { "pragma": "no-cache", "x-content-type-options": "nosniff" },
  });
}
