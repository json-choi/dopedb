// Google identity sign-in and short-lived Cloud SQL setup share the one
// callback URI already registered for this OAuth client. A database-backed,
// one-use state decides which handler owns the response before Better Auth sees
// it; ordinary sign-in states never enter this path.
import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { authoritativeSession } from "../authoritative-session";
import { db } from "../db";
import { env } from "../env";
import { sealProviderSetupCredential } from "../secret-envelope";
import {
  providerOauthState,
  providerSetupSession,
} from "../schema";
import { authorizeWorkspace } from "../workspace-authorization";
import {
  exchangeGcpCloudCode,
  GCP_SETUP_SESSION_SECONDS,
} from "./gcp-cloud-oauth";
import { ProviderRequestError } from "./provider-types";
import {
  localizedWorkspacePath,
  workspaceLocaleFromCookieHeader,
} from "../workspace-locale";
import { logGcpCloudSetupCallbackFailure } from "../workspace-server-log";

function settingsUrl(request: Request, workspaceId: string | null, setupId?: string) {
  const locale = workspaceLocaleFromCookieHeader(request.headers.get("cookie"));
  const target = new URL(localizedWorkspacePath("/settings", locale), env.appOrigin());
  target.searchParams.set("provider", "gcpCloudSql");
  target.searchParams.set("status", setupId ? "authorised" : "failed");
  target.searchParams.set("section", "providers");
  if (workspaceId) target.searchParams.set("workspace", workspaceId);
  if (setupId) target.searchParams.set("gcpSetup", setupId);
  return target;
}

function stateHash(request: Request) {
  const state = new URL(request.url).searchParams.get("state") ?? "";
  if (state.length < 32 || state.length > 256) return null;
  return createHash("sha256").update(state).digest("base64url");
}

export async function isGcpCloudSetupCallback(request: Request) {
  const hash = stateHash(request);
  if (!hash) return false;
  const row = await db.query.providerOauthState.findFirst({
    where: and(
      eq(providerOauthState.stateHash, hash),
      eq(providerOauthState.provider, "gcpCloudSql"),
      gt(providerOauthState.expiresAt, new Date()),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}

export async function gcpCloudSetupCallbackResponse(request: Request) {
  const url = new URL(request.url);
  const hash = stateHash(request);
  const code = url.searchParams.get("code") ?? "";
  if (!hash || code.length < 8 || code.length > 2_048) {
    return Response.redirect(settingsUrl(request, null));
  }
  const session = await authoritativeSession(request);
  if (!session) {
    return Response.redirect(new URL(
      localizedWorkspacePath(
        `/auth/sign-in?returnTo=${encodeURIComponent(localizedWorkspacePath("/settings", workspaceLocaleFromCookieHeader(request.headers.get("cookie"))))}`,
        workspaceLocaleFromCookieHeader(request.headers.get("cookie")),
      ),
      env.appOrigin(),
    ));
  }
  const consumed = await db.delete(providerOauthState).where(and(
    eq(providerOauthState.stateHash, hash),
    eq(providerOauthState.userId, session.user.id),
    eq(providerOauthState.provider, "gcpCloudSql"),
    gt(providerOauthState.expiresAt, new Date()),
  )).returning({ organizationId: providerOauthState.organizationId });
  const oauthState = consumed[0];
  if (!oauthState) return Response.redirect(settingsUrl(request, null));
  const authorization = await authorizeWorkspace(
    request,
    oauthState.organizationId,
    "manage",
  );
  if (!authorization.ok || authorization.session.user.id !== session.user.id) {
    return Response.redirect(settingsUrl(request, oauthState.organizationId));
  }
  let stage:
    | "token_exchange"
    | "credential_sealing"
    | "expired_session_cleanup"
    | "setup_session_insert" = "token_exchange";
  try {
    const credential = await exchangeGcpCloudCode(code);
    const setupId = crypto.randomUUID();
    const expiresAt = new Date(Math.min(
      Date.parse(credential.expiresAt),
      Date.now() + GCP_SETUP_SESSION_SECONDS * 1_000,
    ));
    stage = "credential_sealing";
    const encryptedCredential = sealProviderSetupCredential(setupId, credential);
    // Expired rows cannot be consumed because every reader checks expiresAt. Cleanup
    // is independent housekeeping and must not use the callback transaction API,
    // which drizzle-orm's neon-http driver deliberately does not support.
    stage = "expired_session_cleanup";
    await db.delete(providerSetupSession).where(lt(
      providerSetupSession.expiresAt,
      new Date(),
    ));
    stage = "setup_session_insert";
    await db.insert(providerSetupSession).values({
      id: setupId,
      organizationId: oauthState.organizationId,
      userId: session.user.id,
      provider: "gcpCloudSql",
      encryptedCredential,
      accountLabel: credential.email,
      expiresAt,
    });
    return Response.redirect(settingsUrl(request, oauthState.organizationId, setupId));
  } catch (error) {
    logGcpCloudSetupCallbackFailure({
      stage,
      providerRequest: error instanceof ProviderRequestError,
      status: error instanceof ProviderRequestError ? error.status : 0,
    });
    return Response.redirect(settingsUrl(request, oauthState.organizationId));
  }
}
