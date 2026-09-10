// Google identity sign-in and short-lived Cloud SQL setup share the one
// callback URI already registered for this OAuth client. A database-backed,
// one-use state decides which handler owns the response before Better Auth sees
// it; ordinary sign-in states never enter this path.
import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { authoritativeSession } from "../authoritative-session";
import { db } from "../db";
import { env } from "../env";
import {
  openProviderSetupCredential,
  sealProviderSetupCredential,
} from "../secret-envelope";
import {
  providerOauthState,
  providerSetupSession,
} from "../schema";
import { authorizeWorkspace } from "../workspace-authorization";
import {
  exchangeGcpCloudCode,
  GCP_SETUP_SESSION_SECONDS,
  type GcpSetupCredential,
} from "./gcp-cloud-oauth";
import {
  recoverDatabaseBootstrapUser,
} from "./gcp-cloud-bootstrap-database";
import { parseDatabaseBootstrapState } from "./gcp-cloud-bootstrap-journal";
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

async function reconcilePriorSetupSessions(input: {
  organizationId: string;
  userId: string;
  credential: GcpSetupCredential;
}) {
  const expired = await db.query.providerSetupSession.findMany({
    where: and(
      eq(providerSetupSession.organizationId, input.organizationId),
      eq(providerSetupSession.userId, input.userId),
      eq(providerSetupSession.provider, "gcpCloudSql"),
      eq(providerSetupSession.accountLabel, input.credential.email),
      isNull(providerSetupSession.consumedAt),
    ),
    columns: {
      id: true,
      accountLabel: true,
      encryptedCredential: true,
    },
    limit: 25,
  });
  for (const row of expired) {
    const secret = openProviderSetupCredential<GcpSetupCredential & {
      databaseBootstrap?: unknown;
    }>(row.id, row.encryptedCredential);
    const bootstrap = parseDatabaseBootstrapState(secret.databaseBootstrap);
    if (bootstrap.lease && Date.parse(bootstrap.lease.expiresAt) > Date.now()) {
      throw new ProviderRequestError(
        "gcpCloudSql",
        "Another Cloud SQL setup operation is still running",
        409,
      );
    }
    if (bootstrap.recovery) {
      const sameAccount = row.accountLabel.toLowerCase()
          === input.credential.email.toLowerCase()
        && secret.email.toLowerCase() === input.credential.email.toLowerCase();
      if (!sameAccount) continue;
      await recoverDatabaseBootstrapUser(input.credential, bootstrap.recovery);
    }
    await db.delete(providerSetupSession).where(and(
      eq(providerSetupSession.id, row.id),
      eq(providerSetupSession.organizationId, input.organizationId),
      eq(providerSetupSession.userId, input.userId),
    ));
  }
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
    // A terminated Worker may have left an encrypted database-role recovery
    // record. A fresh token from the same workspace user and Google account must
    // compensate that mutation before an older setup row can be removed.
    stage = "expired_session_cleanup";
    await reconcilePriorSetupSessions({
      organizationId: oauthState.organizationId,
      userId: session.user.id,
      credential,
    });
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
