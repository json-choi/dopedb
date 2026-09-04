// PlanetScale OAuth callback. State is consumed before code exchange and bound to the
// current Better Auth user, preventing replay and cross-account integration swapping.
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { authoritativeSession } from "../../../../../../lib/authoritative-session";
import { db } from "../../../../../../lib/db";
import { env } from "../../../../../../lib/env";
import {
  exchangePlanetScaleCode,
  inspectPlanetScaleToken,
  revokePlanetScaleAuthorization,
} from "../../../../../../lib/providers/planetscale";
import { missingPlanetScaleManagedScopes } from "../../../../../../lib/providers/planetscale-core";
import {
  revokeActiveLeases,
  revokeProviderAuthorization,
} from "../../../../../../lib/provider-integrations";
import { persistProviderIntegration } from "../../../../../../lib/provider-integration-mutation-store";
import {
  claimRevocationGate,
  releaseRevocationGateClaim,
  type RevocationGateClaim,
} from "../../../../../../lib/revocation-gates";
import { sealProviderCredential } from "../../../../../../lib/secret-envelope";
import {
  providerOauthState,
  workspaceProviderIntegration,
} from "../../../../../../lib/schema";
import { authorizeWorkspace } from "../../../../../../lib/workspace-authorization";
import {
  localizedWorkspacePath,
  workspaceLocaleFromCookieHeader,
} from "../../../../../../lib/workspace-locale";

function settingsUrl(
  request: Request,
  workspaceId: string | null,
  status: "connected" | "failed",
) {
  const locale = workspaceLocaleFromCookieHeader(request.headers.get("cookie"));
  const target = new URL(localizedWorkspacePath("/settings", locale), env.appOrigin());
  target.searchParams.set("provider", "planetScale");
  target.searchParams.set("status", status);
  target.searchParams.set("section", "providers");
  if (workspaceId) {
    target.searchParams.set("workspace", workspaceId);
    target.hash = `workspace-${workspaceId}`;
  }
  return target;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (
    state.length < 32
    || state.length > 256
    || code.length < 8
    || code.length > 2_048
  ) {
    return Response.redirect(settingsUrl(request, null, "failed"));
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
  const stateHash = createHash("sha256").update(state).digest("base64url");
  const consumed = await db.delete(providerOauthState).where(and(
    eq(providerOauthState.stateHash, stateHash),
    eq(providerOauthState.userId, session.user.id),
    eq(providerOauthState.provider, "planetScale"),
    gt(providerOauthState.expiresAt, new Date()),
  )).returning({
    organizationId: providerOauthState.organizationId,
  });
  const oauthState = consumed[0];
  if (!oauthState) return Response.redirect(settingsUrl(request, null, "failed"));
  const authorization = await authorizeWorkspace(
    request,
    oauthState.organizationId,
    "manage",
  );
  if (!authorization.ok || authorization.session.user.id !== session.user.id) {
    return Response.redirect(settingsUrl(request, oauthState.organizationId, "failed"));
  }

  let tokenToRevoke: { accessToken: string; refreshToken: string } | null = null;
  try {
    const token = await exchangePlanetScaleCode(code);
    tokenToRevoke = { accessToken: token.accessToken, refreshToken: token.refreshToken };
    const tokenInfo = await inspectPlanetScaleToken(token.accessToken);
    const verifiedScope = tokenInfo.scope || token.scope;
    if (missingPlanetScaleManagedScopes(verifiedScope).length > 0) {
      throw new Error("PlanetScale authorization omitted required managed-access scopes");
    }
    const existing = await db.query.workspaceProviderIntegration.findFirst({
      where: and(
        eq(workspaceProviderIntegration.organizationId, oauthState.organizationId),
        eq(workspaceProviderIntegration.provider, "planetScale"),
        eq(workspaceProviderIntegration.externalAccountId, tokenInfo.subject),
      ),
      columns: {
        id: true,
        organizationId: true,
        provider: true,
        externalAccountId: true,
        encryptedCredential: true,
        credentialExpiresAt: true,
        status: true,
        revokedAt: true,
        revocationPendingAt: true,
        revocationClaimId: true,
        generation: true,
        updatedAt: true,
      },
    });
    const integrationId = existing?.id ?? crypto.randomUUID();
    const encryptedCredential = sealProviderCredential(integrationId, {
      ...token,
      scope: verifiedScope,
    });
    const now = new Date();
    let reconnectClaim: RevocationGateClaim | null = null;
    let supersededDisconnectClaimId: string | undefined;
    let reconnectRevoked = 0;
    if (existing?.status === "active" && !existing.revokedAt) {
      reconnectClaim = await claimRevocationGate({
        kind: "integration",
        organizationId: oauthState.organizationId,
        integrationId,
      });
      if (!reconnectClaim) {
        throw new Error("Another provider access change is already in progress");
      }
      let revocation;
      try {
        revocation = await revokeActiveLeases({
          organizationId: oauthState.organizationId,
          integrationId,
        });
      } catch (error) {
        await releaseRevocationGateClaim(reconnectClaim).catch(() => false);
        throw error;
      }
      if (revocation.deferred > 0) {
        await releaseRevocationGateClaim(reconnectClaim).catch(() => false);
        throw new Error("Active database access could not be revoked yet");
      }
      reconnectRevoked = revocation.revoked;
    } else if (
      existing?.status === "reconnect_required"
      && existing.revocationPendingAt
      && existing.revocationClaimId
    ) {
      // The previous disconnect reached non-replayable provider I/O. A new
      // OAuth grant is explicit user recovery: the final mutation requires
      // this exact old claim, then clears it and bumps generation so the
      // interrupted worker can neither finalize nor touch the new credential.
      supersededDisconnectClaimId = existing.revocationClaimId;
    } else if (existing?.revocationPendingAt) {
      throw new Error("Another provider access change is already in progress");
    }

    const persisted = await persistProviderIntegration({
      authority: {
        organizationId: oauthState.organizationId,
        membershipId: authorization.membership.id,
        userId: authorization.session.user.id,
        sessionId: authorization.session.session.id,
        role: authorization.role,
      },
      integrationId,
      provider: "planetScale",
      externalAccountId: tokenInfo.subject,
      displayName: `PlanetScale · ${tokenInfo.subject.slice(-8)}`,
      encryptedCredential,
      credentialExpiresAt: new Date(token.expiresAt),
      grantedScope: verifiedScope,
      localVerificationTarget: null,
      now,
      requestId: crypto.randomUUID(),
      revokedLeases: reconnectRevoked,
      existing,
      reconnectClaimId: reconnectClaim?.claimId ?? supersededDisconnectClaimId,
      principalClaims: [],
      production: null,
    }).catch(async (error) => {
      if (reconnectClaim) await releaseRevocationGateClaim(reconnectClaim).catch(() => false);
      throw error;
    });
    if (!persisted.ok) {
      if (reconnectClaim) await releaseRevocationGateClaim(reconnectClaim).catch(() => false);
      throw new Error("Provider access changed concurrently");
    }
    if (reconnectClaim && existing) {
      await revokeProviderAuthorization(existing).catch(() => undefined);
    }
    return Response.redirect(settingsUrl(request, oauthState.organizationId, "connected"));
  } catch {
    if (tokenToRevoke) {
      await revokePlanetScaleAuthorization(tokenToRevoke.accessToken).catch(() => undefined);
      await revokePlanetScaleAuthorization(tokenToRevoke.refreshToken).catch(() => undefined);
    }
    return Response.redirect(settingsUrl(request, oauthState.organizationId, "failed"));
  }
}
